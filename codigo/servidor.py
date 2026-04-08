"""
servidor.py
Servidor principal 
"""

import os
import shutil
import sys
import time
import tempfile
from pathlib import Path


# Impede bytecode mesmo quando este arquivo for importado
# ou executado sem passar por setup_environment().
os.environ.setdefault('PYTHONDONTWRITEBYTECODE', '1')
os.environ.setdefault('PYTHONPYCACHEPREFIX', str(Path(tempfile.gettempdir()) / 'esi_python_cache'))
os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
sys.dont_write_bytecode = True
if hasattr(sys, 'pycache_prefix'):
    sys.pycache_prefix = os.environ['PYTHONPYCACHEPREFIX']


def configure_console_encoding():
    """Torna stdout/stderr seguros para logs Unicode no executavel Windows."""
    for stream_name in ('stdout', 'stderr'):
        stream = getattr(sys, stream_name, None)
        if stream is None or not hasattr(stream, 'reconfigure'):
            continue
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass


configure_console_encoding()


def ensure_desktop_shortcut():
    """Cria ou atualiza um atalho na Area de Trabalho para o executavel empacotado."""
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return

    target_path = Path(sys.executable).resolve()
    shortcut_name = "ESI Energia.lnk"

    try:
        import win32com.client

        shell = win32com.client.Dispatch("WScript.Shell")
        desktop_path = Path(shell.SpecialFolders("Desktop"))
        shortcut_path = desktop_path / shortcut_name

        should_write_shortcut = True
        if shortcut_path.exists():
            try:
                existing_shortcut = shell.CreateShortcut(str(shortcut_path))
                existing_target = Path(str(existing_shortcut.Targetpath or "")).resolve()
                existing_workdir = Path(str(existing_shortcut.WorkingDirectory or "")).resolve()
                if existing_target == target_path and existing_workdir == target_path.parent.resolve():
                    should_write_shortcut = False
            except Exception:
                should_write_shortcut = True

        if not should_write_shortcut:
            return

        shortcut = shell.CreateShortcut(str(shortcut_path))
        shortcut.Targetpath = str(target_path)
        shortcut.WorkingDirectory = str(target_path.parent)
        shortcut.Description = "Iniciar sistema ESI Energia"
        shortcut.IconLocation = f"{target_path},0"
        shortcut.Save()
        print(f" Atalho da Area de Trabalho pronto: {shortcut_path}")
    except Exception as exc:
        print(f" Aviso ao criar atalho da Area de Trabalho: {exc}")


def cleanup_python_caches(base_dir):
    """Remove caches Python residuais do projeto."""
    base_path = Path(base_dir)

    for pycache_dir in base_path.rglob('__pycache__'):
        shutil.rmtree(pycache_dir, ignore_errors=True)

    for pattern in ('*.pyc', '*.pyo'):
        for cache_file in base_path.rglob(pattern):
            try:
                cache_file.unlink()
            except FileNotFoundError:
                pass

def setup_environment():
    """Configuração do ambiente """
    current_dir = Path(__file__).parent
    sys.path.insert(0, str(current_dir))
    
    # DESATIVA CACHES DO PYTHON
    os.environ['PYTHONDONTWRITEBYTECODE'] = '1'  # Não gera .pyc
    os.environ.setdefault('PYTHONPYCACHEPREFIX', str(Path(tempfile.gettempdir()) / 'esi_python_cache'))
    os.environ['PYTHONOPTIMIZE'] = '1'
    
    # Desativa cache de importação
    sys.dont_write_bytecode = True
    if hasattr(sys, 'pycache_prefix'):
        sys.pycache_prefix = os.environ['PYTHONPYCACHEPREFIX']
    cleanup_python_caches(current_dir)

def load_modules_no_cache():
    """Carrega módulos """
    try:
        # Force reload para evitar cache de módulos
        if 'servidor_modules.core.server_core' in sys.modules:
            del sys.modules['servidor_modules.core.server_core']
        if 'servidor_modules.handlers.http_handler' in sys.modules:
            del sys.modules['servidor_modules.handlers.http_handler']
        if 'servidor_modules.utils.browser_monitor' in sys.modules:
            del sys.modules['servidor_modules.utils.browser_monitor']
        
        from servidor_modules.core.server_core import ServerCore
        from servidor_modules.handlers.http_handler import UniversalHTTPRequestHandler
        from servidor_modules.utils.browser_monitor import monitorar_navegador
        
        return ServerCore, UniversalHTTPRequestHandler, monitorar_navegador
    except ImportError as e:
        print(f"❌ Erro ao carregar módulos: {e}")
        sys.exit(1)

def initialize_server():
    """Inicialização do servidor """
    print(" INICIANDO SERVIDOR ")
    start_time = time.time()
    
    # Limpa possíveis caches na inicialização
    import gc
    gc.collect()
    
    # Carrega módulos
    ServerCore, UniversalHTTPRequestHandler, monitorar_navegador = load_modules_no_cache()
    
    # Cria núcleo do servidor
    server_core = ServerCore()
    
    from servidor_modules.database.connection import (
        start_connection_warmup,
    )

    print(" Verificando conexao com o banco online por ate 15 segundos...")
    start_connection_warmup(server_core.project_root)
    
    # Configura porta
    print(" Configurando porta...")
    port = server_core.setup_port(8000)
    if not port:
        print("❌ Não foi possível encontrar porta disponível")
        sys.exit(1)
    
    # Cria servidor
    print(" Criando servidor HTTP...")
    try:
        httpd = server_core.create_server(port, UniversalHTTPRequestHandler)
    except Exception as e:
        print(f"❌ Erro ao criar servidor: {e}")
        sys.exit(1)
    
    # Configura handlers de sinal
    server_core.setup_signal_handlers()
    
    # Exibe informações
    server_core.print_server_info(port)
    
    # Inicia threads
    server_core.start_server_threads(port, httpd, monitorar_navegador)
    
    # Tempo de inicialização
    init_time = time.time() - start_time
    print(f"⚡ Servidor  iniciado em {init_time:.2f} segundos")
    
    return httpd, server_core

def run_server():
    """Loop principal do servidor """
    httpd, server_core = initialize_server()
    
    try:
        print(" Servidor em execução ()...")
        
        while server_core.servidor_rodando:
            try:
                httpd.handle_request()
            except KeyboardInterrupt:
                print("\n⏹️  Interrupção pelo usuário")
                break
            except Exception as e:
                if "Broken pipe" not in str(e) and "Connection reset" not in str(e):
                    print(f"⚠️  Erro não crítico: {e}")
                continue
        
    except Exception as e:
        print(f"❌ Erro no servidor: {e}")
    
    finally:
        shutdown_server(httpd, server_core)

def shutdown_server(httpd, server_core):
    """Encerramento do servidor"""
    print("\n🔴 Encerrando servidor...")
    
    try:
        # Encerra servidor sem limpeza de cache (já que não usamos)
        server_core.shutdown_server_async(httpd, None)  # Passa None para cache_cleaner
        
        print("✅ Servidor encerrado com sucesso")
        
    except Exception as e:
        print(f"⚠️  Aviso no encerramento: {e}")
    
    finally:
        sys.exit(0)

if __name__ == "__main__":
    # Configura ambiente 
    setup_environment()
    ensure_desktop_shortcut()
    
    # Inicia servidor
    run_server()
