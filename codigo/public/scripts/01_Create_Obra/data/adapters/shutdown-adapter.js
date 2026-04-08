// adapters/shutdown-adapter.js - GERENCIAMENTO DE SHUTDOWN

import {
  setSessionActive,
  clearSessionObras,
  clearRenderedObras,
} from "./session-adapter.js";

const SHUTDOWN_FLAG = "__esiShutdownInProgress";
const SHUTDOWN_CLOSE_HELPER_KEY = "__esiAttemptShutdownWindowClose";
const SHUTDOWN_BLANK_HELPER_KEY = "__esiOpenShutdownBlankPage";

function markShutdownInProgress(active = true) {
  window[SHUTDOWN_FLAG] = active;

  if (document?.documentElement) {
    document.documentElement.dataset.shutdownInProgress = active
      ? "true"
      : "false";
  }

  window.dispatchEvent(
    new CustomEvent(active ? "esi:shutdown-start" : "esi:shutdown-end"),
  );
}

function isShutdownInProgress() {
  return window[SHUTDOWN_FLAG] === true;
}

function canAttemptDirectWindowClose() {
  return Boolean(window.opener) || window.history.length <= 1;
}

function openBlankShutdownPage() {
  try {
    window.location.replace("about:blank");
  } catch (error) {
    console.warn(" Nao foi possivel abrir pagina em branco:", error);
  }
}

function attemptWindowClose({ fallbackDelay = 600, allowBlankPage = true } = {}) {
  const closeAttempts = [
    () => window.close(),
    () => window.open("", "_self"),
    () => window.close(),
    () => window.open("about:blank", "_self"),
    () => window.close(),
  ];

  if (allowBlankPage) {
    closeAttempts.push(() => openBlankShutdownPage());
  }

  closeAttempts.forEach((attempt, index) => {
    setTimeout(() => {
      if (window.closed) {
        return;
      }

      try {
        attempt();
      } catch (error) {
        console.warn(" Tentativa de fechamento bloqueada:", error);
      }
    }, index * 120);
  });

  if (fallbackDelay !== null) {
    setTimeout(() => {
      if (!window.closed) {
        showFinalMessageWithManualClose();
      }
    }, Math.max(fallbackDelay, closeAttempts.length * 120 + 200));
  }
}

window[SHUTDOWN_CLOSE_HELPER_KEY] = attemptWindowClose;
window[SHUTDOWN_BLANK_HELPER_KEY] = openBlankShutdownPage;

/**
 * Encerra o servidor e a sessao atual de forma controlada.
 */
async function shutdownManual() {
  if (isShutdownInProgress()) {
    return;
  }

  const { showShutdownConfirmationModal } = await import(
    "../../ui/components/modal/exit-modal.js"
  );

  const confirmed = await showShutdownConfirmationModal();
  if (!confirmed) {
    return;
  }

  console.log(" ENCERRANDO SERVIDOR E SESSOES...");
  markShutdownInProgress(true);

  try {
    showShutdownMessage(" Limpando sessoes e encerrando servidor...");

    console.log(" Limpando sessoes...");
    try {
      const sessionsResponse = await fetch("/api/sessions/shutdown", {
        method: "POST",
      });

      if (sessionsResponse.ok) {
        const sessionsResult = await sessionsResponse.json();
        console.log(" Sessoes limpas:", sessionsResult);
      }
    } catch (sessionError) {
      console.warn(" Erro ao limpar sessoes, continuando:", sessionError);
    }

    setSessionActive(false);
    clearSessionObras();
    clearRenderedObras();
    window.GeralCount = 0;

    await new Promise((resolve) => setTimeout(resolve, 200));

    console.log(" Encerrando servidor...");

    const shutdownResponse = await fetch("/api/shutdown", {
      method: "POST",
    });

    if (!shutdownResponse.ok) {
      throw new Error("Falha ao encerrar servidor");
    }

    const result = await shutdownResponse.json();
    console.log(" Comando de shutdown enviado:", result);

    showFinalShutdownMessage();

    const closeDelay = result.close_delay || 2000;
    console.log(` Fechando janela em ${closeDelay}ms...`);

    setTimeout(() => {
      console.log(" Fechando janela...");
      attemptWindowClose({
        fallbackDelay: canAttemptDirectWindowClose() ? 900 : 300,
        allowBlankPage: true,
      });
    }, closeDelay);
  } catch (error) {
    console.error(" Erro no shutdown:", error);
    showShutdownMessage(" Conexao com servidor perdida");
    showShutdownMessage(" Status: Servidor encerrado no console");
    showShutdownMessage(" Acao: reexecute o servidor para continuar");

    setTimeout(() => {
      attemptWindowClose({
        fallbackDelay: canAttemptDirectWindowClose() ? 900 : 300,
        allowBlankPage: true,
      });
    }, 5000);
  }
}

/**
 * Garante que apenas uma sessao esteja ativa por vez no sistema.
 */
async function ensureSingleActiveSession() {
  try {
    const response = await fetch("/api/sessions/ensure-single", {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Falha ao configurar sessao unica");
    }

    const result = await response.json();
    console.log(" Sessao unica configurada:", result);
    return result;
  } catch (error) {
    console.error(" Erro ao configurar sessao unica:", error);
    throw error;
  }
}

/**
 * Inicializa a sessao automaticamente quando o sistema carrega.
 */
async function initializeSession() {
  console.log(" Verificando sessao...");

  const { isSessionActive } = await import("./session-adapter.js");
  const { loadObrasFromServer } = await import(
    "../adapters/obra-adapter-folder/obra-data-loader.js"
  );

  if (!isSessionActive()) {
    console.log(" Sessao nao esta ativa - aguardando acao do usuario");
    return;
  }

  console.log(" Sessao esta ativa - carregando obras existentes");
  await loadObrasFromServer();
}

/**
 * Mostra mensagem de encerramento elegante na tela.
 */
function showShutdownMessage(message) {
  const existingMessage = document.getElementById("shutdown-message");
  if (existingMessage) {
    existingMessage.remove();
  }

  const messageDiv = document.createElement("div");
  messageDiv.id = "shutdown-message";
  messageDiv.style.cssText = `
 position: fixed;
 top: 0;
 left: 0;
 width: 100%;
 height: 100%;
 background: rgba(0, 0, 0, 0.9);
 color: #fff;
 display: flex;
 justify-content: center;
 align-items: center;
 z-index: 9999;
 font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
 text-align: center;
 backdrop-filter: blur(8px);
 animation: fadeIn 0.5s ease-out forwards;
 `;

  messageDiv.innerHTML = `
 <div style="
 display: flex;
 flex-direction: column;
 align-items: center;
 gap: 20px;
 padding: 40px;
 border-radius: 15px;
 background: rgba(255, 255, 255, 0.1);
 backdrop-filter: blur(10px);
 border: 1px solid rgba(255, 255, 255, 0.2);
 ">
 <div style="
 font-size: 48px;
 margin-bottom: 10px;
 color: #ff6b6b;
 animation: pulse 1.5s infinite;
 "></div>
 <div style="font-size: 24px; font-weight: bold;">${message}</div>
 <div style="
 font-size: 14px;
 margin-top: 10px;
 opacity: 0.7;
 ">Aguarde enquanto o servidor e encerrado...</div>
 </div>
 `;

  const style = document.createElement("style");
  style.textContent = `
 @keyframes fadeIn {
 from { opacity: 0; }
 to { opacity: 1; }
 }
 @keyframes pulse {
 0% { transform: scale(1); opacity: 1; }
 50% { transform: scale(1.1); opacity: 0.8; }
 100% { transform: scale(1); opacity: 1; }
 }
 `;
  document.head.appendChild(style);

  document.body.appendChild(messageDiv);
}

/**
 * Mostra mensagem final de encerramento com confirmacao.
 */
function showFinalShutdownMessage() {
  const messageDiv = document.getElementById("shutdown-message");
  if (!messageDiv) return;

  const helperText = canAttemptDirectWindowClose()
    ? "Esta janela sera fechada automaticamente."
    : "Tentando fechar esta guia. Se o navegador bloquear, uma tela em branco sera aberta para voce fechar manualmente.";

  messageDiv.innerHTML = `
 <div style="
 display: flex;
 flex-direction: column;
 align-items: center;
 gap: 20px;
 padding: 40px;
 border-radius: 15px;
 background: rgba(255, 255, 255, 0.1);
 backdrop-filter: blur(10px);
 border: 1px solid rgba(255, 255, 255, 0.2);
 ">
 <div style="
 font-size: 64px;
 margin-bottom: 10px;
 color: #4CAF50;
 animation: bounce 1s;
 "></div>
 <div style="font-size: 28px; font-weight: bold;">Servidor Encerrado</div>
 <div style="
 font-size: 16px;
 margin-top: 5px;
 opacity: 0.7;
 ">${helperText}</div>
 </div>
 `;

  const style = document.createElement("style");
  style.textContent = `
 @keyframes bounce {
 0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
 40% { transform: translateY(-20px); }
 60% { transform: translateY(-10px); }
 }
 `;
  document.head.appendChild(style);
}

/**
 * Mostra mensagem final com opcoes quando o navegador bloqueia o fechamento.
 */
function showFinalMessageWithManualClose() {
  const messageDiv = document.getElementById("shutdown-message");
  if (!messageDiv) return;

  messageDiv.innerHTML = `
 <div style="
 display: flex;
 flex-direction: column;
 align-items: center;
 gap: 20px;
 padding: 40px;
 border-radius: 15px;
 background: rgba(255, 255, 255, 0.1);
 backdrop-filter: blur(10px);
 border: 1px solid rgba(255, 255, 255, 0.2);
 max-width: 420px;
 ">
 <div style="
 font-size: 48px;
 margin-bottom: 10px;
 color: #4CAF50;
 "></div>
 <div style="font-size: 24px; font-weight: bold; text-align: center;">Servidor Encerrado</div>
 <div style="
 font-size: 14px;
 margin-top: 10px;
 opacity: 0.7;
 text-align: center;
 ">O servidor foi encerrado com sucesso. O navegador pode bloquear o fechamento automatico de abas abertas externamente.</div>
 <button onclick="window.__esiAttemptShutdownWindowClose && window.__esiAttemptShutdownWindowClose({ fallbackDelay: null, allowBlankPage: true })" style="
 margin-top: 20px;
 padding: 10px 20px;
 background: #4CAF50;
 color: white;
 border: none;
 border-radius: 5px;
 cursor: pointer;
 font-size: 14px;
 ">Tentar Fechar</button>
 <button onclick="window.__esiOpenShutdownBlankPage && window.__esiOpenShutdownBlankPage()" style="
 margin-top: 10px;
 padding: 10px 20px;
 background: transparent;
 color: white;
 border: 1px solid rgba(255, 255, 255, 0.35);
 border-radius: 5px;
 cursor: pointer;
 font-size: 14px;
 ">Abrir Tela em Branco</button>
 </div>
 `;
}

window.shutdownManual = shutdownManual;

export { shutdownManual, ensureSingleActiveSession, initializeSession };
