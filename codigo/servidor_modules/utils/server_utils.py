"""
server_utils.py
Utilitarios do servidor - versao simplificada
"""

import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
os.environ.setdefault(
    "PYTHONPYCACHEPREFIX",
    str(Path(tempfile.gettempdir()) / "esi_python_cache"),
)
sys.dont_write_bytecode = True
if hasattr(sys, "pycache_prefix"):
    sys.pycache_prefix = os.environ["PYTHONPYCACHEPREFIX"]


class ServerUtils:
    """Utilitarios do servidor mantidos por compatibilidade."""

    @staticmethod
    def setup_signal_handlers():
        """Configura handlers de sinal."""
        try:
            signal.signal(signal.SIGINT, lambda s, f: print("\n Encerrando..."))
            signal.signal(signal.SIGTERM, lambda s, f: print("\n Encerrando..."))
            print(" Handlers de sinal configurados")
        except Exception as exc:
            print(f" Aviso na configuracao de sinais: {exc}")

    @staticmethod
    def print_server_info(port):
        """Exibe informacoes do servidor."""
        print("\n SERVIDOR INICIADO COM SUCESSO!")
        print("=" * 50)
        print(f" URL: http://localhost:{port}/admin/obras/create")
        print("=" * 50)

    @staticmethod
    def _find_app_browser_executable():
        """Tenta localizar um navegador Chromium para abrir em modo app."""
        candidates = []

        env_paths = [
            os.environ.get("PROGRAMFILES"),
            os.environ.get("PROGRAMFILES(X86)"),
            os.environ.get("LOCALAPPDATA"),
        ]

        browser_relative_paths = [
            ("Microsoft", "Edge", "Application", "msedge.exe"),
            ("Google", "Chrome", "Application", "chrome.exe"),
            ("BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        ]

        for base_dir in env_paths:
            if not base_dir:
                continue
            for relative_path in browser_relative_paths:
                candidate = Path(base_dir).joinpath(*relative_path)
                candidates.append(candidate)

        for candidate in candidates:
            if candidate.exists():
                return str(candidate)

        return None

    @staticmethod
    def _open_browser_app_window(url):
        """Abre a aplicacao em janela dedicada, mais amigavel para fechamento automatico."""
        if sys.platform != "win32":
            return False

        browser_executable = ServerUtils._find_app_browser_executable()
        if not browser_executable:
            return False

        temp_profile_dir = Path(tempfile.gettempdir()) / "esi-browser-profile"
        temp_profile_dir.mkdir(parents=True, exist_ok=True)

        command = [
            browser_executable,
            f"--app={url}",
            "--new-window",
            f"--user-data-dir={temp_profile_dir}",
        ]

        try:
            subprocess.Popen(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                close_fds=True,
            )
            print(" Janela da aplicacao aberta em modo app")
            return True
        except Exception as exc:
            print(f" Aviso ao abrir navegador em modo app: {exc}")
            return False

    @staticmethod
    def _should_use_app_browser_window():
        return str(os.environ.get("ESI_BROWSER_APP_MODE", "")).strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }

    @staticmethod
    def open_browser(port=8000):
        """Abre o navegador automaticamente."""
        time.sleep(2)

        url = f"http://localhost:{port}/admin/obras/create"
        print(f" Abrindo aplicacao: {url}")

        try:
            if ServerUtils._should_use_app_browser_window() and ServerUtils._open_browser_app_window(url):
                return

            import webbrowser

            webbrowser.open(url)
            print(" Navegador iniciado em modo padrao")
        except Exception as exc:
            print(f" Nao foi possivel abrir navegador automaticamente: {exc}")
            print(f" Acesse manualmente: {url}")

    @staticmethod
    def start_server_threads(port, httpd, monitor_function):
        """Inicia threads auxiliares."""
        try:
            browser_thread = threading.Thread(
                target=ServerUtils.open_browser,
                args=(port,),
                daemon=True,
            )
            browser_thread.start()

            monitor_thread = threading.Thread(
                target=monitor_function,
                args=(port, httpd),
                daemon=True,
            )
            monitor_thread.start()

            print("\n SISTEMA PRONTO!")
            print("   Aplicacao carregada no navegador")
            print("   Trabalhe normalmente - tudo e salvo automaticamente\n")
        except Exception as exc:
            print(f" Erro ao iniciar threads: {exc}")
