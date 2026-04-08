"""Camada de compatibilidade entre o contrato JSON legado e PostgreSQL."""

from __future__ import annotations

import json
import os
import threading
import time
from copy import deepcopy
from pathlib import Path

from servidor_modules.database.connection import (
    SQLiteConnectionProxy,
    clear_recent_online_failure,
    evaluate_storage_guard,
    ensure_local_sqlite_database,
    get_connection,
    has_empresas_numero_cliente_column,
    has_pending_local_offline_changes,
    has_recent_online_failure,
    mark_local_offline_change,
    refresh_local_sql_dump,
)


_STORAGES = {}
_STORAGES_LOCK = threading.Lock()
_LAST_STORAGE_MODE_LOG = {}
_CONNECTION_MODE_CACHE = {}
_CONNECTION_MODE_CACHE_TTL_SECONDS = 3.0


DEFAULT_DOCUMENTS = {
    "dados.json": {
        "ADM": [],
        "empresas": [],
        "constants": {},
        "machines": [],
        "materials": {},
        "banco_acessorios": {},
        "dutos": [],
        "tubos": [],
    },
    "sessions.json": {"sessions": {"session_active": {"obras": []}}},
}


def normalize_numero_cliente_atual(value):
    try:
        numero = int(value)
    except (TypeError, ValueError):
        return 0
    return max(numero, 0)


def normalize_empresa(empresa):
    if not isinstance(empresa, dict):
        return None

    codigo = empresa.get("codigo")
    nome = empresa.get("nome")
    numero_cliente_atual = normalize_numero_cliente_atual(
        empresa.get("numeroClienteAtual")
    )
    if codigo and nome:
        return {
            **empresa,
            "codigo": codigo,
            "nome": nome,
            "credenciais": empresa.get("credenciais"),
            "numeroClienteAtual": numero_cliente_atual,
        }

    company_keys = [
        key for key in empresa.keys() if key not in {"credenciais", "numeroClienteAtual"}
    ]
    if not company_keys:
        return None

    codigo = company_keys[0]
    return {
        "codigo": codigo,
        "nome": empresa.get(codigo),
        "credenciais": empresa.get("credenciais"),
        "numeroClienteAtual": numero_cliente_atual,
    }


def normalize_admin_collection(admin_data):
    if isinstance(admin_data, list):
        return [{**admin} for admin in admin_data if isinstance(admin, dict)]

    if isinstance(admin_data, dict):
        return [{**admin_data}]

    return []


def sanitize_dados_payload(payload):
    if not isinstance(payload, dict):
        payload = {}

    legacy_admins = payload.get("administradores")
    primary_admins = payload.get("ADM")
    sanitized = {
        **payload,
        "ADM": normalize_admin_collection(
            primary_admins if primary_admins is not None else legacy_admins
        ),
    }

    sanitized.pop("administradores", None)

    for key, default_value in DEFAULT_DOCUMENTS["dados.json"].items():
        sanitized.setdefault(key, deepcopy(default_value))

    return sanitized


def normalize_sessions_payload(payload):
    if not isinstance(payload, dict):
        payload = {}

    sessions = payload.get("sessions")
    if not isinstance(sessions, dict):
        sessions = {}

    normalized_sessions = {}
    for session_id, session_payload in sessions.items():
        if not isinstance(session_payload, dict):
            session_payload = {}
        obras = session_payload.get("obras")
        if not isinstance(obras, list):
            obras = []
        normalized_sessions[str(session_id)] = {
            **session_payload,
            "obras": [str(obra_id) for obra_id in obras if str(obra_id).strip()],
        }

    normalized_sessions.setdefault("session_active", {"obras": []})
    return {"sessions": normalized_sessions}


class DatabaseStorage:
    def __init__(self, project_root):
        self.project_root = Path(project_root)
        self.json_dir = self.project_root / "json"
        self.json_dir.mkdir(parents=True, exist_ok=True)
        self.conn = self._create_storage_connection()
        self._log_active_storage_mode()
        self._lock = threading.RLock()
        self._bootstrapped = False
        self._mirror_to_disk = (
            str(os.environ.get("ESI_WRITE_JSON_SNAPSHOTS", "")).strip().lower()
            in {"1", "true", "yes", "on"}
        )

    def refresh_connection_mode(self):
        with self._lock:
            root_key = str(self.project_root.resolve())
            cache_entry = _CONNECTION_MODE_CACHE.get(root_key) or {}
            now = time.monotonic()
            if (
                cache_entry.get("conn") is self.conn
                and (now - float(cache_entry.get("checked_at") or 0.0))
                < _CONNECTION_MODE_CACHE_TTL_SECONDS
            ):
                return self.conn

            currently_online = not getattr(self.conn, "is_sqlite", False)
            pending_local_changes = has_pending_local_offline_changes(self.project_root)
            recent_online_failure = has_recent_online_failure(self.project_root)
            should_use_local = pending_local_changes or recent_online_failure
            online_conn = None

            if currently_online and not pending_local_changes:
                try:
                    storage_guard = evaluate_storage_guard(
                        self.project_root,
                        conn=self.conn,
                    )
                    if not storage_guard.get("forced_offline"):
                        clear_recent_online_failure(self.project_root)
                        _CONNECTION_MODE_CACHE[root_key] = {
                            "conn": self.conn,
                            "checked_at": now,
                        }
                        return self.conn
                    should_use_local = True
                except Exception:
                    clear_recent_online_failure(self.project_root)
                    _CONNECTION_MODE_CACHE[root_key] = {
                        "conn": self.conn,
                        "checked_at": now,
                    }
                    return self.conn

            if not should_use_local:
                try:
                    online_conn = get_connection(
                        self.project_root,
                        wait_timeout_seconds=float(
                            os.environ.get("DATABASE_STORAGE_BOOT_TIMEOUT_SECONDS", "2")
                        ),
                    )
                    storage_guard = evaluate_storage_guard(
                        self.project_root,
                        conn=online_conn,
                    )
                    should_use_local = bool(storage_guard.get("forced_offline"))
                except Exception:
                    should_use_local = True

            if should_use_local:
                if not getattr(self.conn, "is_sqlite", False):
                    try:
                        self.conn.release()
                    except Exception:
                        pass
                    self.conn = SQLiteConnectionProxy(
                        ensure_local_sqlite_database(self.project_root)
                    )
                    self._log_active_storage_mode()
                _CONNECTION_MODE_CACHE[root_key] = {
                    "conn": self.conn,
                    "checked_at": now,
                }
                return self.conn

            if getattr(self.conn, "is_sqlite", False):
                try:
                    self.conn.release()
                except Exception:
                    pass
                self.conn = online_conn or get_connection(
                    self.project_root,
                    wait_timeout_seconds=float(
                        os.environ.get("DATABASE_STORAGE_BOOT_TIMEOUT_SECONDS", "2")
                    ),
                )
                self._log_active_storage_mode()

            _CONNECTION_MODE_CACHE[root_key] = {
                "conn": self.conn,
                "checked_at": now,
            }
            return self.conn

    def _create_storage_connection(self):
        if has_recent_online_failure(self.project_root) or has_pending_local_offline_changes(
            self.project_root
        ):
            sqlite_path = ensure_local_sqlite_database(self.project_root)
            return SQLiteConnectionProxy(sqlite_path)

        try:
            storage_boot_timeout = float(
                os.environ.get("DATABASE_STORAGE_BOOT_TIMEOUT_SECONDS", "2")
            )
            return get_connection(
                self.project_root,
                wait_timeout_seconds=storage_boot_timeout,
            )
        except Exception:
            sqlite_path = ensure_local_sqlite_database(self.project_root)
            return SQLiteConnectionProxy(sqlite_path)

    def _log_active_storage_mode(self):
        root_key = str(self.project_root.resolve())
        using_local_database = bool(getattr(self.conn, "is_sqlite", False))
        pending_offline_changes = has_pending_local_offline_changes(self.project_root)

        if using_local_database and pending_offline_changes:
            message = " Base ativa: offline local (alteracoes offline pendentes)."
        elif using_local_database:
            message = " Base ativa: offline local (SQLite)."
        else:
            message = " Base ativa: online (PostgreSQL)."

        if _LAST_STORAGE_MODE_LOG.get(root_key) == message:
            return

        _LAST_STORAGE_MODE_LOG[root_key] = message
        print(message)

    def _supports_empresas_numero_cliente_column(self):
        self.refresh_connection_mode()
        return has_empresas_numero_cliente_column(
            project_root=self.project_root,
            conn=self.conn,
        )

    def default_document(self, name):
        return deepcopy(DEFAULT_DOCUMENTS.get(name, {}))

    def ensure_bootstrap(self):
        with self._lock:
            self.refresh_connection_mode()
            if self._bootstrapped:
                return

            for name, default_payload in DEFAULT_DOCUMENTS.items():
                if self._document_exists(name):
                    continue

                payload = self._load_disk_snapshot(name, default_payload)

                self._save_document_internal(name, payload, mirror_to_disk=self._mirror_to_disk)

            self._bootstrapped = True

    def load_document(self, name, default_payload=None):
        self.refresh_connection_mode()
        self.ensure_bootstrap()
        if name == "dados.json":
            return self._load_dados_document(default_payload)
        if name == "sessions.json":
            return self._load_sessions_document(default_payload)
        if name == "backup.json":
            from servidor_modules.database.repositories.obra_repository import (
                ObraRepository,
            )

            return ObraRepository(self.project_root).get_backup_payload()
        raise ValueError(f"Documento nao suportado: {name}")

    def save_document(self, name, payload):
        self.refresh_connection_mode()
        self.ensure_bootstrap()
        self._save_document_internal(name, payload, mirror_to_disk=self._mirror_to_disk)
        return True

    def sync_document_to_disk(self, name):
        if not self._mirror_to_disk:
            return
        payload = self.load_document(name, self.default_document(name))
        self._write_snapshot(name, payload)

    def _document_exists(self, name):
        if name == "dados.json":
            row = self.conn.execute(
                """
                SELECT (
                    EXISTS(SELECT 1 FROM admins)
                    OR EXISTS(SELECT 1 FROM empresas)
                    OR EXISTS(SELECT 1 FROM constants)
                    OR EXISTS(SELECT 1 FROM materials)
                    OR EXISTS(SELECT 1 FROM machine_catalog)
                    OR EXISTS(SELECT 1 FROM acessorios)
                    OR EXISTS(SELECT 1 FROM dutos)
                    OR EXISTS(SELECT 1 FROM tubos)
                ) AS has_content
                """
            ).fetchone()
            return bool(row and row["has_content"])

        if name == "sessions.json":
            row = self.conn.execute(
                "SELECT EXISTS(SELECT 1 FROM sessions) AS has_content"
            ).fetchone()
            return bool(row and row["has_content"])

        if name == "backup.json":
            row = self.conn.execute(
                "SELECT EXISTS(SELECT 1 FROM obras) AS has_content"
            ).fetchone()
            return bool(row and row["has_content"])

        return False

    def _save_document_internal(self, name, payload, mirror_to_disk):
        if name == "dados.json":
            payload = sanitize_dados_payload(payload)
        elif name == "sessions.json":
            payload = normalize_sessions_payload(payload)
        elif name == "backup.json":
            from servidor_modules.database.repositories.obra_repository import (
                ObraRepository,
            )

            ObraRepository(self.project_root).replace_backup_payload(
                payload or {"obras": []}
            )
            if mirror_to_disk:
                self._write_snapshot(name, payload or {"obras": []})
            return
        else:
            raise ValueError(f"Documento nao suportado: {name}")

        with self._lock:
            cursor = self.conn.cursor()
            cursor.execute("BEGIN")
            try:
                if name == "dados.json":
                    self._sync_dados(cursor, payload)
                elif name == "sessions.json":
                    self._sync_sessions(cursor, payload)

                self.conn.commit()
            except Exception:
                self.conn.rollback()
                raise

        if getattr(self.conn, "is_sqlite", False):
            refresh_local_sql_dump(self.project_root)
            if name in {"dados.json", "backup.json"}:
                mark_local_offline_change(self.project_root, source=f"storage:{name}")

        if mirror_to_disk:
            self._write_snapshot(name, payload)

    def _write_snapshot(self, name, payload):
        file_path = self.json_dir / name
        with open(file_path, "w", encoding="utf-8") as file_obj:
            json.dump(payload, file_obj, ensure_ascii=False, indent=2)

    def _load_disk_snapshot(self, name, default_payload):
        disk_path = self.json_dir / name
        payload = deepcopy(default_payload)
        if disk_path.exists():
            try:
                with open(disk_path, "r", encoding="utf-8") as file_obj:
                    payload = json.load(file_obj)
            except Exception:
                payload = deepcopy(default_payload)
        return payload

    def _load_dados_document(self, default_payload=None):
        payload = deepcopy(default_payload) if default_payload is not None else {}
        payload.update(
            {
                "ADM": self._load_admins(),
                "empresas": self._load_empresas(),
                "constants": self._load_constants(),
                "machines": self._load_machines(),
                "materials": self._load_materials(),
                "banco_acessorios": self._load_acessorios(),
                "dutos": self._load_dutos(),
                "tubos": self._load_tubos(),
            }
        )
        return sanitize_dados_payload(payload)

    def _load_sessions_document(self, default_payload=None):
        payload = deepcopy(default_payload) if default_payload is not None else {}
        sessions = {}
        rows = self.conn.execute(
            "SELECT session_id, payload_json FROM sessions ORDER BY session_id"
        ).fetchall()
        for row in rows:
            session_payload = row.get("payload_json")
            try:
                sessions[str(row["session_id"])] = (
                    json.loads(session_payload) if session_payload else {}
                )
            except Exception:
                sessions[str(row["session_id"])] = {}

        payload["sessions"] = sessions
        return normalize_sessions_payload(payload)

    def _load_admins(self):
        rows = self.conn.execute(
            "SELECT raw_json FROM admins ORDER BY sort_order, usuario"
        ).fetchall()
        return [json.loads(row["raw_json"]) for row in rows]

    def _load_empresas(self):
        try:
            if self._supports_empresas_numero_cliente_column():
                rows = self.conn.execute(
                    """
                    SELECT raw_json, ultimo_numero_cliente
                    FROM empresas
                    ORDER BY sort_order, codigo
                    """
                ).fetchall()
            else:
                rows = self.conn.execute(
                    """
                    SELECT raw_json, 0 AS ultimo_numero_cliente
                    FROM empresas
                    ORDER BY sort_order, codigo
                    """
                ).fetchall()
        except Exception as exc:
            if "ultimo_numero_cliente" not in str(exc):
                raise
            rows = self.conn.execute(
                """
                SELECT raw_json, 0 AS ultimo_numero_cliente
                FROM empresas
                ORDER BY sort_order, codigo
                """
            ).fetchall()
        empresas = []
        for row in rows:
            empresa = json.loads(row["raw_json"])
            if isinstance(empresa, dict):
                empresa["numeroClienteAtual"] = max(
                    normalize_numero_cliente_atual(
                        empresa.get("numeroClienteAtual")
                    ),
                    normalize_numero_cliente_atual(
                        row.get("ultimo_numero_cliente")
                    ),
                )
            empresas.append(empresa)
        return empresas

    def _load_constants(self):
        rows = self.conn.execute(
            "SELECT key, value_json FROM constants ORDER BY key"
        ).fetchall()
        constants = {}
        for row in rows:
            constants[str(row["key"])] = json.loads(row["value_json"])
        return constants

    def _load_materials(self):
        rows = self.conn.execute(
            "SELECT key, raw_json FROM materials ORDER BY sort_order, key"
        ).fetchall()
        return {str(row["key"]): json.loads(row["raw_json"]) for row in rows}

    def _load_machines(self):
        rows = self.conn.execute(
            "SELECT raw_json FROM machine_catalog ORDER BY sort_order, type"
        ).fetchall()
        return [json.loads(row["raw_json"]) for row in rows]

    def _load_acessorios(self):
        rows = self.conn.execute(
            "SELECT tipo, raw_json FROM acessorios ORDER BY sort_order, tipo"
        ).fetchall()
        return {str(row["tipo"]): json.loads(row["raw_json"]) for row in rows}

    def _load_dutos(self):
        rows = self.conn.execute(
            "SELECT raw_json FROM dutos ORDER BY sort_order, type"
        ).fetchall()
        return [json.loads(row["raw_json"]) for row in rows]

    def _load_tubos(self):
        rows = self.conn.execute(
            "SELECT raw_json FROM tubos ORDER BY sort_order, polegadas"
        ).fetchall()
        return [json.loads(row["raw_json"]) for row in rows]

    def _sync_dados(self, cursor, payload):
        cursor.execute("DELETE FROM admins")
        cursor.execute("DELETE FROM empresas")
        cursor.execute("DELETE FROM constants")
        cursor.execute("DELETE FROM materials")
        cursor.execute("DELETE FROM machine_catalog")
        cursor.execute("DELETE FROM acessorios")
        cursor.execute("DELETE FROM dutos")
        cursor.execute("DELETE FROM tubos")

        for index, admin in enumerate(payload.get("ADM", [])):
            if not isinstance(admin, dict):
                continue
            cursor.execute(
                """
                INSERT INTO admins(usuario, token, raw_json, sort_order)
                VALUES(?, ?, ?, ?)
                """,
                (
                    str(admin.get("usuario", "")).strip(),
                    str(admin.get("token", "")).strip() or None,
                    json.dumps(admin, ensure_ascii=False),
                    index,
                ),
            )

        for index, empresa in enumerate(payload.get("empresas", [])):
            empresa_normalizada = normalize_empresa(empresa)
            if not empresa_normalizada or not empresa_normalizada.get("codigo"):
                continue

            if self._supports_empresas_numero_cliente_column():
                cursor.execute(
                    """
                    INSERT INTO empresas(
                        codigo, nome, ultimo_numero_cliente, credenciais_json, raw_json, sort_order
                    )
                    VALUES(?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(empresa_normalizada.get("codigo", "")).strip(),
                        str(empresa_normalizada.get("nome", "")).strip(),
                        normalize_numero_cliente_atual(
                            empresa_normalizada.get("numeroClienteAtual")
                        ),
                        json.dumps(
                            empresa_normalizada.get("credenciais"), ensure_ascii=False
                        )
                        if empresa_normalizada.get("credenciais") is not None
                        else None,
                        json.dumps(empresa_normalizada, ensure_ascii=False),
                        index,
                    ),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO empresas(
                        codigo, nome, credenciais_json, raw_json, sort_order
                    )
                    VALUES(?, ?, ?, ?, ?)
                    """,
                    (
                        str(empresa_normalizada.get("codigo", "")).strip(),
                        str(empresa_normalizada.get("nome", "")).strip(),
                        json.dumps(
                            empresa_normalizada.get("credenciais"), ensure_ascii=False
                        )
                        if empresa_normalizada.get("credenciais") is not None
                        else None,
                        json.dumps(empresa_normalizada, ensure_ascii=False),
                        index,
                    ),
                )

        for key, constant_data in (payload.get("constants") or {}).items():
            cursor.execute(
                """
                INSERT INTO constants(key, value_json, description)
                VALUES(?, ?, ?)
                """,
                (
                    str(key),
                    json.dumps(constant_data, ensure_ascii=False),
                    constant_data.get("description")
                    if isinstance(constant_data, dict)
                    else None,
                ),
            )

        for index, (key, material_data) in enumerate((payload.get("materials") or {}).items()):
            cursor.execute(
                """
                INSERT INTO materials(key, raw_json, sort_order)
                VALUES(?, ?, ?)
                """,
                (
                    str(key),
                    json.dumps(material_data, ensure_ascii=False),
                    index,
                ),
            )

        for index, machine in enumerate(payload.get("machines", [])):
            if not isinstance(machine, dict) or not machine.get("type"):
                continue
            cursor.execute(
                """
                INSERT INTO machine_catalog(type, aplicacao, raw_json, sort_order)
                VALUES(?, ?, ?, ?)
                """,
                (
                    str(machine.get("type")),
                    machine.get("aplicacao"),
                    json.dumps(machine, ensure_ascii=False),
                    index,
                ),
            )

        for index, (tipo, acessorio) in enumerate((payload.get("banco_acessorios") or {}).items()):
            cursor.execute(
                """
                INSERT INTO acessorios(tipo, descricao, raw_json, sort_order)
                VALUES(?, ?, ?, ?)
                """,
                (
                    str(tipo),
                    acessorio.get("descricao") if isinstance(acessorio, dict) else None,
                    json.dumps(acessorio, ensure_ascii=False),
                    index,
                ),
            )

        for index, duto in enumerate(payload.get("dutos", [])):
            if not isinstance(duto, dict) or not duto.get("type"):
                continue
            cursor.execute(
                """
                INSERT INTO dutos(type, descricao, raw_json, sort_order)
                VALUES(?, ?, ?, ?)
                """,
                (
                    str(duto.get("type")),
                    duto.get("descricao"),
                    json.dumps(duto, ensure_ascii=False),
                    index,
                ),
            )

        for index, tubo in enumerate(payload.get("tubos", [])):
            if not isinstance(tubo, dict) or not tubo.get("polegadas"):
                continue
            cursor.execute(
                """
                INSERT INTO tubos(polegadas, mm, valor, raw_json, sort_order)
                VALUES(?, ?, ?, ?, ?)
                """,
                (
                    str(tubo.get("polegadas")),
                    tubo.get("mm"),
                    tubo.get("valor"),
                    json.dumps(tubo, ensure_ascii=False),
                    index,
                ),
            )

    def _sync_sessions(self, cursor, payload):
        cursor.execute("DELETE FROM sessions")
        for session_id, session_payload in normalize_sessions_payload(payload).get("sessions", {}).items():
            cursor.execute(
                """
                INSERT INTO sessions(session_id, payload_json)
                VALUES(?, ?)
                """,
                (
                    str(session_id),
                    json.dumps(session_payload, ensure_ascii=False),
                ),
            )


def get_storage(project_root):
    root_key = str(Path(project_root).resolve())
    with _STORAGES_LOCK:
        storage = _STORAGES.get(root_key)
        if storage is None:
            storage = DatabaseStorage(project_root)
            _STORAGES[root_key] = storage
    storage.refresh_connection_mode()
    return storage


def release_storage_handles(project_root) -> None:
    root_key = str(Path(project_root).resolve())
    with _STORAGES_LOCK:
        storage = _STORAGES.get(root_key)

    if storage is None:
        return

    with storage._lock:
        try:
            storage.conn.release()
        except Exception:
            pass
