"""
route_handler.py
Handler principal de rotas - Interface entre HTTP e Core
"""

import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import os
import time

class RouteHandler:
    """Manipula o roteamento de requisições HTTP"""
    
    def __init__(self, project_root, sessions_manager, file_utils, cache_cleaner):
        self.project_root = project_root
        self.sessions_manager = sessions_manager
        self.file_utils = file_utils
        self.cache_cleaner = cache_cleaner
        
        # RoutesCore será injetado depois para evitar import circular
        self.routes_core = None
    
    def set_routes_core(self, routes_core):
        """Define o RoutesCore após a inicialização para evitar import circular"""
        self.routes_core = routes_core

    # ========== ROTAS DE OBRAS ==========

    def handle_get_obras(self, handler):
        """GET /obras"""
        obras = self.routes_core.handle_get_obras()
        handler.send_json_response(obras)

    def handle_get_obra_by_id(self, handler, obra_id):
        """GET /obras/{id}"""
        obra = self.routes_core.handle_get_obra_by_id(obra_id)
        if obra:
            handler.send_json_response(obra)
        else:
            handler.send_error(404, f"Obra {obra_id} não encontrada")

    def handle_post_obras(self, handler):
        """POST /obras"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        obra = self.routes_core.handle_post_obras(post_data)
        if obra:
            handler.send_json_response(obra)
        else:
            handler.send_error(500, "Erro ao salvar obra")

    def handle_put_obra(self, handler):
        """PUT /obras/{id}"""
        obra_id = handler.path.split('/')[-1]
        content_length = int(handler.headers['Content-Length'])
        put_data = handler.rfile.read(content_length).decode('utf-8')
        
        obra = self.routes_core.handle_put_obra(obra_id, put_data)
        if obra:
            handler.send_json_response(obra)
        else:
            handler.send_error(404, f"Obra {obra_id} não encontrada")

    def handle_delete_obra(self, handler, obra_id):
        """DELETE /obras/{id}"""
        success = self.routes_core.handle_delete_obra(obra_id)
        if success:
            handler.send_json_response({
                "success": True,
                "message": f"Obra {obra_id} deletada com sucesso"
            })
        else:
            handler.send_error(500, "Erro ao deletar obra")

    # ========== ROTAS DE EMPRESAS ==========

    def handle_get_empresas(self, handler):
        """GET /api/dados/empresas"""
        empresas = self.routes_core.handle_get_empresas()
        handler.send_json_response(empresas)
        
    def handle_get_proximo_numero(self, handler, sigla):
        """GET /api/dados/empresas/numero/{sigla}"""
        numero = self.routes_core.handle_get_proximo_numero(sigla)
        handler.send_json_response(numero)

    def handle_post_empresas(self, handler):
        """POST /api/dados/empresas"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_empresas(post_data)
        handler.send_json_response(result)

    def handle_buscar_empresas(self, handler, termo):
        """GET /api/dados/empresas/buscar/{termo}"""
        result = self.routes_core.handle_buscar_empresas(termo)
        handler.send_json_response(result)

    # ========== ROTAS DE SESSÃO ==========

    def handle_get_sessions_current(self, handler):
        """GET /api/sessions/current"""
        session_data = self.routes_core.handle_get_sessions_current()
        handler.send_json_response(session_data)

    def handle_post_sessions_add_obra(self, handler):
        """POST /api/sessions/add-obra"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_sessions_add_obra(post_data)
        if result["success"]:
            handler.send_json_response(result)
        else:
            handler.send_error(500, result["error"])

    def handle_delete_sessions_remove_obra(self, handler, obra_id):
        """DELETE /api/sessions/remove-obra/{id}"""
        result = self.routes_core.handle_delete_sessions_remove_obra(obra_id)
        if result["success"]:
            handler.send_json_response(result)
        else:
            handler.send_error(500, result["error"])

    def handle_get_session_obras(self, handler):
        """GET /api/session-obras"""
        result = self.routes_core.handle_get_session_obras()
        handler.send_json_response(result)

    def handle_post_sessions_shutdown(self, handler):
        """POST /api/sessions/shutdown"""
        result = self.routes_core.handle_post_sessions_shutdown()
        handler.send_json_response(result)

    def handle_shutdown(self, handler):
        """POST /api/shutdown"""
        response = self.routes_core.handle_shutdown()
        handler.send_json_response(response)

    def handle_post_sessions_ensure_single(self, handler):
        """POST /api/sessions/ensure-single"""
        result = self.routes_core.handle_post_sessions_ensure_single()
        if result["success"]:
            handler.send_json_response(result)
        else:
            handler.send_error(500, result["error"])

    # ========== ROTAS DE SISTEMA ==========

    def handle_get_server_uptime(self, handler):
        """GET /api/server/uptime"""
        result = self.routes_core.handle_get_server_uptime()
        handler.send_json_response(result)

    def handle_get_constants(self, handler):
        """GET /constants"""
        constants = self.routes_core.handle_get_constants()
        handler.send_json_response(constants)

    def handle_get_machines(self, handler):
        """GET /machines"""
        machines = self.routes_core.handle_get_machines()
        handler.send_json_response(machines)

    def handle_get_dados(self, handler):
        """GET /dados"""
        dados = self.routes_core.handle_get_dados()
        handler.send_json_response(dados)

    def handle_get_backup(self, handler):
        """GET /backup"""
        backup = self.routes_core.handle_get_backup()
        handler.send_json_response(backup)

    def handle_get_backup_completo(self, handler):
        """GET /api/backup-completo"""
        backup = self.routes_core.handle_get_backup_completo()
        handler.send_json_response(backup)

    def handle_get_obras_catalog(self, handler):
        """GET /api/obras/catalog"""
        catalog = self.routes_core.handle_get_obras_catalog()
        handler.send_json_response(catalog)

    def handle_get_runtime_bootstrap(self, handler):
        """GET /api/runtime/bootstrap"""
        payload = self.routes_core.handle_get_runtime_bootstrap()
        handler.send_json_response(payload)

    def handle_post_dados(self, handler):
        """POST /dados"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_dados(post_data)
        handler.send_json_response(result)

    def handle_post_backup(self, handler):
        """POST /backup"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_backup(post_data)
        handler.send_json_response(result)

    def handle_post_reload_page(self, handler):
        """POST /api/reload-page"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_reload_page(post_data)
        handler.send_json_response(result)

    # ========== ROTAS DE COMPATIBILIDADE ==========

    def handle_get_projetos(self, handler):
        """GET /projetos (legacy)"""
        projetos = self.routes_core.handle_get_projetos()
        handler.send_json_response(projetos)

    def handle_post_projetos(self, handler):
        """POST /projetos (legacy)"""
        handler.send_error(501, "Use o endpoint /obras em vez de /projetos")

    def handle_get_session_projects(self, handler):
        """GET /api/session-projects (legacy)"""
        handler.send_json_response([])

    def handle_delete_sessions_remove_project(self, handler, project_id):
        """DELETE /api/sessions/remove-project/{id} (legacy)"""
        result = self.routes_core.handle_delete_sessions_remove_project(project_id)
        if result["success"]:
            handler.send_json_response(result)
        else:
            handler.send_error(500, result["error"])
        
    def handle_post_empresas_auto(self, handler):
        """POST /api/dados/empresas/auto"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_empresas_auto(post_data)
        handler.send_json_response(result)
        
    # ========== ROTA UNIVERSAL DELETE ==========
    
    def handle_delete_universal(self, handler):
        """DELETE /api/delete - Rota universal para deletar qualquer item"""
        result = self.routes_core.handle_delete_universal_from_handler(handler)
        handler.send_json_response(result)
        
    # ========== ROTAS PARA SISTEMA DE EDIÇÃO ==========

    def handle_get_system_data(self, handler):
        """GET /api/system-data - Retorna TODOS os dados do sistema"""
        system_data = self.routes_core.handle_get_system_data()
        handler.send_json_response(system_data)

    def handle_get_constants_json(self, handler):
        """GET /api/constants - Retorna apenas as constantes"""
        constants = self.routes_core.handle_get_constants_json()
        handler.send_json_response(constants)

    def handle_get_materials(self, handler):
        """GET /api/materials - Retorna materiais"""
        materials = self.routes_core.handle_get_materials()
        handler.send_json_response(materials)

    def handle_get_database_usage(self, handler):
        """GET /api/system/database-usage - Retorna uso total do banco"""
        payload = self.routes_core.handle_get_database_usage()
        handler.send_json_response(payload)

    def handle_get_storage_status(self, handler):
        """GET /system/storage-status - Retorna status amigavel do armazenamento"""
        payload = self.routes_core.handle_get_storage_status()
        handler.send_json_response(payload)

    def handle_get_database_table_usage(self, handler):
        """GET /api/system/database-usage/tables - Retorna uso por tabela"""
        payload = self.routes_core.handle_get_database_table_usage()
        handler.send_json_response(payload)

    def handle_post_storage_reorganize(self, handler):
        """POST /api/system/storage-status/reorganize - Executa VACUUM administrativo"""
        payload = self.routes_core.handle_post_storage_reorganize()
        status = 200 if payload.get("success") else 409
        handler.send_json_response(payload, status=status)

    def handle_post_database_vacuum_full_obras(self, handler):
        """POST /api/system/database-size/vacuum-obras - Compatibilidade para reorganizacao"""
        self.handle_post_storage_reorganize(handler)

    def handle_get_all_empresas(self, handler):
        """GET /api/empresas/all - Retorna todas empresas formatadas"""
        empresas = self.routes_core.handle_get_all_empresas()
        handler.send_json_response(empresas)

    def handle_get_machine_types(self, handler):
        """GET /api/machines/types - Retorna tipos de máquinas"""
        machine_types = self.routes_core.handle_get_machine_types()
        handler.send_json_response(machine_types)

    def handle_get_machine_by_type(self, handler, machine_type):
        """GET /api/machines/type/{type} - Retorna máquina específica"""
        machine = self.routes_core.handle_get_machine_by_type(machine_type)
        if machine:
            handler.send_json_response(machine)
        else:
            handler.send_error(404, f"Máquina tipo {machine_type} não encontrada")

    def handle_post_save_system_data(self, handler):
        """POST /api/system-data/save - Salva todos os dados"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_save_system_data(post_data)
        handler.send_json_response(result)

    def handle_post_import_online_to_offline(self, handler):
        """POST /api/system/offline/import - Importa online para offline local."""
        if os.environ.get("RENDER"):
            handler.send_json_response(
                {
                    "success": False,
                    "error": "A sincronizacao offline nao esta disponivel no ambiente Render.",
                },
                status=403,
            )
            return

        result = self.routes_core.handle_post_import_online_to_offline()
        status = 409 if result.get("conflict") else (200 if result.get("success") else 500)
        handler.send_json_response(result, status=status)

    def handle_post_export_offline_to_online(self, handler):
        """POST /api/system/offline/export - Exporta offline local para online."""
        if os.environ.get("RENDER"):
            handler.send_json_response(
                {
                    "success": False,
                    "error": "A sincronizacao offline nao esta disponivel no ambiente Render.",
                },
                status=403,
            )
            return

        result = self.routes_core.handle_post_export_offline_to_online()
        status = 409 if result.get("conflict") else (200 if result.get("success") else 500)
        handler.send_json_response(result, status=status)

    def handle_post_background_sync_offline(self, handler):
        """POST /api/system/offline/background-save - Atualiza snapshot local em segundo plano."""
        if os.environ.get("RENDER"):
            handler.send_json_response(
                {
                    "success": False,
                    "skipped": True,
                    "error": "Sincronizacao local indisponivel no Render.",
                },
                status=403,
            )
            return

        result = self.routes_core.handle_post_background_sync_offline()
        status = 200 if result.get("success") or result.get("skipped") else 500
        handler.send_json_response(result, status=status)

    def handle_post_reconcile_offline_online(self, handler):
        """POST /api/system/offline/reconcile - Reconcilia alteracoes offline e online."""
        if os.environ.get("RENDER"):
            handler.send_json_response(
                {
                    "success": False,
                    "skipped": True,
                    "error": "Sincronizacao local indisponivel no Render.",
                },
                status=403,
            )
            return

        result = self.routes_core.handle_post_reconcile_offline_online(
            mode="reconnect-monitor",
        )
        status = 200 if result.get("success") or result.get("skipped") else 500
        handler.send_json_response(result, status=status)

    def handle_post_save_constants(self, handler):
        """POST /api/constants/save - Salva constantes"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_save_constants(post_data)
        handler.send_json_response(result)

    def handle_post_save_materials(self, handler):
        """POST /api/materials/save - Salva materiais"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_save_materials(post_data)
        handler.send_json_response(result)

    def handle_post_save_empresas(self, handler):
        """POST /api/empresas/save - Salva empresas"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_save_empresas(post_data)
        handler.send_json_response(result)

    def handle_post_save_machines(self, handler):
        """POST /api/machines/save - Salva máquinas"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_save_machines(post_data)
        handler.send_json_response(result)

    def handle_post_add_machine(self, handler):
        """POST /api/machines/add - Adiciona nova máquina"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_add_machine(post_data)
        handler.send_json_response(result)

    def handle_post_update_machine(self, handler):
        """POST /api/machines/update - Atualiza máquina existente"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_update_machine(post_data)
        handler.send_json_response(result)

    # NOVO MÉTODO ADICIONADO
    def handle_post_delete_machine(self, handler):
        """POST /api/machines/delete - Deleta uma máquina"""
        content_length = int(handler.headers['Content-Length'])
        post_data = handler.rfile.read(content_length).decode('utf-8')
        
        result = self.routes_core.handle_post_delete_machine(post_data)
        handler.send_json_response(result)

    # ========== ROTAS EXISTENTES QUE PODEM FALTAR ==========

    def handle_health_check(self, handler):
        """GET /health-check"""
        handler.send_json_response({"status": "online", "timestamp": time.time()})
        
    def handle_delete_empresa(self, handler, index):
        """DELETE /api/empresas/{index}"""
        result = self.routes_core.handle_delete_empresa(index)
        handler.send_json_response(result)
        

    def handle_post_system_apply_json(self, handler):
        """POST /api/system/apply-json"""
        # Delegar para o handler HTTP
        handler.handle_post_system_apply_json()

    # ========== ROTAS PARA EQUIPAMENTOS ==========

    def handle_get_acessorios(self, handler):
        """GET /api/acessorios"""
        handler.handle_get_acessorios()

    def handle_get_acessorio_types(self, handler):
        """GET /api/acessorios/types"""
        handler.handle_get_acessorio_types()

    def handle_get_acessorio_dimensoes(self, handler):
        """GET /api/acessorios/dimensoes"""
        handler.handle_get_acessorio_dimensoes()

    def handle_get_acessorio_by_type(self, handler):
        """GET /api/acessorios/type/{type}"""
        handler.handle_get_acessorio_by_type()

    def handle_get_search_acessorios(self, handler):
        """GET /api/acessorios/search"""
        handler.handle_get_search_acessorios()

    def handle_post_add_acessorio(self, handler):
        """POST /api/acessorios/add"""
        handler.handle_post_add_acessorio()

    def handle_post_update_acessorio(self, handler):
        """POST /api/acessorios/update"""
        handler.handle_post_update_acessorio()

    def handle_post_delete_acessorio(self, handler):
        """POST /api/acessorios/delete"""
        handler.handle_post_delete_acessorio()
        
    # ========== ROTAS PARA DUTOS ==========
            
    def handle_get_dutos(self, handler):
        """GET /api/dutos"""
        handler.handle_get_dutos()

    def handle_get_duto_types(self, handler):
        """GET /api/dutos/types"""
        handler.handle_get_duto_types()

    def handle_get_duto_opcionais(self, handler):
        """GET /api/dutos/opcionais"""
        handler.handle_get_duto_opcionais()

    def handle_get_duto_by_type(self, handler):
        """GET /api/dutos/type/{type}"""
        handler.handle_get_duto_by_type()

    def handle_get_search_dutos(self, handler):
        """GET /api/dutos/search"""
        handler.handle_get_search_dutos()

    def handle_post_add_duto(self, handler):
        """POST /api/dutos/add"""
        handler.handle_post_add_duto()

    def handle_post_update_duto(self, handler):
        """POST /api/dutos/update"""
        handler.handle_post_update_duto()

    def handle_post_delete_duto(self, handler):
        """POST /api/dutos/delete"""
        handler.handle_post_delete_duto()
        
    # ========== ROTAS PARA TUBOS ==========

    def handle_get_tubos(self, handler):
        """GET /api/tubos"""
        handler.handle_get_tubos()

    def handle_get_tubo_polegadas(self, handler):
        """GET /api/tubos/polegadas"""
        handler.handle_get_tubo_polegadas()

    def handle_get_tubo_por_polegada(self, handler):
        """GET /api/tubos/polegada/{polegada}"""
        handler.handle_get_tubo_por_polegada()

    def handle_get_search_tubos(self, handler):
        """GET /api/tubos/search"""
        handler.handle_get_search_tubos()

    def handle_post_add_tubo(self, handler):
        """POST /api/tubos/add"""
        handler.handle_post_add_tubo()

    def handle_post_update_tubo(self, handler):
        """POST /api/tubos/update"""
        handler.handle_post_update_tubo()

    def handle_post_delete_tubo(self, handler):
        """POST /api/tubos/delete"""
        handler.handle_post_delete_tubo()
        
    
    def handle_get_word_models(self, handler):
        """GET /api/word/models"""
        handler.handle_get_word_models()

    def handle_get_word_templates(self, handler):
        """GET /api/word/templates"""
        handler.handle_get_word_templates()

    def handle_get_admin_email_config(self, handler):
        """GET /api/admin/email-config"""
        handler.handle_get_admin_email_config()

    def handle_generate_word_proposta_comercial(self, handler):
        """POST /api/word/generate/proposta-comercial"""
        handler.handle_generate_word_proposta_comercial()

    def handle_generate_word_proposta_tecnica(self, handler):
        """POST /api/word/generate/proposta-tecnica"""
        handler.handle_generate_word_proposta_tecnica()

    def handle_generate_word_ambos(self, handler):
        """POST /api/word/generate/ambos"""
        handler.handle_generate_word_ambos()

    def handle_download_word(self, handler):
        """GET /api/word/download"""
        handler.handle_download_word()
