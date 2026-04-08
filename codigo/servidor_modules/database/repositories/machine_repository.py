"""Repositório do catálogo de máquinas."""

from __future__ import annotations

import json

from servidor_modules.database.connection import (
    mark_local_offline_change,
    refresh_local_sql_dump,
)
from servidor_modules.database.storage import get_storage


class MachineRepository:
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

    def get_all(self):
        rows = self.conn.execute(
            "SELECT raw_json FROM machine_catalog ORDER BY sort_order, type"
        ).fetchall()
        return [json.loads(row["raw_json"]) for row in rows]

    def get_by_type(self, machine_type):
        row = self.conn.execute(
            "SELECT raw_json FROM machine_catalog WHERE type = ?",
            (str(machine_type),),
        ).fetchone()
        return json.loads(row["raw_json"]) if row else None

    def get_types(self):
        rows = self.conn.execute(
            "SELECT type FROM machine_catalog ORDER BY sort_order, type"
        ).fetchall()
        return [row["type"] for row in rows]

    def replace_all(self, machines):
        cursor = self.conn.cursor()
        cursor.execute("BEGIN")
        try:
            cursor.execute("DELETE FROM machine_catalog")
            for index, machine in enumerate(machines or []):
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
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._sync_local_offline_sidecars("machines:replace-all")
        return self.get_all()

    def add(self, machine):
        if not isinstance(machine, dict) or not machine.get("type"):
            raise ValueError("Tipo de máquina não especificado")

        dados = self.storage.load_document(
            "dados.json", self.storage.default_document("dados.json")
        )
        machines = list(dados.get("machines", []))
        machine_type = str(machine.get("type"))
        if any(str(existing.get("type")) == machine_type for existing in machines):
            raise ValueError(f"Máquina '{machine_type}' já existe")

        machines.append(machine)
        dados["machines"] = machines
        self.storage.save_document("dados.json", dados)
        return machine

    def update(self, machine):
        if not isinstance(machine, dict) or not machine.get("type"):
            raise ValueError("Tipo de máquina não especificado")

        dados = self.storage.load_document(
            "dados.json", self.storage.default_document("dados.json")
        )
        machines = list(dados.get("machines", []))
        machine_type = str(machine.get("type"))

        updated = False
        for index, existing in enumerate(machines):
            if str(existing.get("type")) == machine_type:
                machines[index] = machine
                updated = True
                break

        if not updated:
            raise ValueError(f"Máquina '{machine_type}' não encontrada")

        dados["machines"] = machines
        self.storage.save_document("dados.json", dados)
        return machine

    def delete(self, machine_type=None, index=None):
        dados = self.storage.load_document(
            "dados.json", self.storage.default_document("dados.json")
        )
        machines = list(dados.get("machines", []))

        machine_index = None
        if machine_type:
            machine_type = str(machine_type)
            for current_index, machine in enumerate(machines):
                if str(machine.get("type")) == machine_type:
                    machine_index = current_index
                    break

        if machine_index is None and index is not None:
            index = int(index)
            if 0 <= index < len(machines):
                machine_index = index

        if machine_index is None:
            raise ValueError(f"Máquina '{machine_type}' não encontrada")

        removed = machines.pop(machine_index)
        dados["machines"] = machines
        self.storage.save_document("dados.json", dados)
        return removed, machine_index
