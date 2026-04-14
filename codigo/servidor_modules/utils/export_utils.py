"""Utilitários de exportação e envio de documentos."""

from __future__ import annotations

import base64
import json
import os
import shutil
import tempfile
import time
import zipfile
from email.utils import formataddr
from html import escape as html_escape
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request

from servidor_modules.handlers.word_handler import WordHandler
from servidor_modules.utils.admin_email_config import (
    AdminEmailConfigStore,
    get_resend_api_key,
    is_valid_email,
)


def build_resend_sender(sender_email, sender_name):
    """Resolve o remetente usado no fallback via Resend."""
    resolved_email = str(
        os.environ.get("RESEND_FROM_EMAIL")
        or os.environ.get("RESEND_FROM")
        or sender_email
        or "onboarding@resend.dev"
    ).strip()
    resolved_name = str(
        os.environ.get("RESEND_FROM_NAME")
        or sender_name
        or ""
    ).strip()

    return formataddr((resolved_name, resolved_email)) if resolved_name else resolved_email


def convert_message_to_simple_html(message_text):
    """Converte texto simples em HTML básico para provedores HTTP."""
    normalized = str(message_text or "").strip() or "Segue arquivo em anexo."
    lines = normalized.splitlines() or [normalized]
    return "".join(f"<p>{html_escape(line) or '&nbsp;'}</p>" for line in lines)


def send_via_resend(destino, assunto, mensagem, sender_email, sender_name, attachments=None):
    """Envia email via Resend como fallback HTTP."""
    api_key = get_resend_api_key()
    if not api_key:
        raise RuntimeError("API key do Resend não configurada.")

    destination = str(destino or "").strip()
    if not is_valid_email(destination):
        raise ValueError("Endereço de email de destino inválido")

    resend_payload = {
        "from": build_resend_sender(sender_email, sender_name),
        "to": [destination],
        "subject": str(assunto or "").strip() or "Exportação de obra",
        "text": str(mensagem or "").strip() or "Segue arquivo em anexo.",
        "html": convert_message_to_simple_html(mensagem),
    }

    reply_to_email = str(sender_email or "").strip()
    if reply_to_email and is_valid_email(reply_to_email):
        resend_payload["reply_to"] = reply_to_email

    normalized_attachments = normalize_attachment_files(attachments)
    if normalized_attachments:
        resend_payload["attachments"] = []
        for attachment in normalized_attachments:
            file_path = Path(str(attachment.get("path") or ""))
            filename = str(attachment.get("filename") or file_path.name).strip() or file_path.name
            file_bytes = read_verified_attachment_bytes(file_path)
            resend_payload["attachments"].append(
                {
                    "filename": filename,
                    "content": base64.b64encode(file_bytes).decode("ascii"),
                }
            )

    request_body = json.dumps(resend_payload).encode("utf-8")
    request_obj = urllib_request.Request(
        "https://api.resend.com/emails",
        data=request_body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "app-esienergia/1.0",
        },
        method="POST",
    )

    try:
        with urllib_request.urlopen(request_obj, timeout=30) as response:
            response_body = response.read().decode("utf-8", errors="replace")
            parsed_response = json.loads(response_body or "{}")
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(
                    f"Resend respondeu com status {response.status}: {response_body}"
                )
            return parsed_response
    except urllib_error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Resend rejeitou a requisição ({exc.code}): {response_body}"
        ) from exc
    except urllib_error.URLError as exc:
        raise RuntimeError(f"Falha de rede ao conectar no Resend: {exc}") from exc


def cleanup_temp_files(*paths):
    """Remove arquivos temporários silenciosamente."""
    for path in paths:
        if not path:
            continue
        try:
            if isinstance(path, (list, tuple, set)):
                cleanup_temp_files(*path)
                continue

            if isinstance(path, dict):
                cleanup_temp_files(path.get("path"))
                continue

            path_obj = Path(path)
            if path_obj.exists() and path_obj.is_file():
                path_obj.unlink()
        except Exception:
            continue


def read_verified_attachment_bytes(file_path, max_attempts=5, wait_seconds=0.25):
    """Lê o anexo e garante consistência de tamanho antes de enviá-lo."""
    attachment_path = Path(file_path)
    last_error = None

    for attempt in range(max_attempts):
        if not attachment_path.exists():
            last_error = FileNotFoundError(
                f"Arquivo de anexo não encontrado: {attachment_path}"
            )
        else:
            try:
                size_before = attachment_path.stat().st_size
                if size_before <= 0:
                    raise RuntimeError(
                        f"Arquivo de anexo vazio ou ainda não finalizado: {attachment_path}"
                    )

                with open(attachment_path, "rb") as file_obj:
                    file_bytes = file_obj.read()

                size_after = attachment_path.stat().st_size
                if len(file_bytes) == size_before == size_after:
                    return file_bytes

                last_error = RuntimeError(
                    "Leitura inconsistente do anexo: "
                    f"{attachment_path} (lido={len(file_bytes)}, antes={size_before}, depois={size_after})"
                )
            except Exception as exc:
                last_error = exc

        if attempt < max_attempts - 1:
            time.sleep(wait_seconds)

    raise last_error or RuntimeError(
        f"Não foi possível validar o anexo para envio: {attachment_path}"
    )


def duplicate_temp_file(source_path, output_filename=None):
    """Cria uma cópia temporária de um arquivo para uso paralelo em jobs distintos."""
    source = Path(source_path)
    if not source.exists():
        raise FileNotFoundError("Arquivo temporário não encontrado para duplicação")

    source_bytes = read_verified_attachment_bytes(source)
    suffix = source.suffix or ".tmp"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_file:
        tmp_file.write(source_bytes)
        tmp_file.flush()
        os.fsync(tmp_file.fileno())
        duplicate_path = tmp_file.name

    duplicate_size = Path(duplicate_path).stat().st_size
    if duplicate_size != len(source_bytes):
        cleanup_temp_files(duplicate_path)
        raise RuntimeError(
            "Falha ao criar cópia íntegra do anexo para envio: "
            f"{source.name} (origem={len(source_bytes)}, copia={duplicate_size})"
        )

    try:
        shutil.copystat(source, duplicate_path)
    except Exception:
        pass

    duplicate_name = output_filename or source.name
    return duplicate_path, duplicate_name


def duplicate_attachment_files(files):
    """Duplica uma lista de anexos temporários para uso paralelo."""
    duplicates = []

    for file_info in files or []:
        if not isinstance(file_info, dict):
            continue

        duplicate_path, duplicate_name = duplicate_temp_file(
            file_info.get("path"),
            file_info.get("filename"),
        )
        duplicates.append(
            {
                **file_info,
                "path": duplicate_path,
                "filename": duplicate_name,
            }
        )

    return duplicates


def format_currency_brl(value):
    """Formata número simples em moeda BRL."""
    try:
        numeric_value = float(value or 0)
    except (TypeError, ValueError):
        numeric_value = 0.0

    return f"R$ {numeric_value:,.2f}".replace(",", "X").replace(".", ",").replace(
        "X", "."
    )


def normalize_attachment_files(files):
    """Normaliza anexos para o formato interno padrão."""
    normalized_files = []

    for file_info in files or []:
        if isinstance(file_info, dict):
            file_path = file_info.get("path")
            filename = file_info.get("filename")
            template_type = file_info.get("template_type")
        elif isinstance(file_info, (list, tuple)) and len(file_info) >= 2:
            file_path = file_info[0]
            filename = file_info[1]
            template_type = file_info[2] if len(file_info) > 2 else ""
        else:
            continue

        if not file_path or not os.path.exists(file_path):
            continue

        normalized_files.append(
            {
                "path": file_path,
                "filename": filename or Path(file_path).name,
                "template_type": template_type or "",
            }
        )

    return normalized_files


def create_zip_bundle(files, output_filename=None):
    """Compacta anexos em um ZIP temporário para envio íntegro por email."""
    normalized_files = normalize_attachment_files(files)
    if not normalized_files:
        raise FileNotFoundError("Nenhum arquivo válido encontrado para compactação")

    zip_name = str(output_filename or "").strip()
    if not zip_name:
        if len(normalized_files) == 1:
            zip_name = f"{Path(normalized_files[0]['filename']).stem}.zip"
        else:
            zip_name = "exportacao_anexos.zip"
    elif not zip_name.lower().endswith(".zip"):
        zip_name = f"{zip_name}.zip"

    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp_file:
        zip_path = tmp_file.name

    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for file_info in normalized_files:
                file_path = Path(str(file_info.get("path") or ""))
                filename = str(file_info.get("filename") or file_path.name).strip() or file_path.name
                file_bytes = read_verified_attachment_bytes(file_path)
                zip_file.writestr(filename, file_bytes)

        if Path(zip_path).stat().st_size <= 0:
            raise RuntimeError("Falha ao gerar ZIP temporário para envio por email")

        return zip_path, zip_name
    except Exception:
        cleanup_temp_files(zip_path)
        raise


def prepare_email_attachments(attachment_files):
    """Prepara anexos para email, compactando DOCX em ZIP para preservar integridade."""
    attachments = normalize_attachment_files(attachment_files)
    if not attachments:
        return [], []

    has_docx = any(
        Path(str(file_info.get("filename") or file_info.get("path") or "")).suffix.lower()
        == ".docx"
        for file_info in attachments
    )

    if not has_docx:
        return attachments, []

    zip_filename = (
        f"{Path(attachments[0]['filename']).stem}.zip"
        if len(attachments) == 1
        else "exportacao_documentos.zip"
    )
    zip_path, bundle_name = create_zip_bundle(attachments, zip_filename)
    return [build_export_file(zip_path, bundle_name, "zip_bundle")], [zip_path]


def enviar_email(destino, assunto, mensagem, attachment_files=None):
    """Envia um email usando a configuração do ADM via Resend."""
    config_store = AdminEmailConfigStore()
    config = config_store.load()

    if not config_store.is_configured(config):
        raise RuntimeError(
            "Configuração de email do ADM não encontrada ou RESEND_API ausente."
        )

    destination = str(destino or "").strip()
    if not is_valid_email(destination):
        raise ValueError("Endereço de email de destino inválido")

    attachments = normalize_attachment_files(attachment_files)
    sender_email = str(config.get("email") or "").strip()
    sender_name = str(config.get("nome") or "").strip() or sender_email

    send_via_resend(
        destino=destination,
        assunto=str(assunto or "").strip() or "Exportação de obra",
        mensagem=mensagem,
        sender_email=sender_email,
        sender_name=sender_name,
        attachments=attachments,
    )


def enviar_email_com_anexos(destino, assunto, mensagem, attachment_files):
    """Envia um email com anexos diretos usando a configuração do ADM via Resend."""
    attachments, temp_paths = prepare_email_attachments(attachment_files)
    if not attachments:
        raise FileNotFoundError("Nenhum arquivo válido encontrado para envio")

    try:
        return enviar_email(destino, assunto, mensagem, attachments)
    finally:
        cleanup_temp_files(*temp_paths)


def enviar_email_com_zip(destino, assunto, mensagem, zip_path):
    """Compatibilidade: encaminha anexos diretos em vez de ZIP."""
    return enviar_email_com_anexos(
        destino,
        assunto,
        mensagem,
        [{"path": zip_path, "filename": Path(zip_path).name}],
    )


def build_export_file(file_path, filename, template_type=""):
    """Cria estrutura padrão de arquivo exportado."""
    return {
        "path": file_path,
        "filename": filename,
        "template_type": str(template_type or "").strip(),
    }


def prepare_export_assets(project_root, file_utils, obra_id, formato, need_download, need_email):
    """Gera os arquivos necessários para um fluxo de exportação."""
    export_format = str(formato or "ambos").strip().lower()
    if export_format not in {"pc", "pt", "ambos"}:
        raise ValueError("Formato de exportação inválido")

    word_handler = WordHandler(project_root, file_utils)
    obra_data = word_handler.get_obra_data(obra_id)

    if export_format == "ambos":
        files, error = word_handler.generate_selected_documents(obra_id, export_format)
        if error:
            raise RuntimeError(error)
    elif export_format == "pc":
        file_path, filename, error = word_handler.generate_proposta_comercial_avancada(
            obra_id
        )
        files = [build_export_file(file_path, filename, "comercial")]
    else:
        file_path, filename, error = word_handler.generate_proposta_tecnica_avancada(
            obra_id
        )
        files = [build_export_file(file_path, filename, "tecnica")]

    if error:
        raise RuntimeError(error)

    files = normalize_attachment_files(files)
    if not files:
        raise RuntimeError("Arquivo de exportação não foi gerado")

    return {
        "obra_data": obra_data,
        "download_files": files if need_download else [],
        "email_files": files if need_email else [],
    }
