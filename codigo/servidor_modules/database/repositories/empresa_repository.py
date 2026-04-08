"""Repositorio de empresas."""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from servidor_modules.database.connection import (
    has_empresas_numero_cliente_column,
    mark_local_offline_change,
    refresh_local_sql_dump,
)
from servidor_modules.database.storage import get_storage, normalize_empresa


class EmpresaRepository:
    def __init__(self, project_root):
        self.storage = get_storage(project_root)
        self.project_root = self.storage.project_root

    @property
    def conn(self):
        self.storage.refresh_connection_mode()
        return self.storage.conn

    def _supports_numero_cliente_column(self):
        return has_empresas_numero_cliente_column(
            project_root=self.project_root,
            conn=self.conn,
        )

    def _sync_local_offline_sidecars(self, source):
        if getattr(self.conn, "is_sqlite", False):
            refresh_local_sql_dump(self.project_root)
            mark_local_offline_change(self.project_root, source=source)

    @staticmethod
    def _normalize_numero_cliente_atual(value):
        try:
            numero = int(value)
        except (TypeError, ValueError):
            return 0
        return max(numero, 0)

    def _hydrate_empresa_row(self, row):
        empresa = json.loads(row["raw_json"])
        if isinstance(empresa, dict):
            empresa["numeroClienteAtual"] = max(
                self._normalize_numero_cliente_atual(
                    empresa.get("numeroClienteAtual")
                ),
                self._normalize_numero_cliente_atual(
                    row.get("ultimo_numero_cliente")
                ),
            )
        return empresa

    def _refresh_last_numero_cliente(self, codigos=None):
        if not self._supports_numero_cliente_column():
            return

        filtros = [
            str(codigo).strip()
            for codigo in (codigos or [])
            if str(codigo or "").strip()
        ]

        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            if filtros:
                placeholders = ", ".join(["?"] * len(filtros))
                cursor.execute(
                    f"""
                    UPDATE empresas AS empresas_destino
                    SET ultimo_numero_cliente = GREATEST(
                        COALESCE(empresas_destino.ultimo_numero_cliente, 0),
                        COALESCE(obras_agrupadas.max_numero_cliente, 0)
                    )
                    FROM (
                        SELECT
                            empresa_codigo,
                            MAX(COALESCE(numero_cliente_final, 0)) AS max_numero_cliente
                        FROM obras
                        WHERE empresa_codigo IN ({placeholders})
                        GROUP BY empresa_codigo
                    ) AS obras_agrupadas
                    WHERE empresas_destino.codigo = obras_agrupadas.empresa_codigo
                    """,
                    tuple(filtros),
                )
            else:
                cursor.execute(
                    """
                    UPDATE empresas AS empresas_destino
                    SET ultimo_numero_cliente = GREATEST(
                        COALESCE(empresas_destino.ultimo_numero_cliente, 0),
                        COALESCE(obras_agrupadas.max_numero_cliente, 0)
                    )
                    FROM (
                        SELECT
                            empresa_codigo,
                            MAX(COALESCE(numero_cliente_final, 0)) AS max_numero_cliente
                        FROM obras
                        WHERE COALESCE(empresa_codigo, '') <> ''
                        GROUP BY empresa_codigo
                    ) AS obras_agrupadas
                    WHERE empresas_destino.codigo = obras_agrupadas.empresa_codigo
                    """
                )
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def get_all(self):
        try:
            if self._supports_numero_cliente_column():
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
        return [self._hydrate_empresa_row(row) for row in rows]

    def get_public(self):
        empresas = []
        for empresa in self.get_all():
            empresa_normalizada = normalize_empresa(empresa)
            if not empresa_normalizada:
                continue
            empresas.append(
                {
                    "codigo": empresa_normalizada.get("codigo", ""),
                    "nome": empresa_normalizada.get("nome", ""),
                }
            )
        return empresas

    def exists_by_codigo(self, codigo):
        codigo_normalizado = str(codigo or "").strip()
        if not codigo_normalizado:
            return False

        row = self.conn.execute(
            "SELECT 1 AS found FROM empresas WHERE codigo = ? LIMIT 1",
            (codigo_normalizado,),
        ).fetchone()
        return bool(row)

    def get_login_record(self, usuario):
        usuario_normalizado = str(usuario or "").strip().lower()
        if not usuario_normalizado:
            return None

        row = self.conn.execute(
            """
            SELECT codigo, nome, credenciais_json, raw_json
            FROM empresas
            WHERE LOWER(COALESCE(credenciais_json, '')) LIKE ?
            ORDER BY sort_order, codigo
            """,
            (f'%\"usuario\": \"{usuario_normalizado}\"%',),
        ).fetchall()

        for candidate in row:
            credenciais = None
            empresa = None

            raw_credenciais = candidate.get("credenciais_json")
            if raw_credenciais:
                try:
                    credenciais = json.loads(raw_credenciais)
                except Exception:
                    credenciais = None

            raw_empresa = candidate.get("raw_json")
            if raw_empresa:
                try:
                    empresa = json.loads(raw_empresa)
                except Exception:
                    empresa = None

            if not isinstance(credenciais, dict):
                continue

            empresa_usuario = str(credenciais.get("usuario") or "").strip().lower()
            if empresa_usuario != usuario_normalizado:
                continue

            return {
                "codigo": str(candidate.get("codigo") or "").strip(),
                "nome": str(candidate.get("nome") or "").strip(),
                "credenciais": credenciais,
                "empresa": empresa if isinstance(empresa, dict) else None,
            }

        return None

    def replace_all(self, empresas):
        normalized_empresas = []
        for empresa in empresas or []:
            empresa_normalizada = normalize_empresa(empresa)
            if empresa_normalizada and empresa_normalizada.get("codigo"):
                normalized_empresas.append(empresa_normalizada)

        incoming_codes = {
            str(empresa["codigo"]).strip()
            for empresa in normalized_empresas
            if str(empresa.get("codigo", "")).strip()
        }

        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            supports_numero_cliente = self._supports_numero_cliente_column()
            for index, empresa in enumerate(normalized_empresas):
                codigo = str(empresa.get("codigo", "")).strip()
                if supports_numero_cliente:
                    cursor.execute(
                        """
                        INSERT INTO empresas(
                            codigo, nome, ultimo_numero_cliente, credenciais_json, raw_json, sort_order
                        )
                        VALUES(?, ?, ?, ?, ?, ?)
                        ON CONFLICT(codigo) DO UPDATE SET
                            nome = EXCLUDED.nome,
                            ultimo_numero_cliente = EXCLUDED.ultimo_numero_cliente,
                            credenciais_json = EXCLUDED.credenciais_json,
                            raw_json = EXCLUDED.raw_json,
                            sort_order = EXCLUDED.sort_order
                        """,
                        (
                            codigo,
                            str(empresa.get("nome", "")).strip(),
                            self._normalize_numero_cliente_atual(
                                empresa.get("numeroClienteAtual")
                            ),
                            json.dumps(empresa.get("credenciais"), ensure_ascii=False)
                            if empresa.get("credenciais") is not None
                            else None,
                            json.dumps(empresa, ensure_ascii=False),
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
                        ON CONFLICT(codigo) DO UPDATE SET
                            nome = EXCLUDED.nome,
                            credenciais_json = EXCLUDED.credenciais_json,
                            raw_json = EXCLUDED.raw_json,
                            sort_order = EXCLUDED.sort_order
                        """,
                        (
                            codigo,
                            str(empresa.get("nome", "")).strip(),
                            json.dumps(empresa.get("credenciais"), ensure_ascii=False)
                            if empresa.get("credenciais") is not None
                            else None,
                            json.dumps(empresa, ensure_ascii=False),
                            index,
                        ),
                    )

            if incoming_codes:
                placeholders = ", ".join(["?"] * len(incoming_codes))
                cursor.execute(
                    f"DELETE FROM empresas WHERE codigo NOT IN ({placeholders})",
                    tuple(incoming_codes),
                )
            else:
                cursor.execute("DELETE FROM empresas")

            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._sync_local_offline_sidecars("empresas:replace-all")
        self._refresh_last_numero_cliente(incoming_codes if incoming_codes else None)
        return self.get_all()

    def add(self, empresa):
        empresa_normalizada = normalize_empresa(empresa)
        if not empresa_normalizada or not empresa_normalizada.get("codigo"):
            raise ValueError("Estrutura de empresa invalida")

        dados = self.storage.load_document(
            "dados.json", self.storage.default_document("dados.json")
        )
        empresas = list(dados.get("empresas", []))
        if any(
            normalize_empresa(item)
            and normalize_empresa(item).get("codigo") == empresa_normalizada["codigo"]
            for item in empresas
        ):
            raise ValueError(
                f"Empresa com sigla {empresa_normalizada['codigo']} ja existe"
            )

        empresas.append(empresa_normalizada)
        dados["empresas"] = empresas
        self.storage.save_document("dados.json", dados)
        return empresa_normalizada

    def search(self, termo):
        termo_normalizado = str(termo or "").strip().upper()
        if not termo_normalizado:
            return []

        resultados = []
        for empresa in self.get_all():
            empresa_normalizada = normalize_empresa(empresa)
            if not empresa_normalizada:
                continue

            codigo = empresa_normalizada.get("codigo", "")
            nome = empresa_normalizada.get("nome", "")
            primeiro_nome = nome.split(" ")[0].upper() if nome else ""
            nome_upper = nome.upper()

            if (
                codigo == termo_normalizado
                or primeiro_nome.startswith(termo_normalizado)
                or termo_normalizado in nome_upper
            ):
                resultados.append(empresa_normalizada)

        return resultados

    def upsert_recovery_email(self, codigo, nome, email):
        codigo_normalizado = str(codigo or "").strip()
        nome_normalizado = str(nome or "").strip()
        email_normalizado = str(email or "").strip()

        if not codigo_normalizado or not email_normalizado:
            return False

        empresa = self.get_by_codigo(codigo_normalizado)
        if empresa is None:
            empresa = {
                "codigo": codigo_normalizado,
                "nome": nome_normalizado or codigo_normalizado,
                "credenciais": {"email": email_normalizado},
            }
        else:
            credenciais = empresa.get("credenciais")
            if not isinstance(credenciais, dict):
                credenciais = {}
            else:
                credenciais = dict(credenciais)

            if str(credenciais.get("email") or "").strip() == email_normalizado:
                return False

            credenciais["email"] = email_normalizado
            empresa["credenciais"] = credenciais
            if nome_normalizado and not empresa.get("nome"):
                empresa["nome"] = nome_normalizado

        self._upsert_empresa(empresa)
        return True

    def upsert_credentials(
        self,
        codigo,
        nome="",
        *,
        usuario="",
        token="",
        email="",
        tempo_uso=None,
        data_criacao="",
        data_expiracao="",
    ):
        codigo_normalizado = str(codigo or "").strip()
        nome_normalizado = str(nome or "").strip()
        usuario_normalizado = str(usuario or "").strip()
        token_normalizado = str(token or "").strip()
        email_normalizado = str(email or "").strip()
        data_criacao_normalizada = str(data_criacao or "").strip()
        data_expiracao_normalizada = str(data_expiracao or "").strip()

        if not codigo_normalizado:
            return False

        should_sync_credentials = bool(usuario_normalizado)
        should_sync_email = bool(email_normalizado)

        if not should_sync_credentials and not should_sync_email:
            return False

        try:
            tempo_uso_normalizado = (
                int(tempo_uso) if tempo_uso not in (None, "", False) else None
            )
        except (TypeError, ValueError):
            tempo_uso_normalizado = None

        empresa = self.get_by_codigo(codigo_normalizado) or {
            "codigo": codigo_normalizado,
            "nome": nome_normalizado or codigo_normalizado,
            "credenciais": None,
        }

        credenciais = empresa.get("credenciais")
        if not isinstance(credenciais, dict):
            credenciais = {}
        else:
            credenciais = dict(credenciais)

        if should_sync_email:
            credenciais["email"] = email_normalizado

        if should_sync_credentials:
            credenciais["usuario"] = usuario_normalizado
            credenciais["token"] = token_normalizado

        if tempo_uso_normalizado is not None:
            credenciais["tempoUso"] = tempo_uso_normalizado
        elif should_sync_credentials and not credenciais.get("tempoUso"):
            credenciais["tempoUso"] = 30

        if data_criacao_normalizada:
            credenciais["data_criacao"] = data_criacao_normalizada
        elif should_sync_credentials and not credenciais.get("data_criacao"):
            credenciais["data_criacao"] = datetime.now().isoformat()

        if data_expiracao_normalizada:
            credenciais["data_expiracao"] = data_expiracao_normalizada
        elif should_sync_credentials and not credenciais.get("data_expiracao"):
            try:
                base_date = datetime.fromisoformat(
                    str(credenciais.get("data_criacao") or datetime.now().isoformat())
                )
            except ValueError:
                base_date = datetime.now()

            validade_dias = int(credenciais.get("tempoUso") or 30)
            credenciais["data_expiracao"] = (
                base_date + timedelta(days=validade_dias)
            ).isoformat()

        empresa["credenciais"] = credenciais or None
        if nome_normalizado and not empresa.get("nome"):
            empresa["nome"] = nome_normalizado

        self._upsert_empresa(empresa)
        return True

    def get_by_codigo(self, codigo):
        try:
            if self._supports_numero_cliente_column():
                row = self.conn.execute(
                    """
                    SELECT raw_json, ultimo_numero_cliente
                    FROM empresas
                    WHERE codigo = ?
                    """,
                    (str(codigo),),
                ).fetchone()
            else:
                row = self.conn.execute(
                    """
                    SELECT raw_json, 0 AS ultimo_numero_cliente
                    FROM empresas
                    WHERE codigo = ?
                    """,
                    (str(codigo),),
                ).fetchone()
        except Exception as exc:
            if "ultimo_numero_cliente" not in str(exc):
                raise
            row = self.conn.execute(
                """
                SELECT raw_json, 0 AS ultimo_numero_cliente
                FROM empresas
                WHERE codigo = ?
                """,
                (str(codigo),),
            ).fetchone()
        return self._hydrate_empresa_row(row) if row else None

    def _upsert_empresa(self, empresa, sort_order=None):
        empresa_normalizada = normalize_empresa(empresa)
        if not empresa_normalizada or not empresa_normalizada.get("codigo"):
            raise ValueError("Estrutura de empresa invalida")

        codigo = str(empresa_normalizada.get("codigo", "")).strip()
        if sort_order is None:
            existing_row = self.conn.execute(
                "SELECT sort_order FROM empresas WHERE codigo = ?",
                (codigo,),
            ).fetchone()
            if existing_row is not None:
                sort_order = int(existing_row["sort_order"])
            else:
                next_row = self.conn.execute(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM empresas"
                ).fetchone()
                sort_order = int(next_row["next_sort_order"])

        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            if self._supports_numero_cliente_column():
                cursor.execute(
                    """
                    INSERT INTO empresas(
                        codigo, nome, ultimo_numero_cliente, credenciais_json, raw_json, sort_order
                    )
                    VALUES(?, ?, ?, ?, ?, ?)
                    ON CONFLICT(codigo) DO UPDATE SET
                        nome = EXCLUDED.nome,
                        ultimo_numero_cliente = EXCLUDED.ultimo_numero_cliente,
                        credenciais_json = EXCLUDED.credenciais_json,
                        raw_json = EXCLUDED.raw_json,
                        sort_order = EXCLUDED.sort_order
                    """,
                    (
                        codigo,
                        str(empresa_normalizada.get("nome", "")).strip(),
                        self._normalize_numero_cliente_atual(
                            empresa_normalizada.get("numeroClienteAtual")
                        ),
                        json.dumps(
                            empresa_normalizada.get("credenciais"), ensure_ascii=False
                        )
                        if empresa_normalizada.get("credenciais") is not None
                        else None,
                        json.dumps(empresa_normalizada, ensure_ascii=False),
                        sort_order,
                    ),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO empresas(
                        codigo, nome, credenciais_json, raw_json, sort_order
                    )
                    VALUES(?, ?, ?, ?, ?)
                    ON CONFLICT(codigo) DO UPDATE SET
                        nome = EXCLUDED.nome,
                        credenciais_json = EXCLUDED.credenciais_json,
                        raw_json = EXCLUDED.raw_json,
                        sort_order = EXCLUDED.sort_order
                    """,
                    (
                        codigo,
                        str(empresa_normalizada.get("nome", "")).strip(),
                        json.dumps(
                            empresa_normalizada.get("credenciais"), ensure_ascii=False
                        )
                        if empresa_normalizada.get("credenciais") is not None
                        else None,
                        json.dumps(empresa_normalizada, ensure_ascii=False),
                        sort_order,
                    ),
                )
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._sync_local_offline_sidecars("empresas:upsert")
        self._refresh_last_numero_cliente([codigo])
        return empresa_normalizada
