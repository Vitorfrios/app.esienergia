"""Repositorio de obras e da estrutura hierarquica do backup."""

from __future__ import annotations

import json
from copy import deepcopy

from servidor_modules.database.connection import (
    has_empresas_numero_cliente_column,
    mark_local_offline_change,
    refresh_local_sql_dump,
)
from servidor_modules.database.storage import get_storage


class ObraRepository:
    def __init__(self, project_root):
        self.storage = get_storage(project_root)
        self.project_root = self.storage.project_root

    @property
    def conn(self):
        self.storage.refresh_connection_mode()
        return self.storage.conn

    def _sync_local_offline_sidecars(self, source):
        if getattr(self.conn, "is_sqlite", False):
            refresh_local_sql_dump(self.project_root)
            mark_local_offline_change(self.project_root, source=source)

    def _supports_numero_cliente_column(self):
        return has_empresas_numero_cliente_column(
            project_root=self.project_root,
            conn=self.conn,
        )

    def get_backup_payload(self):
        return {"obras": self.get_all()}

    def replace_backup_payload(self, payload):
        obras = []
        if isinstance(payload, dict):
            obras = [
                obra
                for obra in payload.get("obras", [])
                if isinstance(obra, dict) and str(obra.get("id", "")).strip()
            ]

        incoming_ids = [str(obra["id"]).strip() for obra in obras]

        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            if incoming_ids:
                placeholders = ", ".join(["?"] * len(incoming_ids))
                cursor.execute(
                    f"DELETE FROM obras WHERE id NOT IN ({placeholders})",
                    tuple(incoming_ids),
                )
            else:
                cursor.execute("DELETE FROM obras")

            for sort_order, obra in enumerate(obras):
                self._save_with_cursor(cursor, obra, sort_order=sort_order)

            self._sync_empresas_numero_cliente(cursor)

            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

        self._sync_local_offline_sidecars("obras:replace-backup")

        return self.get_backup_payload()

    def get_all(self):
        rows = self.conn.execute(
            "SELECT raw_json FROM obras ORDER BY sort_order, id"
        ).fetchall()
        return [json.loads(row["raw_json"]) for row in rows]

    def get_catalog(self):
        rows = self.conn.execute(
            """
            SELECT
                obras.id,
                obras.nome,
                obras.empresa_codigo,
                obras.empresa_id,
                obras.empresa_nome,
                obras.numero_cliente_final,
                obras.raw_json,
                obras.sort_order,
                COALESCE(project_totals.total_projetos, 0) AS total_projetos
            FROM obras
            LEFT JOIN (
                SELECT obra_id, COUNT(*) AS total_projetos
                FROM projetos
                GROUP BY obra_id
            ) AS project_totals ON project_totals.obra_id = obras.id
            ORDER BY obras.sort_order, obras.id
            """
        ).fetchall()
        return [self._build_catalog_entry(row) for row in rows]

    def get_by_id(self, obra_id):
        row = self.conn.execute(
            "SELECT raw_json FROM obras WHERE id = ?",
            (str(obra_id),),
        ).fetchone()
        return json.loads(row["raw_json"]) if row else None

    def save(self, obra):
        if not isinstance(obra, dict) or not obra.get("id"):
            raise ValueError("Obra invalida")

        obra_existente = self.get_by_id(obra.get("id"))
        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            self._save_with_cursor(cursor, obra)
            codigos_afetados = {
                str((obra_existente or {}).get("empresaSigla") or "").strip(),
                str(obra.get("empresaSigla") or "").strip(),
            }
            self._sync_empresas_numero_cliente(cursor, codigos_afetados)
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._sync_local_offline_sidecars("obras:save")
        return obra

    def delete(self, obra_id):
        obra_existente = self.get_by_id(obra_id)
        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            cursor.execute("DELETE FROM obras WHERE id = ?", (str(obra_id),))
            deleted = cursor.rowcount > 0
            codigo_empresa = str(
                (obra_existente or {}).get("empresaSigla") or ""
            ).strip()
            if codigo_empresa:
                self._sync_empresas_numero_cliente(cursor, [codigo_empresa])
            self.conn.commit()
            return deleted
        except Exception:
            self.conn.rollback()
            raise
        self._sync_local_offline_sidecars("obras:delete")

    def get_by_session_ids(self, obra_ids):
        ordered_ids = [str(obra_id) for obra_id in obra_ids if str(obra_id).strip()]
        if not ordered_ids:
            return []

        unique_ids = list(dict.fromkeys(ordered_ids))
        placeholders = ", ".join(["?"] * len(unique_ids))
        rows = self.conn.execute(
            f"SELECT id, raw_json FROM obras WHERE id IN ({placeholders})",
            tuple(unique_ids),
        ).fetchall()
        obras_by_id = {
            str(row["id"]): json.loads(row["raw_json"])
            for row in rows
        }
        return [obras_by_id[obra_id] for obra_id in ordered_ids if obra_id in obras_by_id]

    def get_next_numero_cliente(self, sigla):
        supports_numero_cliente_column = self._supports_numero_cliente_column()
        try:
            if supports_numero_cliente_column:
                row = self.conn.execute(
                    """
                    SELECT GREATEST(
                        COALESCE(
                            (
                                SELECT ultimo_numero_cliente
                                FROM empresas
                                WHERE codigo = ?
                            ),
                            0
                        ),
                        COALESCE((
                            SELECT COALESCE(numero_cliente_final, 0)
                            FROM obras
                            WHERE empresa_codigo = ?
                            ORDER BY numero_cliente_final DESC NULLS LAST
                            LIMIT 1
                        ), 0)
                    ) AS max_numero
                    """,
                    (str(sigla), str(sigla)),
                ).fetchone()
            else:
                row = self.conn.execute(
                    """
                    SELECT COALESCE((
                        SELECT COALESCE(numero_cliente_final, 0)
                        FROM obras
                        WHERE empresa_codigo = ?
                        ORDER BY numero_cliente_final DESC NULLS LAST
                        LIMIT 1
                    ), 0) AS max_numero
                    """,
                    (str(sigla),),
                ).fetchone()
        except Exception as exc:
            if "ultimo_numero_cliente" not in str(exc):
                raise
            row = self.conn.execute(
                """
                SELECT COALESCE((
                    SELECT COALESCE(numero_cliente_final, 0)
                    FROM obras
                    WHERE empresa_codigo = ?
                    ORDER BY numero_cliente_final DESC NULLS LAST
                    LIMIT 1
                ), 0) AS max_numero
                """,
                (str(sigla),),
            ).fetchone()
        max_numero = row["max_numero"] if row and row["max_numero"] is not None else 0
        if not supports_numero_cliente_column:
            max_numero = max(
                int(max_numero),
                self._get_empresa_numero_cliente_atual_from_json(str(sigla)),
            )
        return int(max_numero) + 1

    def delete_by_path(self, path_array):
        if not isinstance(path_array, list) or len(path_array) < 2 or str(path_array[0]) != "obras":
            return {
                "success": False,
                "error": "Path invalido. Deve comecar com ['obras', '<id>']",
                "path": path_array,
            }

        obra_id = str(path_array[1])
        if len(path_array) == 2:
            deleted = self.delete(obra_id)
            return {
                "success": True,
                "message": "Item deletado com sucesso" if deleted else "Item ja havia sido deletado",
                "path": path_array,
                "deleted_item": obra_id,
                "already_deleted": not deleted,
            }

        obra = self.get_by_id(obra_id)
        if obra is None:
            return {
                "success": False,
                "error": f"Obra '{obra_id}' nao encontrada",
                "path": path_array,
            }

        deleted_item = self._delete_nested_item(obra, path_array[2:])
        if deleted_item is _DELETE_NOT_FOUND:
            return {
                "success": False,
                "error": f"Item '{path_array[-1]}' nao encontrado",
                "path": path_array,
            }

        self.save(obra)
        return {
            "success": True,
            "message": "Item deletado com sucesso",
            "path": path_array,
            "deleted_item": str(path_array[-1]),
        }

    def _sync_empresas_numero_cliente(self, cursor, codigos=None):
        codigos_normalizados = [
            str(codigo).strip()
            for codigo in (codigos or [])
            if str(codigo or "").strip()
        ]

        if not self._supports_numero_cliente_column():
            self._sync_empresas_numero_cliente_json(cursor, codigos_normalizados)
            return

        try:
            if codigos_normalizados:
                placeholders = ", ".join(["?"] * len(codigos_normalizados))
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
                    tuple(codigos_normalizados),
                )
                return

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
        except Exception as exc:
            if "ultimo_numero_cliente" not in str(exc):
                raise
            self._sync_empresas_numero_cliente_json(cursor, codigos_normalizados)

    def _get_empresa_numero_cliente_atual_from_json(self, codigo):
        row = self.conn.execute(
            """
            SELECT raw_json
            FROM empresas
            WHERE codigo = ?
            """,
            (str(codigo),),
        ).fetchone()
        if not row or not row.get("raw_json"):
            return 0

        try:
            empresa = json.loads(row["raw_json"])
        except Exception:
            return 0

        try:
            return max(int(empresa.get("numeroClienteAtual") or 0), 0)
        except (TypeError, ValueError, AttributeError):
            return 0

    def _sync_empresas_numero_cliente_json(self, cursor, codigos=None):
        if codigos:
            placeholders = ", ".join(["?"] * len(codigos))
            rows = cursor.execute(
                f"""
                SELECT empresa_codigo, MAX(COALESCE(numero_cliente_final, 0)) AS max_numero_cliente
                FROM obras
                WHERE empresa_codigo IN ({placeholders})
                GROUP BY empresa_codigo
                """,
                tuple(codigos),
            ).fetchall()
        else:
            rows = cursor.execute(
                """
                SELECT empresa_codigo, MAX(COALESCE(numero_cliente_final, 0)) AS max_numero_cliente
                FROM obras
                WHERE COALESCE(empresa_codigo, '') <> ''
                GROUP BY empresa_codigo
                """
            ).fetchall()

        if not rows:
            return

        maximos_por_codigo = {
            str(row["empresa_codigo"]).strip(): int(row["max_numero_cliente"] or 0)
            for row in rows
            if str(row.get("empresa_codigo") or "").strip()
        }
        if not maximos_por_codigo:
            return

        placeholders = ", ".join(["?"] * len(maximos_por_codigo))
        empresas_rows = cursor.execute(
            f"""
            SELECT codigo, raw_json
            FROM empresas
            WHERE codigo IN ({placeholders})
            """,
            tuple(maximos_por_codigo.keys()),
        ).fetchall()

        for row in empresas_rows:
            codigo = str(row.get("codigo") or "").strip()
            if not codigo or not row.get("raw_json"):
                continue

            try:
                empresa = json.loads(row["raw_json"])
            except Exception:
                continue

            if not isinstance(empresa, dict):
                continue

            try:
                numero_atual = max(int(empresa.get("numeroClienteAtual") or 0), 0)
            except (TypeError, ValueError):
                numero_atual = 0

            novo_numero = max(numero_atual, maximos_por_codigo.get(codigo, 0))
            if novo_numero == numero_atual:
                continue

            empresa["numeroClienteAtual"] = novo_numero
            cursor.execute(
                """
                UPDATE empresas
                SET raw_json = ?
                WHERE codigo = ?
                """,
                (json.dumps(empresa, ensure_ascii=False), codigo),
            )

    def _save_with_cursor(self, cursor, obra, sort_order=None):
        obra_payload = deepcopy(obra)
        obra_id = str(obra_payload.get("id", "")).strip()
        if not obra_id:
            raise ValueError("Obra invalida")

        if sort_order is None:
            existing_row = cursor.execute(
                "SELECT sort_order FROM obras WHERE id = ?",
                (obra_id,),
            ).fetchone()
            if existing_row is not None:
                sort_order = int(existing_row["sort_order"])
            else:
                next_row = cursor.execute(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM obras"
                ).fetchone()
                sort_order = int(next_row["next_sort_order"])

        empresa_codigo = str(obra_payload.get("empresaSigla", "")).strip() or None
        empresa_nome = obra_payload.get("empresaNome")

        if empresa_codigo:
            cursor.execute(
                """
                INSERT INTO empresas(codigo, nome, credenciais_json, raw_json, sort_order)
                VALUES(?, ?, NULL, ?, 999999)
                ON CONFLICT(codigo) DO NOTHING
                """,
                (
                    empresa_codigo,
                    empresa_nome or empresa_codigo,
                    json.dumps(
                        {
                            "codigo": empresa_codigo,
                            "nome": empresa_nome or empresa_codigo,
                            "credenciais": None,
                        },
                        ensure_ascii=False,
                    ),
                ),
            )

        cursor.execute(
            """
            INSERT INTO obras(
                id, nome, empresa_codigo, empresa_id, empresa_nome,
                numero_cliente_final, raw_json, sort_order
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                nome = EXCLUDED.nome,
                empresa_codigo = EXCLUDED.empresa_codigo,
                empresa_id = EXCLUDED.empresa_id,
                empresa_nome = EXCLUDED.empresa_nome,
                numero_cliente_final = EXCLUDED.numero_cliente_final,
                raw_json = EXCLUDED.raw_json,
                sort_order = EXCLUDED.sort_order
            """,
            (
                obra_id,
                obra_payload.get("nome"),
                empresa_codigo,
                obra_payload.get("empresa_id"),
                empresa_nome,
                obra_payload.get("numeroClienteFinal"),
                json.dumps(obra_payload, ensure_ascii=False),
                sort_order,
            ),
        )

        cursor.execute(
            """
            DELETE FROM sala_maquinas
            WHERE sala_id IN (
                SELECT salas.id
                FROM salas
                INNER JOIN projetos ON salas.projeto_id = projetos.id
                WHERE projetos.obra_id = ?
            )
            """,
            (obra_id,),
        )
        cursor.execute(
            """
            DELETE FROM salas
            WHERE projeto_id IN (
                SELECT id
                FROM projetos
                WHERE obra_id = ?
            )
            """,
            (obra_id,),
        )
        cursor.execute("DELETE FROM projetos WHERE obra_id = ?", (obra_id,))

        for projeto_index, projeto in enumerate(obra_payload.get("projetos", [])):
            if not isinstance(projeto, dict):
                continue

            projeto_id = str(projeto.get("id") or f"{obra_id}::projeto::{projeto_index}")
            cursor.execute(
                """
                INSERT INTO projetos(id, obra_id, nome, raw_json, sort_order)
                VALUES(?, ?, ?, ?, ?)
                """,
                (
                    projeto_id,
                    obra_id,
                    projeto.get("nome"),
                    json.dumps(
                        {
                            "id": projeto_id,
                            "obra_id": obra_id,
                            "nome": projeto.get("nome"),
                        },
                        ensure_ascii=False,
                    ),
                    projeto_index,
                ),
            )

            for sala_index, sala in enumerate(projeto.get("salas", [])):
                if not isinstance(sala, dict):
                    continue

                sala_id = str(sala.get("id") or f"{projeto_id}::sala::{sala_index}")
                cursor.execute(
                    """
                    INSERT INTO salas(id, projeto_id, nome, raw_json, sort_order)
                    VALUES(?, ?, ?, ?, ?)
                    """,
                    (
                        sala_id,
                        projeto_id,
                        sala.get("nome"),
                        json.dumps(
                            {
                                "id": sala_id,
                                "projeto_id": projeto_id,
                                "nome": sala.get("nome"),
                            },
                            ensure_ascii=False,
                        ),
                        sala_index,
                    ),
                )

                for machine_index, machine in enumerate(sala.get("maquinas", [])):
                    if not isinstance(machine, dict):
                        continue

                    machine_id = str(
                        machine.get("id") or f"{sala_id}::machine::{machine_index}"
                    )
                    machine_type = machine.get("tipo") or machine.get("type")
                    cursor.execute(
                        """
                        INSERT INTO sala_maquinas(
                            id, sala_id, machine_type, raw_json, sort_order
                        )
                        VALUES(?, ?, ?, ?, ?)
                        """,
                        (
                            machine_id,
                            sala_id,
                            machine_type,
                            json.dumps(
                                {
                                    "id": machine_id,
                                    "sala_id": sala_id,
                                    "tipo": machine_type,
                                },
                                ensure_ascii=False,
                            ),
                            machine_index,
                        ),
                    )

    def _delete_nested_item(self, obra, path_parts):
        current = obra

        for key in path_parts[:-1]:
            current = self._resolve_path_step(current, key)
            if current is _DELETE_NOT_FOUND:
                return _DELETE_NOT_FOUND

        return self._remove_from_container(current, path_parts[-1])

    def _resolve_path_step(self, current, key):
        if isinstance(current, dict):
            return current.get(str(key), _DELETE_NOT_FOUND)

        if isinstance(current, list):
            item = self._find_list_item(current, key)
            if item is None:
                return _DELETE_NOT_FOUND
            return item

        return _DELETE_NOT_FOUND

    def _remove_from_container(self, current, key):
        if isinstance(current, dict):
            key_str = str(key)
            if key_str not in current:
                return _DELETE_NOT_FOUND
            return current.pop(key_str)

        if isinstance(current, list):
            try:
                item_index = int(key)
            except (TypeError, ValueError):
                item_index = None

            if item_index is not None:
                if 0 <= item_index < len(current):
                    return current.pop(item_index)
                return _DELETE_NOT_FOUND

            for index, item in enumerate(current):
                if isinstance(item, dict) and str(item.get("id", "")) == str(key):
                    return current.pop(index)

        return _DELETE_NOT_FOUND

    def _find_list_item(self, current, key):
        try:
            item_index = int(key)
        except (TypeError, ValueError):
            item_index = None

        if item_index is not None and 0 <= item_index < len(current):
            return current[item_index]

        for item in current:
            if isinstance(item, dict) and str(item.get("id", "")) == str(key):
                return item

        return None

    def _build_catalog_entry(self, row):
        raw_payload = json.loads(row["raw_json"]) if row.get("raw_json") else {}
        return {
            "id": str(row["id"]),
            "nome": row.get("nome"),
            "empresaSigla": row.get("empresa_codigo"),
            "empresaNome": row.get("empresa_nome"),
            "empresa_id": row.get("empresa_id"),
            "numeroClienteFinal": row.get("numero_cliente_final"),
            "idGerado": raw_payload.get("idGerado"),
            "dataCadastro": (
                raw_payload.get("dataCadastro")
                or raw_payload.get("criadoEm")
                or raw_payload.get("createdAt")
                or raw_payload.get("dataCriacao")
                or raw_payload.get("updatedAt")
            ),
            "totalProjetos": int(row.get("total_projetos") or 0),
            "isCatalogEntry": True,
        }


_DELETE_NOT_FOUND = object()
