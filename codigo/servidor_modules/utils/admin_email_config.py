"""Persistencia e resolucao da configuracao administrativa de email via Resend."""

from __future__ import annotations

import json
import os
import re
from copy import deepcopy
from pathlib import Path

from servidor_modules.database.connection import get_connection


EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

DEFAULT_EMAIL_CONFIG = {
    "email": "",
    "nome": "",
    "updatedAt": None,
}


def get_resend_api_key():
    """Obtem a API key do Resend a partir do ambiente."""
    return str(
        os.environ.get("resend_API")
        or os.environ.get("RESEND_API")
        or os.environ.get("RESEND_API_KEY")
        or ""
    ).strip()


def get_resend_from_email():
    """Obtem o remetente padrao do Resend a partir do ambiente."""
    return str(
        os.environ.get("RESEND_FROM_EMAIL")
        or os.environ.get("RESEND_FROM")
        or ""
    ).strip()


def get_resend_from_name():
    """Obtem o nome padrao do remetente a partir do ambiente."""
    return str(os.environ.get("RESEND_FROM_NAME") or "").strip()


def is_valid_email(value):
    """Valida um endereco de email simples."""
    return bool(EMAIL_REGEX.match(str(value or "").strip()))


class AdminEmailConfigStore:
    """Le e grava a configuracao administrativa de envio por email."""

    def __init__(self, project_root=None):
        self.project_root = (
            Path(project_root)
            if project_root is not None
            else Path(__file__).resolve().parents[2]
        )
        self.file_path = self.project_root / "json" / "admin_email_config.json"
        self.conn = get_connection(self.project_root)
        self.config_key = "default"

    @staticmethod
    def _row_value(row, key, default=""):
        if row is None:
            return default
        try:
            if isinstance(row, dict):
                return row.get(key, default)
            if hasattr(row, "keys") and key in row.keys():
                return row[key]
        except Exception:
            return default
        return default

    def _normalize_payload(self, payload):
        payload = payload if isinstance(payload, dict) else {}
        normalized = deepcopy(DEFAULT_EMAIL_CONFIG)

        normalized["email"] = str(
            payload.get("email")
            or payload.get("adminEmail")
            or payload.get("usuario")
            or ""
        ).strip()
        normalized["nome"] = str(
            payload.get("nome") or payload.get("adminNome") or ""
        ).strip()
        normalized["updatedAt"] = payload.get("updatedAt") or payload.get("updated_at")
        return normalized

    def _apply_env_fallback(self, config):
        normalized = self._normalize_payload(config)
        if not normalized["email"]:
            normalized["email"] = get_resend_from_email()
        if not normalized["nome"]:
            normalized["nome"] = get_resend_from_name() or "ESI Energia"
        return normalized

    def load(self):
        try:
            row = self.conn.execute(
                """
                SELECT *
                FROM admin_email_config
                WHERE config_key = ?
                """,
                (self.config_key,),
            ).fetchone()

            if row is not None:
                return self._apply_env_fallback(
                    {
                        "email": self._row_value(row, "email", ""),
                        "nome": self._row_value(row, "nome", ""),
                        "updatedAt": self._row_value(row, "updated_at"),
                    }
                )
        except Exception:
            pass

        migrated_config = self._migrate_legacy_json_if_available()
        if migrated_config is not None:
            return self._apply_env_fallback(migrated_config)

        return self._apply_env_fallback(DEFAULT_EMAIL_CONFIG)

    def save(self, payload):
        normalized = self._normalize_payload(payload)
        self.conn.execute(
            """
            INSERT INTO admin_email_config(
                config_key,
                email,
                nome,
                updated_at
            )
            VALUES(?, ?, ?, ?)
            ON CONFLICT(config_key) DO UPDATE SET
                email = excluded.email,
                nome = excluded.nome,
                updated_at = excluded.updated_at
            """,
            (
                self.config_key,
                normalized["email"],
                normalized["nome"],
                normalized["updatedAt"],
            ),
        )
        self.conn.commit()
        self._remove_legacy_json_file()
        return normalized

    def _migrate_legacy_json_if_available(self):
        if not self.file_path.exists():
            return None

        try:
            with open(self.file_path, "r", encoding="utf-8") as file_obj:
                payload = json.load(file_obj)
        except Exception:
            return None

        normalized = self._normalize_payload(payload)
        self.save(normalized)
        return normalized

    def _remove_legacy_json_file(self):
        try:
            if self.file_path.exists():
                self.file_path.unlink()
        except Exception:
            pass

    def is_configured(self, config=None):
        loaded_config = self._apply_env_fallback(config or self.load())
        email = str(loaded_config.get("email") or "").strip()
        return bool(email and is_valid_email(email) and get_resend_api_key())

    def resolve_delivery_mode(self, config=None):
        loaded_config = self._apply_env_fallback(config or self.load())
        if not is_valid_email(loaded_config.get("email")):
            return "unconfigured"
        if get_resend_api_key():
            return "resend"
        return "unconfigured"
