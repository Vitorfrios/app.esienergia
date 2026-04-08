"""
sessions_core.py
Gerenciador de sessões
"""

import json
import time
import os
import sqlite3
from pathlib import Path

from servidor_modules.database.storage import get_storage

class SessionsManager:
    """
    Gerenciador de sessões para sistema que começa vazio
    Gerencia uma única sessão ativa com lista de obras
    """
    
    def __init__(self):
        # Usa caminho absoluto baseado na localização do arquivo
        current_file = Path(__file__)  # sessions_core.py
        project_root = current_file.parent.parent.parent  # sobe para pasta codigo
        self.project_root = project_root
        self.sessions_dir = project_root / "json"  # pasta json dentro de codigo
        self.sessions_file = self.sessions_dir / "sessions.json"
        self.storage = get_storage(project_root)
        self.ensure_sessions_file()
    
    def ensure_sessions_file(self):
        """Garante que o arquivo de sessões existe com estrutura vazia"""
        try:
            # Cria diretório se não existir
            self.sessions_dir.mkdir(parents=True, exist_ok=True)
            self.storage.load_document(
                "sessions.json",
                {"sessions": {"session_active": {"obras": []}}},
            )
                
        except Exception as e:
            print(f"ERRO em ensure_sessions_file: {e}")
            raise
    
    def _initialize_sessions_file(self):
        """Inicializa o arquivo de sessões com estrutura vazia"""
        initial_data = {
            "sessions": {
                "session_active": {  
                    "obras": []      
                }
            }
        }
        self._save_sessions_data(initial_data)
    
    def get_current_session_id(self) -> str:
        """Retorna o ID da sessão ativa"""
        return "session_active"

    def add_obra_to_session(self, obra_id: str) -> bool:
        """Adiciona uma obra à sessão ativa"""
        data = self._load_sessions_data()
        current_session_id = self.get_current_session_id()
        
        # Garante que existe apenas a sessão ativa
        data["sessions"] = {
            current_session_id: data["sessions"].get(current_session_id, {"obras": []})
        }
        
        # Adiciona ID da obra se não existir
        obra_id_str = str(obra_id)
        if obra_id_str not in data["sessions"][current_session_id]["obras"]:
            data["sessions"][current_session_id]["obras"].append(obra_id_str)
            print(f" Obra {obra_id_str} adicionada à sessão {current_session_id}")
        
        return self._save_sessions_data(data)

    def remove_obra(self, obra_id: str) -> bool:
        """Remove uma obra da sessão ativa"""
        data = self._load_sessions_data()
        current_session_id = self.get_current_session_id()
        obra_id_str = str(obra_id)
        
        print(f"🔍 Tentando remover obra {obra_id_str} da sessão {current_session_id}")
        print(f" Obras na sessão antes: {data['sessions'][current_session_id]['obras']}")
        
        if (current_session_id in data["sessions"] and 
            obra_id_str in data["sessions"][current_session_id]["obras"]):
            
            # Remove o ID da obra
            data["sessions"][current_session_id]["obras"].remove(obra_id_str)
            print(f"🗑️ Obra {obra_id_str} removida da sessão {current_session_id}")
            
            # Salva os dados atualizados
            success = self._save_sessions_data(data)
            
            # Verifica se realmente foi removido
            if success:
                updated_data = self._load_sessions_data()
                still_exists = obra_id_str in updated_data["sessions"][current_session_id]["obras"]
                if still_exists:
                    print(f"❌ ERRO: Obra {obra_id_str} ainda está na sessão após remoção!")
                    return False
                else:
                    print(f" Obra {obra_id_str} removida com sucesso")
                    print(f" Obras na sessão depois: {updated_data['sessions'][current_session_id]['obras']}")
                    return True
            else:
                print(f"❌ ERRO: Falha ao salvar dados após remoção da obra {obra_id_str}")
                return False
        
        print(f"⚠️ Obra {obra_id_str} não encontrada na sessão {current_session_id}")
        print(f"🧹 Remoção de sessão tratada como idempotente para {obra_id_str}")
        return True

    def remove_obra_from_session(self, obra_id: str) -> dict:
        """Remove uma obra da sessão ativa - para uso com modal"""
        try:
            obra_id_str = str(obra_id)
            print(f"🗑️ [MODAL] Tentando remover obra {obra_id_str} da sessão")
            
            # Carrega dados atuais
            data = self._load_sessions_data()
            current_session_id = self.get_current_session_id()
            
            # Verifica se a obra existe na sessão
            if (current_session_id in data["sessions"] and 
                obra_id_str in data["sessions"][current_session_id]["obras"]):
                
                # Remove a obra
                data["sessions"][current_session_id]["obras"].remove(obra_id_str)
                print(f" Obra {obra_id_str} removida da sessão")
                
                # Salva os dados
                if self._save_sessions_data(data):
                    # Verifica se realmente foi removido
                    updated_data = self._load_sessions_data()
                    still_exists = obra_id_str in updated_data["sessions"][current_session_id]["obras"]
                    
                    if not still_exists:
                        return {
                            'success': True, 
                            'message': 'Obra removida da sessão',
                            'reload_required': True
                        }
                    else:
                        return {
                            'success': False, 
                            'error': 'Obra ainda está na sessão após remoção',
                            'reload_required': True
                        }
                else:
                    return {
                        'success': False, 
                        'error': 'Falha ao salvar sessão',
                        'reload_required': True
                    }
            else:
                print(f"⚠️ Obra {obra_id_str} não encontrada na sessão")
                return {
                    'success': True, 
                    'message': 'Obra não estava na sessão', 
                    'reload_required': True
                }
                
        except Exception as e:
            print(f"❌ Erro ao remover obra {obra_id} da sessão: {e}")
            return {
                'success': False, 
                'error': str(e),
                'reload_required': True
            }

    def check_obra_in_session(self, obra_id: str) -> dict:
        """Verifica se uma obra está na sessão ativa"""
        try:
            data = self._load_sessions_data()
            current_session_id = self.get_current_session_id()
            
            exists = (current_session_id in data["sessions"] and 
                     str(obra_id) in data["sessions"][current_session_id]["obras"])
            
            return {
                'exists': exists,
                'obra_id': obra_id
            }
        except Exception as e:
            print(f"❌ Erro ao verificar obra {obra_id} na sessão: {e}")
            return {'exists': False, 'error': str(e)}
    
    def get_session_obras(self) -> list:
        """Retorna lista de IDs de obras da sessão ativa"""
        data = self._load_sessions_data()
        current_session_id = self.get_current_session_id()
        
        return data["sessions"].get(current_session_id, {"obras": []})["obras"]

    def add_project_to_session(self, project_id: str) -> bool:
        """Método de compatibilidade: converte projetos para obras"""
        print(f" [COMPAT] Convertendo projeto {project_id} para obra")
        
        # Em sistemas atualizados, project_id JÁ É o obra_id
        obra_id = str(project_id)
        
        # Se for um ID numérico antigo, mantém para compatibilidade
        if obra_id.isdigit():
            print(f"📝 [COMPAT] ID numérico legado: {obra_id}")
        else:
            print(f"📝 [COMPAT] ID seguro moderno: {obra_id}")
        
        return self.add_obra_to_session(obra_id)

    def remove_project(self, project_id: str) -> bool:
        """Método de compatibilidade: remove projetos (legado)"""
        print(f"⚠️  AVISO: remove_project({project_id}) - método legado")
        
        # Para compatibilidade, não remove nada
        return True

    def get_session_projects(self) -> list:
        """Método de compatibilidade: retorna lista vazia (legado)"""
        print("⚠️  AVISO: get_session_projects() - método legado, retornando vazia")
        return []

    def clear_session(self) -> bool:
        """Limpa completamente todas as sessões"""
        print("SHUTDOWN: Limpando sessão ativa")
        
        # Mantém estrutura mas limpa as obras
        data = {
            "sessions": {
                "session_active": {
                    "obras": []  # Sempre volta vazia
                }
            }
        }
        
        success = self._save_sessions_data(data)
        
        if success:
            # Confirmação
            final_data = self._load_sessions_data()
            print(f"sessions.json após limpeza: {final_data}")
            return True
        else:
            print("ERRO: Não foi possível limpar sessão ativa")
            return False
   
    def force_clear_all_sessions(self) -> bool:
        """Força a limpeza total deletando e recriando o arquivo"""
        try:
            self._initialize_sessions_file()
            print("Arquivo sessions.json recriado com sessão ativa vazia")
            
            return True
        except Exception as e:
            print(f"Erro ao forçar limpeza: {e}")
            return False

    def ensure_single_session(self) -> bool:
        """Garante que apenas uma sessão ativa exista"""
        data = self._load_sessions_data()
        current_session_id = self.get_current_session_id()
        
        # Mantém apenas a sessão ativa
        current_obras = data["sessions"].get(current_session_id, {"obras": []})["obras"]
        
        # Remove todas as outras sessões
        data["sessions"] = {
            current_session_id: {
                "obras": current_obras
            }
        }
        
        # print(f" Sessão única garantida: {current_session_id} com {len(current_obras)} obras")
        return self._save_sessions_data(data)
    
    def _load_sessions_data(self) -> dict:
        """Carrega os dados das sessões do arquivo"""
        try:
            data = self.storage.load_document(
                "sessions.json",
                {"sessions": {"session_active": {"obras": []}}},
            )

            if "sessions" not in data:
                data["sessions"] = {}

            if "session_active" not in data["sessions"]:
                data["sessions"] = {"session_active": {"obras": []}}

            for session_id, session_data in data["sessions"].items():
                if "obras" not in session_data:
                    session_data["obras"] = []

            return data

        except (FileNotFoundError, json.JSONDecodeError):
            return {"sessions": {"session_active": {"obras": []}}}
    
    def _save_sessions_data(self, data: dict) -> bool:
        """Salva os dados das sessões no arquivo"""
        try:
            return self.storage.save_document("sessions.json", data)
                
        except Exception as e:
            print(f"❌ ERRO ao salvar sessions: {e}")
            return False

    def get_current_session(self) -> dict:
        """Retorna a sessão atual completa"""
        data = self._load_sessions_data()
        current_session_id = self.get_current_session_id()
        
        # Retorna apenas a sessão ativa
        return {
            "sessions": {
                current_session_id: data["sessions"].get(current_session_id, {"obras": []})
            }
        }

    def debug_sessions(self):
        """Método de debug para verificar o estado das sessões"""
        data = self._load_sessions_data()
        print("=== DEBUG SESSIONS ===")
        print(f"Sessões encontradas: {len(data['sessions'])}")
        for session_id, session_data in data["sessions"].items():
            print(f"  {session_id}: {len(session_data.get('obras', []))} obras")
        print("======================")

# Instância global com tratamento de erro
try:
    sessions_manager = SessionsManager()
    # print(" SessionsManager  inicializado com sucesso!")
    
    # Força sessão única na inicialização
    sessions_manager.ensure_single_session()
    sessions_manager.debug_sessions()
    
except Exception as e:
    print(" Nao foi possivel iniciar o gerenciador principal de sessoes. Ativando modo local de emergencia.")
    if os.environ.get("ESI_DEBUG_STARTUP") == "1" and str(e).strip():
        print(f" Detalhe tecnico: {e}")
    
    # Gerenciador de sessões de emergência
    class EmergencySessionsManager:
        """Gerenciador de sessões de emergência """
        
        def __init__(self):
            self.project_root = Path(__file__).parent.parent.parent
            self.sessions_dir = self.project_root / "json"
            self.sessions_file = self.sessions_dir / "sessions.json"
            self.database_dir = self.project_root / "database"
            self.sqlite_path = self.database_dir / "app.sqlite3"
            self.sql_dump_path = self.database_dir / "app-offline-backup.sql"
            print(f"⚠️  Usando EmergencySessionsManager : {self.project_root}")

        def _default_sessions_data(self):
            return {"sessions": {"session_active": {"obras": []}}}

        def _normalize_sessions_data(self, data):
            if "sessions" not in data or not isinstance(data["sessions"], dict):
                data["sessions"] = {}
            if "session_active" not in data["sessions"] or not isinstance(
                data["sessions"]["session_active"], dict
            ):
                data["sessions"]["session_active"] = {"obras": []}

            normalized_sessions = {}
            for session_id, session_payload in data["sessions"].items():
                if not isinstance(session_payload, dict):
                    session_payload = {}
                obras = session_payload.get("obras")
                if not isinstance(obras, list):
                    obras = []
                normalized_sessions[str(session_id)] = {
                    **session_payload,
                    "obras": [str(obra_id) for obra_id in obras if str(obra_id).strip()],
                }

            data["sessions"] = normalized_sessions
            return data

        def _has_session_obras(self, data):
            return bool(
                data.get("sessions", {})
                .get("session_active", {})
                .get("obras", [])
            )

        def _load_sessions_from_sqlite(self):
            if not self.sqlite_path.exists():
                return None

            sqlite_conn = None
            try:
                sqlite_conn = sqlite3.connect(str(self.sqlite_path))
                sqlite_conn.row_factory = sqlite3.Row
                rows = sqlite_conn.execute(
                    "SELECT session_id, payload_json FROM sessions ORDER BY session_id"
                ).fetchall()
            except sqlite3.Error:
                return None
            finally:
                if sqlite_conn is not None:
                    sqlite_conn.close()

            if not rows:
                return None

            sessions = {}
            for row in rows:
                try:
                    payload = json.loads(row["payload_json"] or "{}")
                except Exception:
                    payload = {}
                if not isinstance(payload, dict):
                    payload = {}
                obras = payload.get("obras")
                sessions[str(row["session_id"])] = {
                    **payload,
                    "obras": [str(obra_id) for obra_id in (obras or []) if str(obra_id).strip()],
                }

            return self._normalize_sessions_data({"sessions": sessions})

        def _load_sessions_from_sql_dump(self):
            if not self.sql_dump_path.exists():
                return None

            sessions = {}
            try:
                with self.sql_dump_path.open("r", encoding="utf-8") as handle:
                    for raw_line in handle:
                        line = raw_line.strip()
                        if not line.startswith('INSERT INTO "sessions" VALUES('):
                            continue
                        if not line.endswith(");"):
                            continue

                        payload = line[len('INSERT INTO "sessions" VALUES(') : -2]
                        session_parts = payload.split(",", 1)
                        if len(session_parts) != 2:
                            continue

                        session_id = session_parts[0].strip().strip("'").replace("''", "'")
                        payload_json = session_parts[1].strip().strip("'").replace("''", "'")

                        try:
                            session_payload = json.loads(payload_json or "{}")
                        except Exception:
                            session_payload = {}

                        if not isinstance(session_payload, dict):
                            session_payload = {}

                        obras = session_payload.get("obras")
                        sessions[str(session_id)] = {
                            **session_payload,
                            "obras": [str(obra_id) for obra_id in (obras or []) if str(obra_id).strip()],
                        }
            except Exception:
                return None

            if not sessions:
                return None

            return self._normalize_sessions_data({"sessions": sessions})

        def _load_sessions_data(self):
            data = None
            try:
                self.sessions_dir.mkdir(parents=True, exist_ok=True)
                if self.sessions_file.exists():
                    with self.sessions_file.open("r", encoding="utf-8") as handle:
                        data = json.load(handle)
                else:
                    data = self._default_sessions_data()
            except Exception:
                data = self._default_sessions_data()

            data = self._normalize_sessions_data(data)
            if self._has_session_obras(data):
                return data

            sqlite_data = self._load_sessions_from_sqlite()
            if sqlite_data and self._has_session_obras(sqlite_data):
                self._save_sessions_data(sqlite_data)
                return sqlite_data

            sql_dump_data = self._load_sessions_from_sql_dump()
            if sql_dump_data and self._has_session_obras(sql_dump_data):
                self._save_sessions_data(sql_dump_data)
                return sql_dump_data

            return data

        def _save_sessions_to_sqlite(self, data):
            if not self.sqlite_path.exists():
                return False

            sqlite_conn = None
            try:
                sqlite_conn = sqlite3.connect(str(self.sqlite_path))
                sqlite_conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS sessions (
                        session_id TEXT PRIMARY KEY,
                        payload_json TEXT NOT NULL
                    )
                    """
                )
                sqlite_conn.execute("DELETE FROM sessions")
                for session_id, session_payload in data.get("sessions", {}).items():
                    sqlite_conn.execute(
                        "INSERT OR REPLACE INTO sessions(session_id, payload_json) VALUES (?, ?)",
                        (
                            str(session_id),
                            json.dumps(session_payload, ensure_ascii=False),
                        ),
                    )
                sqlite_conn.commit()
                return True
            except sqlite3.Error:
                if sqlite_conn is not None:
                    try:
                        sqlite_conn.rollback()
                    except Exception:
                        pass
                return False
            finally:
                if sqlite_conn is not None:
                    sqlite_conn.close()

        def _refresh_sql_dump_from_sqlite(self):
            if not self.sqlite_path.exists():
                return

            sqlite_conn = None
            try:
                self.database_dir.mkdir(parents=True, exist_ok=True)
                sqlite_conn = sqlite3.connect(str(self.sqlite_path))
                with self.sql_dump_path.open("w", encoding="utf-8", newline="\n") as handle:
                    for line in sqlite_conn.iterdump():
                        handle.write(f"{line}\n")
            except Exception:
                pass
            finally:
                if sqlite_conn is not None:
                    sqlite_conn.close()

        def _save_sessions_data(self, data):
            normalized_data = self._normalize_sessions_data(
                data or self._default_sessions_data()
            )
            json_saved = False
            try:
                self.sessions_dir.mkdir(parents=True, exist_ok=True)
                with self.sessions_file.open("w", encoding="utf-8", newline="\n") as handle:
                    json.dump(normalized_data, handle, ensure_ascii=False, indent=2)
                json_saved = True
            except Exception:
                json_saved = False

            sqlite_saved = self._save_sessions_to_sqlite(normalized_data)
            if sqlite_saved:
                self._refresh_sql_dump_from_sqlite()

            return json_saved or sqlite_saved
        
        def get_current_session_id(self):
            return "session_active"
        
        def add_obra_to_session(self, obra_id):
            data = self._load_sessions_data()
            obra_id_str = str(obra_id)
            obras = data["sessions"]["session_active"].setdefault("obras", [])
            if obra_id_str not in obras:
                obras.append(obra_id_str)
                self._save_sessions_data(data)
            print(f" [EMERGENCY] Obra {obra_id} adicionada à sessão ativa")
            return True

        def remove_obra(self, obra_id):
            data = self._load_sessions_data()
            obra_id_str = str(obra_id)
            obras = data["sessions"]["session_active"].setdefault("obras", [])
            if obra_id_str in obras:
                obras.remove(obra_id_str)
                self._save_sessions_data(data)
            print(f" [EMERGENCY] Obra {obra_id} removida da sessão ativa")
            return True

        def remove_obra_from_session(self, obra_id):
            self.remove_obra(obra_id)
            print(f" [EMERGENCY] Obra {obra_id} removida da sessão ativa (modal)")
            return {'success': True, 'message': 'Obra removida', 'reload_required': True}

        def check_obra_in_session(self, obra_id):
            print(f" [EMERGENCY] Verificando obra {obra_id} na sessão")
            return {'exists': str(obra_id) in self.get_session_obras(), 'obra_id': obra_id}

        def get_session_obras(self):
            data = self._load_sessions_data()
            return data["sessions"]["session_active"].get("obras", [])
            
        def get_current_session(self):
            return self._load_sessions_data()
        
        def add_project_to_session(self, project_id):
            print(f" [EMERGENCY] Convertendo projeto {project_id} para obra")
            return self.add_obra_to_session(project_id)
            
        def remove_project(self, project_id):
            return True
            
        def get_session_projects(self):
            return []

        def clear_session(self):
            self._save_sessions_data(self._default_sessions_data())
            return True

        def force_clear_all_sessions(self):
            self._save_sessions_data(self._default_sessions_data())
            return True

        def ensure_single_session(self):
            data = self._load_sessions_data()
            data["sessions"] = {
                "session_active": {
                    "obras": data["sessions"]["session_active"].get("obras", [])
                }
            }
            self._save_sessions_data(data)
            return True
            
        def debug_sessions(self):
            print("=== DEBUG EMERGENCY SESSIONS ===")
            print(f"session_active: {len(self.get_session_obras())} obras")
            print("================================")
    
    sessions_manager = EmergencySessionsManager()
