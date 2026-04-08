"""Repositorio do payload agregado do sistema."""

from __future__ import annotations

import json

from servidor_modules.database.connection import (
    evaluate_storage_guard,
    execute_maintenance_statements,
    get_database_path,
    get_storage_guard_snapshot,
    has_pending_local_offline_changes,
    mark_local_offline_change,
    refresh_local_sql_dump,
)
from servidor_modules.database.storage import get_storage


class SystemRepository:
    DEFAULT_DATABASE_LIMIT_MB = 500
    EXCLUDED_CONSTANT_KEYS = {"SUPABASE_DB_LIMIT_MB"}
    STORAGE_STATUS_MESSAGES = {
        "normal": "Armazenamento funcionando normalmente.",
        "warning": "O sistema ainda esta funcionando normalmente. O banco de dados reutiliza espaco automaticamente apos exclusoes.",
        "high": "O armazenamento esta proximo do limite, mas isso nao significa erro imediato. O Supabase pode demorar um pouco para liberar espaco apos exclusoes.",
    }

    def _sync_local_offline_sidecars(self, source):
        if getattr(self.conn, "is_sqlite", False):
            refresh_local_sql_dump(self.storage.project_root)
            mark_local_offline_change(self.storage.project_root, source=source)
    STORAGE_STATUS_LABELS = {
        "normal": "Normal",
        "warning": "Atencao",
        "high": "Alto uso",
    }
    STORAGE_EXPLANATION = (
        "Quando dados sao removidos, o banco mantem o espaco reservado temporariamente "
        "para manter a estabilidade e performance. Esse espaco é reutilizado automaticamente."
    )
    STORAGE_UPDATE_NOTE = (
        "O tamanho pode demorar alguns minutos para atualizar após exclusões."
    )
    STORAGE_REORGANIZE_LABEL = "Reorganizar espaco do banco"
    STORAGE_REORGANIZE_MESSAGE = (
        "Executa VACUUM para melhorar a reutilizacao interna do espaco. "
        "O tamanho exibido pode nao diminuir imediatamente."
    )
    APP_ACTIVE_DATA_SIZE_SOURCES = (
        ("admins", "COALESCE(SUM(octet_length(raw_json)), 0)"),
        ("empresas", "COALESCE(SUM(octet_length(raw_json) + octet_length(COALESCE(credenciais_json, ''))), 0)"),
        ("constants", "COALESCE(SUM(octet_length(value_json) + octet_length(COALESCE(description, '')) + octet_length(key)), 0)"),
        ("materials", "COALESCE(SUM(octet_length(raw_json)), 0)"),
        ("machine_catalog", "COALESCE(SUM(octet_length(raw_json)), 0)"),
        ("acessorios", "COALESCE(SUM(octet_length(raw_json)), 0)"),
        ("dutos", "COALESCE(SUM(octet_length(raw_json)), 0)"),
        ("tubos", "COALESCE(SUM(octet_length(raw_json)), 0)"),
        ("obras", "COALESCE(SUM(octet_length(raw_json)), 0)"),
        ("projetos", "COALESCE(SUM(octet_length(raw_json)), 0)"),
        ("salas", "COALESCE(SUM(octet_length(raw_json)), 0)"),
        ("sala_maquinas", "COALESCE(SUM(octet_length(raw_json)), 0)"),
        ("sessions", "COALESCE(SUM(octet_length(payload_json)), 0)"),
        ("admin_email_config", "COALESCE(SUM(octet_length(email) + octet_length(token) + octet_length(nome) + octet_length(smtp_host) + octet_length(COALESCE(updated_at, ''))), 0)"),
        ("obra_notifications", "COALESCE(SUM(octet_length(fingerprint) + octet_length(last_subject) + octet_length(last_message) + octet_length(last_sent_at) + octet_length(obra_id)), 0)"),
    )

    def __init__(self, project_root):
        self.storage = get_storage(project_root)

    @property
    def conn(self):
        self.storage.refresh_connection_mode()
        return self.storage.conn

    @staticmethod
    def _bytes_to_mb(size_bytes):
        try:
            return round(float(size_bytes or 0) / (1024 * 1024), 2)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _normalize_numeric_value(value, fallback):
        try:
            normalized = float(value)
        except (TypeError, ValueError):
            normalized = float(fallback)

        if normalized <= 0:
            normalized = float(fallback)

        return int(normalized) if normalized.is_integer() else round(normalized, 2)

    def _fetch_public_schema_table_rows(self):
        return self.conn.execute(
            """
            SELECT
                relname AS table_name,
                pg_total_relation_size(relid) AS size_bytes
            FROM pg_catalog.pg_statio_user_tables
            WHERE schemaname = 'public'
            ORDER BY size_bytes DESC
            """
        ).fetchall()

    def _get_active_app_data_size_bytes(self):
        total_size_bytes = 0

        for table_name, size_expression in self.APP_ACTIVE_DATA_SIZE_SOURCES:
            row = self.conn.execute(
                f"SELECT {size_expression} AS size_bytes FROM {table_name}"
            ).fetchone()
            total_size_bytes += int((row or {}).get("size_bytes") or 0)

        return total_size_bytes

    def _normalize_constants(self, constants):
        normalized = {}

        for key, constant_data in (constants or {}).items():
            key_str = str(key or "").strip()
            if not key_str:
                continue
            if key_str in self.EXCLUDED_CONSTANT_KEYS:
                continue

            if isinstance(constant_data, dict):
                normalized[key_str] = dict(constant_data)
            else:
                normalized[key_str] = {
                    "value": constant_data,
                    "description": "",
                }

        return normalized

    def _resolve_storage_status(self, percent_used):
        normalized_percent = float(percent_used or 0)

        if normalized_percent >= 90:
            return "high"

        if normalized_percent >= 70:
            return "warning"

        return "normal"

    def _build_storage_status_payload(self, payload):
        usage_payload = dict(payload or {})
        status = self._resolve_storage_status(usage_payload.get("percent_used"))
        usage_payload.update(self._build_data_source_status_payload())

        usage_payload.update(
            {
                "status": status,
                "status_label": self.STORAGE_STATUS_LABELS[status],
                "message": usage_payload.get("message") or self.STORAGE_STATUS_MESSAGES[status],
                "explanation": self.STORAGE_EXPLANATION,
                "update_note": self.STORAGE_UPDATE_NOTE,
                "maintenance_available": usage_payload.get("maintenance_available", True),
                "maintenance_action_label": usage_payload.get("maintenance_action_label") or self.STORAGE_REORGANIZE_LABEL,
                "maintenance_message": usage_payload.get("maintenance_message") or self.STORAGE_REORGANIZE_MESSAGE,
            }
        )
        return usage_payload

    def _build_data_source_status_payload(self):
        using_local_database = bool(getattr(self.conn, "is_sqlite", False))
        pending_offline_changes = has_pending_local_offline_changes(
            self.storage.project_root
        )
        storage_guard = get_storage_guard_snapshot(self.storage.project_root)
        if pending_offline_changes or not using_local_database:
            try:
                storage_guard = evaluate_storage_guard(
                    self.storage.project_root,
                    conn=None if using_local_database else self.conn,
                )
            except Exception:
                storage_guard = {
                    "forced_offline": False,
                    "reason": "",
                }

        if using_local_database:
            mode = "offline"
            mode_label = "Offline"
            database_label = "Base local (SQLite)"
            summary = "Usando base local."
        else:
            mode = "online"
            mode_label = "Online"
            database_label = "Base online (PostgreSQL)"
            summary = "Usando base online."

        pending_sync_message = ""
        if pending_offline_changes:
            pending_sync_message = (
                "Alteracoes offline pendentes. Recomendado exportar antes de continuar."
            )
        elif storage_guard.get("forced_offline"):
            pending_sync_message = str(storage_guard.get("reason") or "").strip()

        return {
            "data_source_mode": mode,
            "data_source_label": mode_label,
            "database_label": database_label,
            "data_source_summary": summary,
            "pending_offline_changes": pending_offline_changes,
            "storage_guard_active": bool(storage_guard.get("forced_offline")),
            "pending_sync_message": pending_sync_message,
        }

    def get_dados_payload(self):
        payload = self.storage.load_document(
            "dados.json", self.storage.default_document("dados.json")
        )
        payload["constants"] = self._normalize_constants(payload.get("constants", {}))
        return payload

    def save_dados_payload(self, payload):
        if not isinstance(payload, dict):
            payload = {}

        payload = {
            **payload,
            "constants": self._normalize_constants(payload.get("constants", {})),
        }
        self.storage.save_document("dados.json", payload)
        return self.get_dados_payload()

    def save_admins(self, admins):
        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            cursor.execute("DELETE FROM admins")
            for index, admin in enumerate(admins or []):
                if not isinstance(admin, dict):
                    continue
                usuario = str(admin.get("usuario", "")).strip()
                token = str(admin.get("token", "")).strip()
                if not usuario or not token:
                    continue
                cursor.execute(
                    """
                    INSERT INTO admins(usuario, token, raw_json, sort_order)
                    VALUES(?, ?, ?, ?)
                    """,
                    (
                        usuario,
                        token,
                        json.dumps(admin, ensure_ascii=False),
                        index,
                    ),
                )
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._sync_local_offline_sidecars("system:save-admins")
        return admins

    def get_constants(self):
        return self._normalize_constants(self.get_dados_payload().get("constants", {}))

    def save_constants(self, constants):
        normalized_constants = self._normalize_constants(constants)
        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            cursor.execute("DELETE FROM constants")
            for key, constant_data in normalized_constants.items():
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
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._sync_local_offline_sidecars("system:save-constants")
        return normalized_constants

    def get_materials(self):
        return self.get_dados_payload().get("materials", {})

    def reorganize_storage(self):
        execute_maintenance_statements(
            self.storage.project_root,
            (
                "SET statement_timeout TO 0",
                "VACUUM (ANALYZE) public.obras",
                "VACUUM (ANALYZE) public.projetos",
                "VACUUM (ANALYZE) public.salas",
                "VACUUM (ANALYZE) public.sala_maquinas",
            ),
        )
        return {
            "success": True,
            "message": (
                "Rotina de reorganizacao executada com VACUUM. "
                "O espaco interno fica mais disponivel para reutilizacao automatica."
            ),
            "storage_status": self.get_storage_status(),
        }

    def vacuum_full_obras(self):
        return self.reorganize_storage()

    def get_storage_status(self, limit_mb=None):
        return self.get_database_usage(limit_mb=limit_mb)

    def get_database_usage(self, limit_mb=None):
        if getattr(self.conn, "is_sqlite", False):
            sqlite_path = get_database_path(self.storage.project_root)
            size_bytes = sqlite_path.stat().st_size if sqlite_path.exists() else 0
            used_mb = self._bytes_to_mb(size_bytes)
            limit_mb = self._normalize_numeric_value(
                limit_mb,
                self.DEFAULT_DATABASE_LIMIT_MB,
            )
            percent_used = round((used_mb / limit_mb) * 100, 2) if limit_mb else 0.0
            return self._build_storage_status_payload(
                {
                    "used_mb": used_mb,
                    "limit_mb": limit_mb,
                    "percent_used": percent_used,
                    "public_schema_mb": used_mb,
                    "active_app_mb": used_mb,
                    "active_app_percent_of_limit": percent_used,
                    "other_schemas_mb": 0.0,
                    "maintenance_available": False,
                    "maintenance_message": "Rotinas de reorganizacao sao aplicaveis apenas ao banco online.",
                }
            )

        row = self.conn.execute(
            """
            SELECT pg_database_size(current_database()) AS size_bytes
            """
        ).fetchone()
        table_rows = self._fetch_public_schema_table_rows()

        size_bytes = int((row or {}).get("size_bytes") or 0)
        public_schema_size_bytes = sum(
            int((table_row or {}).get("size_bytes") or 0)
            for table_row in (table_rows or [])
        )
        active_app_data_size_bytes = self._get_active_app_data_size_bytes()
        used_mb = self._bytes_to_mb(size_bytes)
        public_schema_mb = self._bytes_to_mb(public_schema_size_bytes)
        active_app_mb = self._bytes_to_mb(active_app_data_size_bytes)
        other_schemas_mb = max(round(used_mb - public_schema_mb, 2), 0.0)
        limit_mb = self._normalize_numeric_value(
            limit_mb,
            self.DEFAULT_DATABASE_LIMIT_MB,
        )
        percent_used = round((used_mb / limit_mb) * 100, 2) if limit_mb else 0.0
        active_app_percent_of_limit = (
            round((active_app_mb / limit_mb) * 100, 2) if limit_mb else 0.0
        )

        return self._build_storage_status_payload(
            {
                "used_mb": used_mb,
                "limit_mb": limit_mb,
                "percent_used": percent_used,
                "public_schema_mb": public_schema_mb,
                "active_app_mb": active_app_mb,
                "active_app_percent_of_limit": active_app_percent_of_limit,
                "other_schemas_mb": other_schemas_mb,
            }
        )

    def get_database_table_usage(self, limit_mb=None):
        rows = self._fetch_public_schema_table_rows()

        safe_limit_mb = self._normalize_numeric_value(
            limit_mb,
            self.DEFAULT_DATABASE_LIMIT_MB,
        )
        tables = []

        for row in rows or []:
            size_bytes = int((row or {}).get("size_bytes") or 0)
            size_mb = self._bytes_to_mb(size_bytes)
            percent_of_limit = (
                round((size_mb / safe_limit_mb) * 100, 2) if safe_limit_mb else 0.0
            )
            tables.append(
                {
                    "table_name": str((row or {}).get("table_name") or "").strip(),
                    "size_bytes": size_bytes,
                    "size_mb": size_mb,
                    "percent_of_limit": percent_of_limit,
                }
            )

        return {"tables": tables}

    def save_materials(self, materials):
        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            cursor.execute("DELETE FROM materials")
            for index, (key, material_data) in enumerate((materials or {}).items()):
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
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._sync_local_offline_sidecars("system:save-materials")
        return materials

    def save_acessorios(self, acessorios):
        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            cursor.execute("DELETE FROM acessorios")
            for index, (tipo, acessorio) in enumerate((acessorios or {}).items()):
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
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        return acessorios

    def save_dutos(self, dutos):
        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            cursor.execute("DELETE FROM dutos")
            for index, duto in enumerate(dutos or []):
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
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        return dutos

    def save_tubos(self, tubos):
        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            cursor.execute("DELETE FROM tubos")
            for index, tubo in enumerate(tubos or []):
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
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        return tubos
