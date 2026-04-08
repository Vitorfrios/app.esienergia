# servidor_modules/core/routes_core.py

"""
routes_core.py
Núcleo das rotas - Divisão lógica das funcionalidades
"""

import json
import time
import threading
from pathlib import Path

from servidor_modules.database.repositories.empresa_repository import EmpresaRepository
from servidor_modules.database.repositories.machine_repository import MachineRepository
from servidor_modules.database.repositories.obra_repository import ObraRepository
from servidor_modules.database.repositories.system_repository import SystemRepository

_OFFLINE_SYNC_LOG_LOCK = threading.Lock()
_OFFLINE_SYNC_LOG_MESSAGE = ""
_OFFLINE_SYNC_LOG_AT = 0.0


def _log_offline_sync_status_once(message, *, min_interval_seconds=30.0):
    global _OFFLINE_SYNC_LOG_MESSAGE, _OFFLINE_SYNC_LOG_AT

    normalized_message = str(message or "").strip()
    if not normalized_message:
        return

    now = time.monotonic()
    with _OFFLINE_SYNC_LOG_LOCK:
        if (
            normalized_message == _OFFLINE_SYNC_LOG_MESSAGE
            and (now - _OFFLINE_SYNC_LOG_AT) < float(min_interval_seconds)
        ):
            return

        _OFFLINE_SYNC_LOG_MESSAGE = normalized_message
        _OFFLINE_SYNC_LOG_AT = now

    print(normalized_message)


class RoutesCore:
    """Núcleo das funcionalidades de rotas organizadas por categoria"""

    def __init__(self, project_root, sessions_manager, file_utils, cache_cleaner):
        self.project_root = project_root
        self.sessions_manager = sessions_manager
        self.file_utils = file_utils
        self.cache_cleaner = cache_cleaner

        # Inicializa EmpresaHandler com file_utils injetado
        from servidor_modules.handlers.empresa_handler import EmpresaHandler

        self.empresa_handler = EmpresaHandler(file_utils=self.file_utils)
        self.empresa_repository = EmpresaRepository(self.project_root)
        self.obra_repository = ObraRepository(self.project_root)
        self.machine_repository = MachineRepository(self.project_root)
        self.system_repository = SystemRepository(self.project_root)

    # ========== ROTAS DE OBRAS ==========

    def handle_get_obras(self):
        """Obtém todas as obras da sessão atual"""
        try:
            print(" [OBRAS] Obtendo obras da sessão")

            current_session_id = self.sessions_manager.get_current_session_id()
            session_data = self.sessions_manager._load_sessions_data()
            session_obra_ids = (
                session_data["sessions"].get(current_session_id, {}).get("obras", [])
            )
            obras_da_sessao = self.obra_repository.get_by_session_ids(session_obra_ids)

            print(f" ENVIANDO: {len(obras_da_sessao)} obras da sessão")
            return obras_da_sessao

        except Exception as e:
            print(f"ERRO em handle_get_obras: {str(e)}")
            return []

    def handle_get_obra_by_id(self, obra_id):
        """Obtém uma obra específica por ID"""
        try:
            print(f" [OBRA POR ID] Buscando obra {obra_id}")

            obra = self.obra_repository.get_by_id(obra_id)
            if obra:
                print(f"Obra {obra_id} encontrada")
                return obra

            print(f"Obra {obra_id} não encontrada")
            return None

        except Exception as e:
            print(f"ERRO em handle_get_obra_by_id: {str(e)}")
            return None

    def handle_post_obras(self, post_data):
        """Salva nova obra e adiciona à sessão com verificação de empresa"""
        try:
            nova_obra = json.loads(post_data)
            empresa_credenciais = nova_obra.pop("empresaCredenciais", None)

            print("[OBRA] Verificando se precisa criar empresa automaticamente...")
            nova_obra = self.empresa_handler.verificar_e_criar_empresa_automatica(
                nova_obra
            )

            email_empresa = str(nova_obra.get("emailEmpresa") or "").strip()
            if email_empresa or (
                isinstance(empresa_credenciais, dict)
                and str(empresa_credenciais.get("usuario") or "").strip()
            ):
                self.empresa_repository.upsert_credentials(
                    nova_obra.get("empresaSigla"),
                    nova_obra.get("empresaNome"),
                    usuario=str(empresa_credenciais.get("usuario") or "").strip()
                    if isinstance(empresa_credenciais, dict)
                    else "",
                    token=str(empresa_credenciais.get("token") or "").strip()
                    if isinstance(empresa_credenciais, dict)
                    else "",
                    email=email_empresa,
                    tempo_uso=(empresa_credenciais or {}).get("tempoUso")
                    if isinstance(empresa_credenciais, dict)
                    else None,
                    data_criacao=str(
                        (empresa_credenciais or {}).get("data_criacao") or ""
                    ).strip()
                    if isinstance(empresa_credenciais, dict)
                    else "",
                    data_expiracao=str(
                        (empresa_credenciais or {}).get("data_expiracao") or ""
                    ).strip()
                    if isinstance(empresa_credenciais, dict)
                    else "",
                )

            obra_id = nova_obra.get("id")

            if not obra_id or obra_id.isdigit():
                import random

                letters = "abcdefghjkmnpqrstwxyz"
                random_letter1 = random.choice(letters)
                random_num = random.randint(10, 99)
                obra_id = f"obra_{random_letter1}{random_num}"
                print(f"Backend gerou ID seguro: {obra_id}")

            nova_obra["id"] = obra_id

            print(f"Tentando adicionar obra {obra_id} à sessão...")
            success = self.sessions_manager.add_obra_to_session(obra_id)

            if not success:
                print(f"FALHA ao adicionar obra {obra_id} à sessão")
                return None

            print(f"ADICIONANDO nova obra ID: {obra_id}")
            self.obra_repository.save(nova_obra)
            print(f"Obra {obra_id} salva com sucesso")
            return nova_obra

        except Exception as e:
            print(f"Erro ao adicionar obra: {str(e)}")
            return None

    def handle_put_obra(self, obra_id, put_data):
        """Atualiza obra existente com verificação de empresa"""
        try:
            obra_atualizada = json.loads(put_data)
            empresa_credenciais = obra_atualizada.pop("empresaCredenciais", None)

            print(
                "[OBRA UPDATE] Verificando se precisa criar empresa automaticamente..."
            )
            obra_atualizada = self.empresa_handler.verificar_e_criar_empresa_automatica(
                obra_atualizada
            )

            email_empresa = str(obra_atualizada.get("emailEmpresa") or "").strip()
            if email_empresa or (
                isinstance(empresa_credenciais, dict)
                and str(empresa_credenciais.get("usuario") or "").strip()
            ):
                self.empresa_repository.upsert_credentials(
                    obra_atualizada.get("empresaSigla"),
                    obra_atualizada.get("empresaNome"),
                    usuario=str(empresa_credenciais.get("usuario") or "").strip()
                    if isinstance(empresa_credenciais, dict)
                    else "",
                    token=str(empresa_credenciais.get("token") or "").strip()
                    if isinstance(empresa_credenciais, dict)
                    else "",
                    email=email_empresa,
                    tempo_uso=(empresa_credenciais or {}).get("tempoUso")
                    if isinstance(empresa_credenciais, dict)
                    else None,
                    data_criacao=str(
                        (empresa_credenciais or {}).get("data_criacao") or ""
                    ).strip()
                    if isinstance(empresa_credenciais, dict)
                    else "",
                    data_expiracao=str(
                        (empresa_credenciais or {}).get("data_expiracao") or ""
                    ).strip()
                    if isinstance(empresa_credenciais, dict)
                    else "",
                )

            if not self.obra_repository.get_by_id(obra_id):
                return None

            self.obra_repository.save(obra_atualizada)
            print(f"ATUALIZANDO obra {obra_id}")
            return obra_atualizada

        except Exception as e:
            print(f"Erro ao atualizar obra: {str(e)}")
            return None

    def handle_delete_obra(self, obra_id):
        """Deleta uma obra do servidor"""
        try:
            print(f"Deletando obra {obra_id} do servidor")

            deleted = self.obra_repository.delete(obra_id)
            if not deleted:
                print(f"⚠️ Obra {obra_id} já não existia no servidor")

            print(f"Obra {obra_id} encontrada para remoção" if deleted else f"Obra {obra_id} tratada como já removida")
            self.sessions_manager.remove_obra(obra_id)
            return True

        except Exception as e:
            print(f"Erro ao deletar obra: {str(e)}")
            return False

    # ========= Metodos para empresas ========
    def handle_get_empresas(self):
        """Obtém todas as empresas"""
        try:
            empresas = self.empresa_handler.obter_empresas_publicas()
            return {"success": True, "empresas": empresas}
        except Exception as e:
            print(f"❌ Erro ao obter empresas: {e}")
            return {"success": False, "error": str(e)}

    def handle_post_empresas(self, post_data):
        """Adiciona nova empresa"""
        try:
            empresa_data = json.loads(post_data)
            sucesso, mensagem = self.empresa_handler.adicionar_empresa(empresa_data)

            return {"success": sucesso, "message": mensagem}
        except Exception as e:
            print(f"❌ Erro ao adicionar empresa: {e}")
            return {"success": False, "error": str(e)}

    def handle_buscar_empresas(self, termo):
        """Busca empresas por termo"""
        try:
            from urllib.parse import unquote

            termo_decodificado = unquote(termo)
            resultados = self.empresa_handler.buscar_empresa_publica_por_termo(
                termo_decodificado
            )

            return {"success": True, "resultados": resultados}
        except Exception as e:
            print(f"❌ Erro ao buscar empresas: {e}")
            return {"success": False, "error": str(e), "resultados": []}

    def handle_get_proximo_numero(self, sigla):
        """Obtém próximo número para sigla"""
        try:
            from urllib.parse import unquote

            sigla_decodificada = unquote(sigla)
            numero = self.empresa_handler.obter_proximo_numero_cliente(
                sigla_decodificada
            )

            return {"success": True, "numero": numero}
        except Exception as e:
            print(f"❌ Erro ao obter próximo número: {e}")
            return {"success": False, "error": str(e), "numero": 1}

    # ========== ROTAS DE SESSÃO ==========

    def handle_get_sessions_current(self):
        """Retorna a sessão atual"""
        try:
            data = self.sessions_manager._load_sessions_data()
            current_session_id = self.sessions_manager.get_current_session_id()

            if current_session_id not in data["sessions"]:
                return {"sessions": {}}

            current_session = {current_session_id: data["sessions"][current_session_id]}

            print(f" Retornando sessão {current_session_id}")
            return {"sessions": current_session}

        except Exception as e:
            print(f"❌ Erro ao obter sessão atual: {str(e)}")
            return {"sessions": {}}

    def handle_post_sessions_add_obra(self, post_data):
        """Adiciona uma obra à sessão atual"""
        try:
            data = json.loads(post_data)
            obra_id = data.get("obra_id")

            if not obra_id:
                return {"success": False, "error": "ID da obra não fornecido"}

            print(f"➕ Adicionando obra {obra_id} à sessão")
            success = self.sessions_manager.add_obra_to_session(obra_id)

            if success:
                return {
                    "success": True,
                    "message": f"Obra {obra_id} adicionada à sessão",
                }
            else:
                return {"success": False, "error": "Erro ao adicionar obra à sessão"}

        except Exception as e:
            print(f"❌ Erro ao adicionar obra à sessão: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_delete_sessions_remove_obra(self, obra_id):
        """Remove uma obra da sessão atual"""
        try:
            print(f"🗑️  Removendo obra {obra_id} da sessão")

            success = self.sessions_manager.remove_obra(obra_id)

            if success:
                return {
                    "success": True,
                    "message": f"Obra {obra_id} removida da sessão",
                }
            else:
                return {"success": False, "error": "Erro ao remover obra da sessão"}

        except Exception as e:
            print(f"❌ Erro ao remover obra da sessão: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_get_session_obras(self):
        """Retorna apenas os IDs das obras da sessão atual"""
        try:
            session_obras = self.sessions_manager.get_session_obras()
            current_session_id = self.sessions_manager.get_current_session_id()

            # print(f"[SESSION-OBRAS] Sessão {current_session_id} - Obras: {session_obras}")

            return {"session_id": current_session_id, "obras": session_obras}

        except Exception as e:
            print(f"❌ Erro em handle_get_session_obras: {str(e)}")
            return {"session_id": "error", "obras": []}

    def handle_post_sessions_shutdown(self):
        """Limpa COMPLETAMENTE TODAS as sessões"""
        try:
            print(f"🔴 SHUTDOWN COMPLETO: Deletando TODAS as sessões")

            data_before = self.sessions_manager._load_sessions_data()
            print(f"📄 Estado ANTES do shutdown: {data_before}")

            success = self.sessions_manager.clear_session()

            data_after = self.sessions_manager._load_sessions_data()
            print(f"📄 Estado DEPOIS do shutdown: {data_after}")

            is_empty = (
                not data_after.get("sessions")
                or data_after["sessions"] == {}
                or (
                    data_after.get("sessions", {})
                    .get("session_active", {})
                    .get("obras", [])
                    == []
                )
            )

            if success and is_empty:
                return {
                    "success": True,
                    "message": "Sessões DELETADAS completamente",
                    "final_state": data_after,
                }
            else:
                print(" Método normal falhou - forçando limpeza...")
                success = self.sessions_manager.force_clear_all_sessions()
                data_final = self.sessions_manager._load_sessions_data()

                final_is_empty = (
                    not data_final.get("sessions")
                    or data_final["sessions"] == {}
                    or (
                        data_final.get("sessions", {})
                        .get("session_active", {})
                        .get("obras", [])
                        == []
                    )
                )

                if success and final_is_empty:
                    return {
                        "success": True,
                        "message": "Sessões DELETADAS (forçado)",
                        "final_state": data_final,
                    }
                else:
                    print(
                        f"⚠️  Sessão final não está completamente vazia, mas considerando sucesso: {data_final}"
                    )
                    return {
                        "success": True,
                        "message": "Sessões limpas com aviso",
                        "final_state": data_final,
                        "warning": "Sessão pode conter dados residuais",
                    }

        except Exception as e:
            print(f"❌ Erro no shutdown: {str(e)}")
            return {
                "success": True,
                "message": "Sessões limpas (com erro ignorado)",
                "error_ignored": str(e),
            }

    def handle_post_sessions_ensure_single(self):
        """Garante que apenas uma sessão esteja ativa por vez"""
        try:
            print(f"🔒 Garantindo sessão única")

            success = self.sessions_manager.ensure_single_session()
            current_session_id = self.sessions_manager.get_current_session_id()
            obra_ids = self.sessions_manager.get_session_obras()

            if success:
                return {
                    "success": True,
                    "message": "Sessão única configurada",
                    "session_id": current_session_id,
                    "obras_count": len(obra_ids),
                    "obras": obra_ids,
                }
            else:
                return {"success": False, "error": "Erro ao configurar sessão única"}

        except Exception as e:
            print(f"❌ Erro ao configurar sessão única: {str(e)}")
            return {"success": False, "error": str(e)}

    # ========== ROTAS DE SISTEMA ==========

    def handle_shutdown(self):
        """Encerra o servidor com limpeza de cache"""
        try:
            print("🔴 SHUTDOWN SOLICITADO VIA BOTÃO - ENCERRANDO SERVIDOR")

            response = {
                "status": "shutting_down",
                "message": "Servidor encerrado com sucesso via botão",
                "action": "close_window",
                "close_delay": 3000,
            }

            print(" Resposta enviada ao cliente - servidor será encerrado")

            def shutdown_sequence():
                print(" Iniciando sequência de encerramento...")

                try:
                    print("🧹 Executando limpeza de cache...")
                    self.cache_cleaner.clean_pycache_async()
                except Exception as cache_error:
                    print(f"⚠️  Erro na limpeza de cache: {cache_error}")

                time.sleep(2)
                print("💥 Forçando encerramento do processo Python...")

                import os

                os._exit(0)

            shutdown_thread = threading.Thread(target=shutdown_sequence)
            shutdown_thread.daemon = True
            shutdown_thread.start()

            return response

        except Exception as e:
            print(f"❌ Erro no shutdown: {str(e)}")

            try:
                self.cache_cleaner.clean_pycache_async()
            except:
                pass

            import os

            os._exit(0)

    def handle_get_constants(self):
        """Constants do DADOS.json"""
        try:
            constants = self.system_repository.get_constants()
            print(f"  Retornando constants")
            return constants

        except Exception as e:
            print(f"Erro ao carregar constants: {str(e)}")
            return {}

    def handle_get_machines(self):
        """Machines do DADOS.json"""
        try:
            machines = self.machine_repository.get_all()
            print(f"  Retornando {len(machines)} maquinas")
            return machines

        except Exception as e:
            print(f"Erro ao carregar machines: {str(e)}")
            return []

    def handle_get_dados(self):
        """DADOS.json completo"""
        try:
            dados_data = self.system_repository.get_dados_payload()
            print(" Retornando DADOS.json")
            return dados_data

        except Exception as e:
            print(f"Erro ao carregar dados: {str(e)}")
            return {"constants": {}, "machines": []}

    def handle_get_backup(self):
        """BACKUP.json completo"""
        try:
            backup_data = self.obra_repository.get_backup_payload()
            print(" Retornando BACKUP.json")
            return backup_data

        except Exception as e:
            print(f"Erro ao carregar backup: {str(e)}")
            return {"obras": [], "projetos": []}

    def handle_get_backup_completo(self):
        """Obtém todas as obras do backup sem filtro de sessão"""
        try:
            print(" [BACKUP COMPLETO] Obtendo TODAS as obras")
            obras = self.obra_repository.get_all()
            print(f" Total de obras no backup: {len(obras)}")
            return {"obras": obras}

        except Exception as e:
            print(f"ERRO em handle_get_backup_completo: {str(e)}")
            return {"obras": []}

    def handle_get_runtime_bootstrap(self):
        """Retorna payload agregado para inicialização da interface de obras"""
        try:
            empresas = self.empresa_handler.obter_empresas_publicas()
            session_data = self.handle_get_session_obras()
            backup_data = self.handle_get_backup_completo()
            obras_sessao = self.handle_get_obras()

            return {
                "success": True,
                "empresas": empresas,
                "sessionObras": session_data,
                "backup": backup_data,
                "obrasSessao": obras_sessao,
            }
        except Exception as e:
            print(f"❌ Erro ao montar runtime bootstrap: {str(e)}")
            return {
                "success": False,
                "empresas": [],
                "sessionObras": {"session_id": "error", "obras": []},
                "backup": {"obras": []},
                "obrasSessao": [],
            }

    def handle_post_dados(self, post_data):
        """Salva DADOS.json"""
        try:
            new_data = json.loads(post_data)
            new_data, _, _ = self.empresa_handler.limpar_credenciais_expiradas(new_data)
            self.system_repository.save_dados_payload(new_data)
            print(" DADOS.json salvo")
            return {"status": "success", "message": "Dados salvos"}

        except Exception as e:
            print(f"Erro ao salvar dados: {str(e)}")
            return {"status": "error", "message": str(e)}

    def handle_post_backup(self, post_data):
        """Salva BACKUP.json"""
        try:
            new_data = json.loads(post_data)
            self.obra_repository.replace_backup_payload(new_data)
            print(" BACKUP.json salvo")
            return {"status": "success", "message": "Backup salvo"}

        except Exception as e:
            print(f"Erro ao salvar backup: {str(e)}")
            return {"status": "error", "message": str(e)}

    def handle_get_obras_catalog(self):
        """Retorna um catalogo leve de obras."""
        try:
            return {"obras": self.obra_repository.get_catalog()}
        except Exception as e:
            print(f"ERRO em handle_get_obras_catalog: {str(e)}")
            return {"obras": []}

    def handle_post_reload_page(self, post_data):
        """Força recarregamento da página via Python"""
        try:
            data = json.loads(post_data)

            action = data.get("action", "unknown")
            obra_id = data.get("obraId")
            obra_name = data.get("obraName")

            print(
                f" [RECARREGAMENTO] Ação: {action}, Obra: {obra_name} (ID: {obra_id})"
            )

            if action == "undo":
                print(
                    f"↩️ Usuário desfez exclusão da obra {obra_name} - mantendo na sessão"
                )
            elif action == "undo_no_data":
                print(
                    f"↩️ Usuário desfez exclusão (dados insuficientes) - recarregando página"
                )
            elif action.startswith("timeout"):
                print(f" Timeout completo - obra {obra_name} removida da sessão")

            return {
                "reload_required": True,
                "action": action,
                "obra_id": obra_id,
                "obra_name": obra_name,
                "message": "Página será recarregada",
                "reload_delay": 500,
            }

            print(f" Comando de recarregamento enviado para o frontend")

        except Exception as e:
            print(f"❌ Erro no recarregamento: {str(e)}")
            return {
                "reload_required": True,
                "error": str(e),
                "message": "Recarregamento forçado devido a erro",
            }

            # ========== ROTA UNIVERSAL DELETE ==========


    def _handle_delete_universal_legacy(self, path_array):
        """Implementacao legada mantida apenas para referencia."""
        try:
            print(f"🔍 [DELETE UNIVERSAL] Path recebido: {path_array}")
            print(f"🔍 [DELETE UNIVERSAL] Tipos dos elementos: {[type(item) for item in path_array]}")

            def is_top_level_obra_delete():
                return (
                    isinstance(path_array, list)
                    and len(path_array) == 2
                    and str(path_array[0]) == "obras"
                )

            def build_already_deleted_response(item_id, reason):
                item_id_str = str(item_id)
                print(
                    f"⚠️ [DELETE UNIVERSAL] Obra {item_id_str} já não existia no backup ({reason})"
                )
                self.sessions_manager.remove_obra(item_id_str)
                return {
                    "success": True,
                    "message": "Item já havia sido deletado",
                    "path": path_array,
                    "deleted_item": item_id_str,
                    "already_deleted": True,
                }
            
            # Carrega backup.json
            backup_file = self.file_utils.find_json_file('backup.json', self.project_root)
            backup_data = self.file_utils.load_json_file(backup_file, {})
            
            current = backup_data
            parent = None
            parent_key = None
            
            # Navega até o penúltimo nível
            for i, key in enumerate(path_array[:-1]):
                print(f"🔍 Navegando: key='{key}' (tipo: {type(key)}), nível={i}, tipo_atual={type(current)}")
                
                if isinstance(current, list):
                    # Buscar por ID em array (obras, projetos, salas)
                    item_found = False
                    for idx, item in enumerate(current):
                        if isinstance(item, dict) and str(item.get('id', '')) == str(key):
                            parent = current
                            parent_key = idx
                            current = item
                            item_found = True
                            print(f" Encontrado '{key}' no índice {idx}")
                            break
                    
                    if not item_found:
                        return {
                            "success": False,
                            "error": f"Caminho inválido: '{key}' não encontrado",
                            "path": path_array
                        }
                        
                elif isinstance(current, dict):
                    # Acesso direto por chave de dicionário
                    if key not in current:
                        return {
                            "success": False,
                            "error": f"Caminho inválido: '{key}' não encontrado",
                            "path": path_array
                        }
                    parent = current
                    parent_key = key
                    current = current[key]
                else:
                    return {
                        "success": False,
                        "error": f"Tipo inválido no caminho: {type(current)}",
                        "path": path_array
                    }
            
            #  SEMPRE tenta como índice primeiro
            last_item = path_array[-1]
            print(f"🔍 Último item a deletar: '{last_item}' (tipo: {type(last_item)})")
            print(f"🔍 Nível final type: {type(current)}")
            
            if isinstance(current, list):
                print(f"🔍 Array final com {len(current)} itens")
                
                #  SEMPRE TENTA COMO ÍNDICE PRIMEIRO (para máquinas)
                try:
                    # Converter para inteiro
                    item_index = int(last_item)
                    print(f"🔍 Interpretando '{last_item}' como índice numérico: {item_index}")
                    
                    if 0 <= item_index < len(current):
                        print(f" Removendo pelo índice {item_index}")
                        deleted_item = current.pop(item_index)
                        print(f" Item removido do índice {item_index}. Array agora tem {len(current)} itens")
                    else:
                        return {
                            "success": False,
                            "error": f"Índice {item_index} fora do range (0-{len(current)-1})",
                            "path": path_array
                        }
                        
                except (ValueError, TypeError) as e:
                    # Se não for número, buscar por ID (para obras/projetos/salas)
                    print(f"🔍 '{last_item}' não é número válido, buscando por ID...")
                    item_index = -1
                    for i, item in enumerate(current):
                        if isinstance(item, dict):
                            item_id = str(item.get('id', ''))
                            if item_id == str(last_item):
                                item_index = i
                                break
                    
                    if item_index == -1:
                        if is_top_level_obra_delete():
                            return build_already_deleted_response(last_item, "id-nao-encontrado")
                        return {
                            "success": False,
                            "error": f"Item '{last_item}' não encontrado",
                            "path": path_array
                        }
                    
                    deleted_item = current.pop(item_index)
                    print(f" Removido item com ID '{last_item}' no índice {item_index}")
                    
            elif isinstance(current, dict):
                # Para dicionários, remover pela chave
                if str(last_item) not in current:
                    return {
                        "success": False,
                        "error": f"Item '{last_item}' não encontrado no dicionário",
                        "path": path_array
                    }
                
                deleted_item = current.pop(str(last_item))
                print(f" Removido chave '{last_item}' do dicionário")
            else:
                return {
                    "success": False,
                    "error": f"Tipo inválido: {type(current)}",
                    "path": path_array
                }
            
            # Salvar backup atualizado
            print(f" Salvando backup atualizado...")
            if self.file_utils.save_json_file(backup_file, backup_data):
                # Se for uma obra, também remove da sessão atual
                if len(path_array) == 2 and path_array[0] == 'obras':
                    obra_id = path_array[1]
                    self.sessions_manager.remove_obra(obra_id)
                    print(f"🗑️ Obra {obra_id} também removida da sessão")
                
                return {
                    "success": True,
                    "message": "Item deletado com sucesso",
                    "path": path_array,
                    "deleted_item": str(last_item)
                }
            else:
                return {
                    "success": False,
                    "error": "Erro ao salvar backup.json",
                    "path": path_array
                }
            
        except Exception as e:
            print(f"❌ Erro em handle_delete_universal: {e}")
            import traceback
            traceback.print_exc()
            
            return {
                "success": False,
                "error": f"Erro interno: {str(e)}",
                "path": path_array
            }

    def handle_delete_universal(self, path_array):
        """Deleta qualquer item no fluxo de obras usando o repositorio."""
        try:
            print(f"[DELETE UNIVERSAL] Path recebido: {path_array}")
            print(f"[DELETE UNIVERSAL] Tipos dos elementos: {[type(item) for item in path_array]}")

            result = self.obra_repository.delete_by_path(path_array)

            if (
                result.get("success")
                and len(path_array) == 2
                and str(path_array[0]) == "obras"
            ):
                obra_id = str(path_array[1])
                self.sessions_manager.remove_obra(obra_id)
                print(f"Obra {obra_id} tambem removida da sessao")

            return result

        except Exception as e:
            print(f"Erro em handle_delete_universal: {e}")
            import traceback
            traceback.print_exc()

            return {
                "success": False,
                "error": f"Erro interno: {str(e)}",
                "path": path_array,
            }

    def handle_delete_universal_from_handler(self, handler):
        """Wrapper para receber dados do handler HTTP"""
        try:
            content_length = int(handler.headers["Content-Length"])
            post_data = handler.rfile.read(content_length).decode("utf-8")
            data = json.loads(post_data)

            path = data.get("path")

            if not path or not isinstance(path, list):
                return {
                    "success": False,
                    "error": "Path inválido. Deve ser um array (ex: ['obras', 'id_da_obra'])",
                }

            return self.handle_delete_universal(path)

        except json.JSONDecodeError:
            return {"success": False, "error": "JSON inválido"}
        except Exception as e:
            print(f"❌ Erro em handle_delete_universal_from_handler: {e}")
            return {"success": False, "error": f"Erro no handler: {str(e)}"}



    # ==========  FUNÇÕES PARA SISTEMA DE EDIÇÃO ==========

    def handle_get_system_data(self):
        """Retorna todos os dados do sistema para a interface de edicao"""
        try:
            dados_data = self.system_repository.get_dados_payload()
            print(" Retornando todos os dados do sistema")
            return dados_data

        except Exception as e:
            print(f"Erro ao carregar system data: {str(e)}")
            return {
                "constants": {},
                "machines": [],
                "materials": {},
                "empresas": [],
                "banco_acessorios": {},
                "dutos": [],
                "tubos": [],
            }

    def handle_get_constants_json(self):
        """Retorna apenas as constantes formatadas"""
        try:
            return {"constants": self.system_repository.get_constants()}

        except Exception as e:
            print(f"Erro ao carregar constants: {str(e)}")
            return {"constants": {}}

    def handle_get_materials(self):
        """Retorna materiais"""
        try:
            return {"materials": self.system_repository.get_materials()}

        except Exception as e:
            print(f"Erro ao carregar materials: {str(e)}")
            return {"materials": {}}

    def handle_get_database_usage(self):
        """Retorna consumo atual do banco em MB"""
        try:
            return self.system_repository.get_database_usage()
        except Exception as e:
            print(f"Erro ao carregar uso do banco: {str(e)}")
            return {
                "used_mb": 0,
                "limit_mb": self.system_repository.DEFAULT_DATABASE_LIMIT_MB,
                "percent_used": 0,
                "status": "normal",
                "message": self.system_repository.STORAGE_STATUS_MESSAGES["normal"],
                "explanation": self.system_repository.STORAGE_EXPLANATION,
                "update_note": self.system_repository.STORAGE_UPDATE_NOTE,
                **self.system_repository._build_data_source_status_payload(),
            }

    def handle_get_storage_status(self):
        """Retorna status amigavel de armazenamento do banco"""
        try:
            return self.system_repository.get_storage_status()
        except Exception as e:
            print(f"Erro ao carregar status de armazenamento: {str(e)}")
            return {
                "used_mb": 0,
                "limit_mb": self.system_repository.DEFAULT_DATABASE_LIMIT_MB,
                "percent_used": 0,
                "status": "normal",
                "message": self.system_repository.STORAGE_STATUS_MESSAGES["normal"],
                "explanation": self.system_repository.STORAGE_EXPLANATION,
                "update_note": self.system_repository.STORAGE_UPDATE_NOTE,
                **self.system_repository._build_data_source_status_payload(),
            }

    def handle_get_database_table_usage(self):
        """Retorna consumo por tabela do banco"""
        try:
            return self.system_repository.get_database_table_usage()
        except Exception as e:
            print(f"Erro ao carregar uso por tabela: {str(e)}")
            return {"tables": []}

    def handle_post_storage_reorganize(self):
        """Executa VACUUM para melhorar a reutilizacao interna do espaco"""
        try:
            current_status = self.system_repository.get_storage_status()
            result = self.system_repository.reorganize_storage()
            result["before_status"] = current_status
            return result
        except Exception as e:
            print(f"Erro ao reorganizar armazenamento: {str(e)}")
            return {
                "success": False,
                "error": str(e),
            }

    def handle_post_database_vacuum_full_obras(self):
        """Compatibilidade: reorganiza o armazenamento com VACUUM"""
        try:
            return self.handle_post_storage_reorganize()
        except Exception as e:
            print(f"Erro ao executar reorganizacao de armazenamento: {str(e)}")
            return {
                "success": False,
                "error": str(e),
            }

    def handle_get_all_empresas(self):
        """Retorna todas empresas no formato correto"""
        try:
            return {"empresas": self.empresa_repository.get_public()}

        except Exception as e:
            print(f"Erro ao carregar empresas: {str(e)}")
            return {"empresas": []}

    def handle_get_machine_types(self):
        """Retorna lista de tipos de máquinas"""
        try:
            return {"machine_types": self.machine_repository.get_types()}

        except Exception as e:
            print(f"Erro ao carregar machine types: {str(e)}")
            return {"machine_types": []}

    def handle_get_machine_by_type(self, machine_type):
        """Retorna máquina específica pelo tipo"""
        try:
            return {"machine": self.machine_repository.get_by_type(machine_type)}

        except Exception as e:
            print(f"Erro ao carregar machine: {str(e)}")
            return {"machine": None}

    def handle_post_save_system_data(self, post_data):
        """Salva TODOS os dados do sistema"""
        try:
            new_data = json.loads(post_data)
            changed_sections = list(new_data.get("changed_sections") or [])
            payload = new_data.get("data") if isinstance(new_data.get("data"), dict) else new_data

            if not changed_sections:
                changed_sections = [
                    key
                    for key in (
                        "ADM",
                        "constants",
                        "machines",
                        "materials",
                        "empresas",
                        "banco_acessorios",
                        "dutos",
                        "tubos",
                    )
                    if key in payload
                ]

            if not changed_sections:
                return {
                    "success": False,
                    "error": "Nenhuma secao alterada foi informada para salvamento.",
                }

            if "ADM" in changed_sections:
                self.system_repository.save_admins(payload.get("ADM", []))

            if "constants" in changed_sections:
                self.system_repository.save_constants(payload.get("constants", {}))

            if "machines" in changed_sections:
                self.machine_repository.replace_all(payload.get("machines", []))

            if "materials" in changed_sections:
                self.system_repository.save_materials(payload.get("materials", {}))

            if "empresas" in changed_sections:
                empresas_payload = {
                    "empresas": payload.get("empresas", []),
                }
                empresas_payload, _, _ = self.empresa_handler.limpar_credenciais_expiradas(
                    empresas_payload
                )
                self.empresa_repository.replace_all(empresas_payload.get("empresas", []))

            if "banco_acessorios" in changed_sections:
                self.system_repository.save_acessorios(
                    payload.get("banco_acessorios", {})
                )

            if "dutos" in changed_sections:
                self.system_repository.save_dutos(payload.get("dutos", []))

            if "tubos" in changed_sections:
                self.system_repository.save_tubos(payload.get("tubos", []))

            print(f" Secoes salvas do sistema: {', '.join(changed_sections)}")
            return {
                "success": True,
                "message": "Dados salvos com sucesso",
                "changed_sections": changed_sections,
            }

        except Exception as e:
            print(f"Erro ao salvar system data: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_post_import_online_to_offline(self, *, mode="manual-import", allow_unmanaged_local=True):
        """Baixa o banco online para o snapshot offline local."""
        try:
            from servidor_modules.database.connection import (
                SyncConflictError,
                sync_postgres_to_sqlite,
            )

            result = sync_postgres_to_sqlite(
                self.project_root,
                mode=mode,
                allow_unmanaged_local=allow_unmanaged_local,
            )
            print(" Importacao online -> offline concluida com sucesso")
            return {
                "success": True,
                "message": (
                    "Banco online importado para o fallback local em database/app.sqlite3 "
                    "e dump SQL atualizado em database/app-offline-backup.sql."
                ),
                **result,
            }
        except SyncConflictError as e:
            print(f"Conflito ao importar online -> offline: {str(e)}")
            return {"success": False, "conflict": True, "error": str(e)}
        except Exception as e:
            print(f"Erro ao importar online -> offline: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_post_export_offline_to_online(self):
        """Envia o snapshot offline local para o banco online."""
        try:
            from servidor_modules.database.connection import (
                SyncConflictError,
                sync_sqlite_to_postgres,
            )

            result = sync_sqlite_to_postgres(
                self.project_root,
                mode="manual-export",
            )
            print(" Exportacao offline -> online concluida com sucesso")
            return result
        except SyncConflictError as e:
            print(f"Conflito ao exportar offline -> online: {str(e)}")
            return {"success": False, "conflict": True, "error": str(e)}
        except Exception as e:
            print(f"Erro ao exportar offline -> online: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_post_reconcile_offline_online(self, *, mode="manual-reconcile"):
        """Reconcilia alteracoes seguras entre offline local e banco online."""
        try:
            from servidor_modules.database.connection import reconcile_offline_and_online

            result = reconcile_offline_and_online(
                self.project_root,
                mode=mode,
            )
            if result.get("success"):
                _log_offline_sync_status_once(" Reconciliacao offline <-> online concluida")
            elif result.get("storage_guard_active"):
                _log_offline_sync_status_once(
                    " Banco online com pouco espaco. Dados locais mantidos ate o uso cair para 80%."
                )
            elif result.get("manual_sync_required"):
                _log_offline_sync_status_once(
                    " Historico local restaurado. Use Exportar para sincronizar com o banco online."
                )
            elif result.get("skipped"):
                if result.get("online_available"):
                    _log_offline_sync_status_once(" Banco online disponivel. Dados locais mantidos.")
                else:
                    _log_offline_sync_status_once(" Banco online indisponivel. Dados locais mantidos.")
            else:
                print(
                    " Falha na reconciliacao offline <-> online:",
                    result.get("error") or result.get("message"),
                )
            return result
        except Exception as e:
            print(f"Erro ao reconciliar offline <-> online: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_post_background_sync_offline(self):
        """Atualiza discretamente o snapshot local apos salvar online."""
        return self.handle_post_reconcile_offline_online(mode="background-save")

    def handle_post_save_constants(self, post_data):
        """Salva apenas as constantes"""
        try:
            new_constants = json.loads(post_data)
            self.system_repository.save_constants(new_constants.get("constants", {}))
            print(" Constantes salvas")
            return {"success": True, "message": "Constantes salvas"}

        except Exception as e:
            print(f"Erro ao salvar constants: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_post_save_materials(self, post_data):
        """Salva materiais"""
        try:
            new_materials = json.loads(post_data)
            self.system_repository.save_materials(new_materials.get("materials", {}))
            print(" Materiais salvos")
            return {"success": True, "message": "Materiais salvas"}

        except Exception as e:
            print(f"Erro ao salvar materials: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_post_save_empresas(self, post_data):
        """Salva empresas"""
        try:
            new_empresas = json.loads(post_data)
            self.empresa_repository.replace_all(new_empresas.get("empresas", []))
            print(" Empresas salvas")
            return {"success": True, "message": "Empresas salvas"}

        except Exception as e:
            print(f"Erro ao salvar empresas: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_post_save_machines(self, post_data):
        """Salva todas as máquinas"""
        try:
            new_machines = json.loads(post_data)
            self.machine_repository.replace_all(new_machines.get("machines", []))
            print(" Máquinas salvas")
            return {"success": True, "message": "Máquinas salvas"}

        except Exception as e:
            print(f"Erro ao salvar machines: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_post_add_machine(self, post_data):
        """Adiciona nova máquina"""
        try:
            new_machine = json.loads(post_data)
            machine = self.machine_repository.add(new_machine)
            print(f" Nova máquina '{new_machine.get('type')}' adicionada")
            return {"success": True, "message": "Máquina adicionada", "machine": machine}

        except Exception as e:
            print(f"Erro ao adicionar machine: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_post_update_machine(self, post_data):
        """Atualiza máquina existente"""
        try:
            update_data = json.loads(post_data)
            machine = self.machine_repository.update(update_data)
            print(f" Máquina '{update_data.get('type')}' atualizada")
            return {"success": True, "message": "Máquina atualizada", "machine": machine}

        except Exception as e:
            print(f"Erro ao atualizar machine: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_post_empresas_auto(self, post_data):
        """Cria empresa automaticamente"""
        try:
            # Esta função pode delegar para o EmpresaHandler
            return {
                "success": True, 
                "message": "Empresa criada automaticamente"
            }
        except Exception as e:
            print(f"❌ Erro em handle_post_empresas_auto: {str(e)}")
            return {"success": False, "error": str(e)}

    def handle_health_check(self):
        """Health check rápido"""
        return {"status": "online", "timestamp": time.time()}

    def handle_get_server_uptime(self):
        """Retorna uptime do servidor"""
        try:
            import time
            from servidor_modules.core.sessions_core import sessions_manager
            
            # Calcular tempo desde o início
            start_time = sessions_manager.start_time
            uptime_seconds = time.time() - start_time
            
            # Converter para formato legível
            hours = int(uptime_seconds // 3600)
            minutes = int((uptime_seconds % 3600) // 60)
            seconds = int(uptime_seconds % 60)
            
            return {
                "uptime_seconds": uptime_seconds,
                "uptime_human": f"{hours}h {minutes}m {seconds}s",
                "start_time": start_time
            }
        except Exception as e:
            print(f"❌ Erro ao obter uptime: {str(e)}")
            return {"error": str(e)}

    def handle_get_projetos(self):
        """Obtém projetos (legacy)"""
        try:
            # Implementação simples para compatibilidade
            return []
        except Exception as e:
            print(f"❌ Erro ao obter projetos: {str(e)}")
            return []
        
    
    def handle_delete_empresa_by_index(self, index):
        """Deleta uma empresa pelo índice"""
        try:
            index_int = int(index)
            print(f"🗑️  [DELETE EMPRESA] Excluindo empresa no índice: {index_int}")

            # Carrega dados.json
            dados_file = self.file_utils.find_json_file("dados.json", self.project_root)
            dados_data = self.file_utils.load_json_file(dados_file, {})

            empresas = dados_data.get("empresas", [])
            if not isinstance(empresas, list):
                return {"success": False, "error": "Estrutura 'empresas' inválida"}

            # Verifica índice
            if 0 <= index_int < len(empresas):
                empresa_removida = empresas.pop(index_int)
                sigla_removida = list(empresa_removida.keys())[0] if empresa_removida else "?"
                print(f" Empresa '{sigla_removida}' (índice {index_int}) removida.")

                # Salva
                dados_data["empresas"] = empresas
                if self.file_utils.save_json_file(dados_file, dados_data):
                    return {"success": True, "message": f"Empresa {sigla_removida} excluída"}
                else:
                    return {"success": False, "error": "Falha ao salvar arquivo"}
            else:
                return {"success": False, "error": f"Índice {index_int} inválido"}

        except ValueError:
            return {"success": False, "error": f"Índice inválido: '{index}'"}
        except Exception as e:
            print(f"❌ Erro em handle_delete_empresa_by_index: {e}")
            return {"success": False, "error": str(e)}
        
        
    def handle_delete_empresa(self, index):
        """Deleta uma empresa pelo índice"""
        try:
            index_int = int(index)
            print(f"🗑️  [DELETE EMPRESA] Excluindo empresa no índice: {index_int}")

            # Carrega dados.json
            dados_file = self.file_utils.find_json_file("dados.json", self.project_root)
            dados_data = self.file_utils.load_json_file(dados_file, {})

            empresas = dados_data.get("empresas", [])
            if not isinstance(empresas, list):
                return {"success": False, "error": "Estrutura 'empresas' inválida"}

            # Verifica índice
            if 0 <= index_int < len(empresas):
                empresa_removida = empresas.pop(index_int)
                sigla_removida = list(empresa_removida.keys())[0] if empresa_removida else "?"
                print(f" Empresa '{sigla_removida}' (índice {index_int}) removida.")

                # Salva
                dados_data["empresas"] = empresas
                if self.file_utils.save_json_file(dados_file, dados_data):
                    return {"success": True, "message": f"Empresa {sigla_removida} excluída"}
                else:
                    return {"success": False, "error": "Falha ao salvar arquivo"}
            else:
                return {"success": False, "error": f"Índice {index_int} inválido"}

        except ValueError:
            return {"success": False, "error": f"Índice inválido: '{index}'"}
        except Exception as e:
            print(f"❌ Erro em handle_delete_empresa: {e}")
            return {"success": False, "error": str(e)}
        
        
        
        # Adicionar na classe RoutesCore:


        
        
    def handle_get_acessorios(self):
        """Retorna todos os acessórios do banco_acessorios"""
        try:
            dados_file = self.file_utils.find_json_file("dados.json", self.project_root)
            dados_data = self.file_utils.load_json_file(dados_file, {})
            
            acessorios = dados_data.get("banco_acessorios", {})
            return {
                "success": True,
                "acessorios": acessorios,
                "count": len(acessorios)
            }
            
        except Exception as e:
            print(f"❌ Erro ao carregar acessórios: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "acessorios": {},
                "count": 0
            }
            
            
    def handle_get_dutos(self):
        """Retorna todos os dutos"""
        try:
            dados_file = self.file_utils.find_json_file("dados.json", self.project_root)
            dados_data = self.file_utils.load_json_file(dados_file, {})
            
            dutos = dados_data.get("dutos", [])
            return {
                "success": True,
                "dutos": dutos,
                "count": len(dutos)
            }
            
        except Exception as e:
            print(f"❌ Erro ao carregar dutos: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "dutos": [],
                "count": 0
            }
            
    def handle_post_save_dutos(self, post_data):
        """Salva apenas os dutos"""
        try:
            new_dutos = json.loads(post_data)
            
            dados_file = self.file_utils.find_json_file("dados.json", self.project_root)
            dados_data = self.file_utils.load_json_file(dados_file, {})
            
            dados_data["dutos"] = new_dutos.get("dutos", [])
            
            if self.file_utils.save_json_file(dados_file, dados_data):
                print(" Dutos salvos")
                return {"success": True, "message": "Dutos salvos"}
            else:
                return {"success": False, "error": "Erro ao salvar dutos"}
                
        except Exception as e:
            print(f"❌ Erro ao salvar dutos: {str(e)}")
            return {"success": False, "error": str(e)}
        
        
    def handle_get_tubos(self):
        """Retorna todos os tubos"""
        try:
            dados_file = self.file_utils.find_json_file("dados.json", self.project_root)
            dados_data = self.file_utils.load_json_file(dados_file, {})
            
            tubos = dados_data.get("tubos", [])
            return {
                "success": True,
                "tubos": tubos,
                "count": len(tubos)
            }
            
        except Exception as e:
            print(f"❌ Erro ao carregar tubos: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "tubos": [],
                "count": 0
            }

    def handle_post_save_tubos(self, post_data):
        """Salva apenas os tubos"""
        try:
            new_tubos = json.loads(post_data)
            
            dados_file = self.file_utils.find_json_file("dados.json", self.project_root)
            dados_data = self.file_utils.load_json_file(dados_file, {})
            
            dados_data["tubos"] = new_tubos.get("tubos", [])
            
            if self.file_utils.save_json_file(dados_file, dados_data):
                print(" Tubos salvos")
                return {"success": True, "message": "Tubos salvos"}
            else:
                return {"success": False, "error": "Erro ao salvar tubos"}
                
        except Exception as e:
            print(f"❌ Erro ao salvar tubos: {str(e)}")
            return {"success": False, "error": str(e)}
        
        
        
        # Adicione este método na classe RoutesCore, depois do método handle_post_update_machine:

    def handle_post_delete_machine(self, post_data):
        """Deleta uma máquina do sistema"""
        try:
            data = json.loads(post_data)
            machine_type = data.get("type")
            index = data.get("index")
            removed, removed_index = self.machine_repository.delete(machine_type, index)
            print(f"Máquina '{machine_type}' (índice {removed_index}) removida com sucesso")
            return {
                "success": True,
                "message": f"Máquina '{machine_type}' deletada com sucesso",
                "machine_removed": removed,
                "index": removed_index,
            }

        except Exception as e:
            print(f"Erro ao deletar machine: {str(e)}")
            return {"success": False, "error": str(e)}
