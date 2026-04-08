"""
server_core.py
Núcleo principal do servidor - Lógica centralizada
"""

import socket
import socketserver
import threading
import time
import signal
import sys
import subprocess
import os
import tempfile
from pathlib import Path

os.environ.setdefault('PYTHONDONTWRITEBYTECODE', '1')
os.environ.setdefault('PYTHONPYCACHEPREFIX', str(Path(tempfile.gettempdir()) / 'esi_python_cache'))
sys.dont_write_bytecode = True
if hasattr(sys, 'pycache_prefix'):
    sys.pycache_prefix = os.environ['PYTHONPYCACHEPREFIX']

class ServerCore:
    """Núcleo principal do servidor com todas as funcionalidades essenciais"""
    
    def __init__(self):
        self.servidor_rodando = True
        self.project_root = self._find_project_root()
        self.is_production = bool(os.environ.get("RENDER"))
        
    def _find_project_root(self):
        """Encontra a raiz do projeto"""
        current_dir = Path(__file__).parent.parent.parent
        return current_dir

    def is_port_in_use(self, port):
        """Verifica se uma porta está em uso"""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            try:
                s.bind(('localhost', port))
                return False
            except socket.error:
                return True

    def kill_process_on_port(self, port):
        """Tenta finalizar processos na porta"""
        try:
            if sys.platform == "win32":
                result = subprocess.run(
                    ['netstat', '-ano'], 
                    capture_output=True, 
                    text=True,
                    encoding='utf-8',
                    errors='ignore'
                )
                
                for line in result.stdout.split('\n'):
                    if f':{port}' in line and 'LISTENING' in line:
                        parts = line.split()
                        if len(parts) >= 5:
                            pid = parts[-1]
                            if pid.isdigit():
                                try:
                                    subprocess.run(
                                        ['taskkill', '/PID', pid, '/F'], 
                                        capture_output=True,
                                        timeout=5
                                    )
                                    time.sleep(1)
                                    if not self.is_port_in_use(port):
                                        return True
                                except subprocess.TimeoutExpired:
                                    pass
                                except Exception as e:
                                    pass
            return False
        except Exception as e:
            return False

    def find_available_port(self, start_port=8000, max_attempts=15):
        """Encontra uma porta disponível"""
        for port in range(start_port, start_port + max_attempts):
            if not self.is_port_in_use(port):
                return port
        
        import random
        for attempt in range(10):
            port = random.randint(8000, 9000)
            if not self.is_port_in_use(port):
                return port
        
        return None

    def setup_port(self, default_port):
        """Configura a porta do servidor"""
        env_port = str(os.environ.get("PORT") or "").strip()
        if env_port.isdigit():
            return int(env_port)

        if not self.is_port_in_use(default_port):
            return default_port
        
        if self.kill_process_on_port(default_port):
            time.sleep(2)
            if not self.is_port_in_use(default_port):
                return default_port
        
        available_port = self.find_available_port(default_port)
        
        if available_port:
            return available_port
        else:
            return None

    def setup_signal_handlers(self):
        """Configura handlers de sinal"""
        try:
            signal.signal(signal.SIGINT, self.signal_handler)
            signal.signal(signal.SIGTERM, self.signal_handler)
        except Exception as e:
            pass

    def signal_handler(self, signum, frame):
        """Manipulador de sinais do sistema"""
        self.servidor_rodando = False

    def create_server(self, port, handler_class):
        """Cria instância do servidor"""
        try:
            class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
                allow_reuse_address = True
                daemon_threads = True

            server = ThreadingHTTPServer(("", port), handler_class)
            server.timeout = 1  # 1 segundo timeout
            return server
        except Exception as e:
            raise

    def print_server_info(self, port):
        """Exibe informações do servidor"""
        print(f"\n SERVIDOR INICIADO COM SUCESSO!")
        print("=" * 50)
        if self.is_production:
            print(f" PORTA: {port}")
            print(" MODO: producao")
        else:
            print(f" URL: http://localhost:{port}/admin/obras/create")
        print("=" * 50)

    def _find_app_browser_executable(self):
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

    def _open_browser_app_window(self, url):
        """Abre a aplicacao em janela dedicada, mais amigavel para fechamento automatico."""
        if sys.platform != "win32":
            return False

        browser_executable = self._find_app_browser_executable()
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

    def open_browser(self, port=8000):
        """Abre o navegador automaticamente"""
        if self.is_production:
            return
        time.sleep(2)
        
        url = f"http://localhost:{port}/admin/obras/create"
        
        try:
            if self._open_browser_app_window(url):
                return

            import webbrowser
            webbrowser.open(url)
            print(" Navegador iniciado em modo padrao")
        except Exception as e:
            print(f"Acesse manualmente: {url}")

    def start_server_threads(self, port, httpd, monitor_function):
        """Inicia threads auxiliares"""
        try:
            if self.is_production:
                return
            browser_thread = threading.Thread(target=self.open_browser, args=(port,), daemon=True)
            browser_thread.start()
            
            monitor_thread = threading.Thread(target=monitor_function, args=(port, httpd), daemon=True)
            monitor_thread.start()
            
        except Exception as e:
            pass

    def run_server_loop(self, httpd):
        """Loop principal do servidor"""
        while self.servidor_rodando:
            try:
                httpd.handle_request()
            except socket.timeout:
                continue  
            except KeyboardInterrupt:
                self.servidor_rodando = False
                break
            except Exception as e:
                if self.servidor_rodando:
                    time.sleep(1)
                    continue
                else:
                    break

    def shutdown_server_async(self, httpd, cache_cleaner):
        """Desligamento graceful do servidor"""
        def shutdown_task():
            try:
                httpd.shutdown()
                httpd.server_close()
                
                # Limpeza de cache
                cache_cleaner.clean_pycache_async()
                
            except Exception as e:
                pass
        
        shutdown_thread = threading.Thread(target=shutdown_task, daemon=True)
        shutdown_thread.start()
        
        shutdown_thread.join(timeout=5.0)
        
        if shutdown_thread.is_alive():
            try:
                httpd.server_close()
            except:
                pass
