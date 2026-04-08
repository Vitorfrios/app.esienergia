// scripts/03_Edit_data/api.js
// Funções de comunicação com API

import {
  systemData,
  originalData,
  pendingChanges,
  updateSystemData,
  clearPendingChanges,
  updateOriginalData,
  hasRealChanges,
} from "./state.js";
import {
  escapeHtml,
  showLoading,
  hideLoading,
  showSuccess,
  showError,
  showWarning,
  showInfo,
} from "./ui.js";

// Função para debug dos dados
function debugDataValidation() {
  console.group(" DEBUG: Validação de Dados");

  // Verificar estrutura do systemData
  console.log(" systemData structure:", Object.keys(systemData));

  // Verificar dutos
  if (systemData.dutos) {
    console.log(" Dutos:", systemData.dutos.length);
    systemData.dutos.forEach((duto, index) => {
      console.log(` Duto ${index}:`, {
        type: duto.type,
        valor: duto.valor,
        descricao: duto.descricao,
        opcionais: duto.opcionais ? duto.opcionais.length : 0,
      });

      // Verificar problemas específicos
      if (typeof duto.valor !== "number" || isNaN(duto.valor)) {
        console.error(` Duto ${index} tem valor inválido:`, duto.valor);
      }

      // Verificar opcionais
      if (duto.opcionais && Array.isArray(duto.opcionais)) {
        duto.opcionais.forEach((opcional, opcIndex) => {
          if (typeof opcional.value !== "number" || isNaN(opcional.value)) {
            console.error(
              ` Opcional ${opcIndex} tem valor inválido:`,
              opcional.value,
            );
          }
        });
      }
    });
  }

  // Verificar banco_acessorios
  if (systemData.banco_acessorios) {
    console.log(
      " Acessorios:",
      Object.keys(systemData.banco_acessorios).length,
    );
    Object.entries(systemData.banco_acessorios).forEach(
      ([id, equip], index) => {
        console.log(` Acessorio ${index}:`, {
          id,
          codigo: equip.codigo,
          descricao: equip.descricao,
          dimensoes: equip.valores_padrao
            ? Object.keys(equip.valores_padrao).length
            : 0,
        });

        // Verificar problemas
        if (!equip.codigo || equip.codigo.trim() === "") {
          console.error(` Acessorio ${id} não tem código`);
        }
      },
    );
  }

  console.groupEnd();
}

export async function loadData() {
  try {
    showLoading("Carregando dados do sistema...");

    const response = await fetch(`/api/system-data?t=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
    });
    if (!response.ok) {
      throw new Error(`Erro HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data || typeof data !== "object") {
      throw new Error("Dados recebidos são inválidos");
    }

    updateSystemData(data);

    // Notificar outros módulos que os dados foram carregados
    window.dispatchEvent(new CustomEvent("dataLoaded", { detail: data }));

    clearPendingChanges();
    refreshSystemStatus();
    showSuccess("Dados carregados com sucesso!");
  } catch (error) {
    console.error("Erro ao carregar dados:", error);
    showError(`Erro ao carregar dados: ${error.message}`);

    // Fallback
  } finally {
    hideLoading();
  }
}

export async function saveData(options = {}) {
  const { silent = false, keepalive = false } = options;
  try {
    // Verificar se há mudanças reais pendentes
    const realPendingChanges = getRealPendingChanges();

    if (realPendingChanges.size === 0) {
      if (!silent) {
        showInfo("Nenhuma alteração real para salvar.");
      }
      return { success: true, skipped: true, changedSections: [] };
    }

    if (!silent) {
      showLoading("Salvando dados...");
    }

    // Debug: Verificar dados antes da validação
    console.log(" Tentando salvar dados...");
    console.log("Mudanças reais pendentes:", Array.from(realPendingChanges));
    debugDataValidation();

    // Validar dados antes de salvar
    const validateData = window.validateData;
    if (validateData && !validateData()) {
      console.error(" Validação falhou. Dados atuais:");
      console.log(JSON.stringify(systemData, null, 2));
      throw new Error(
        "Dados inválidos encontrados. Verifique o console para detalhes.",
      );
    }

    console.log(" Validação passou. Enviando dados para API...");

    const changedSections = Array.from(realPendingChanges);
    const payload = {
      changed_sections: changedSections,
      data: {}
    };

    changedSections.forEach((section) => {
      payload.data[section] = systemData[section];
    });

    const response = await fetch("/api/system-data/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      keepalive,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Erro HTTP ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      // Atualizar dados originais
      updateOriginalData(systemData);

      clearPendingChanges();
      refreshSystemStatus();
      if (!silent) {
        showSuccess(result.message || "Dados salvos com sucesso!");
      }
      window.dispatchEvent(
        new CustomEvent("dataApplied", {
          detail: {
            data: systemData,
            changes: changedSections,
            source: "saveData"
          }
        })
      );
      return {
        success: true,
        changedSections,
        message: result.message || "Dados salvos com sucesso!",
      };
    } else {
      throw new Error(result.error || "Erro ao salvar dados");
    }
  } catch (error) {
    console.error("Erro ao salvar dados:", error);
    if (!silent) {
      showError(`Erro ao salvar: ${error.message}`);

      // Mostrar detalhes do erro
      showError(
        `Detalhes: ${error.message}. Verifique o console para mais informações.`,
      );
    }
    return { success: false, error: error.message };
  } finally {
    if (!silent) {
      hideLoading();
    }
  }
}

// Função para obter apenas mudanças reais
function getRealPendingChanges() {
  const realChanges = new Set();

  for (const section of pendingChanges) {
    if (hasRealChanges(section)) {
      realChanges.add(section);
    }
  }

  return realChanges;
}

function isOfflineSyncAvailable() {
  const hostname = String(window.location.hostname || "").toLowerCase();
  return !hostname.endsWith(".onrender.com");
}

function updateOfflineSyncButtonsState() {
  const buttons = [
    document.getElementById("importOfflineDatabaseBtn"),
    document.getElementById("exportOfflineDatabaseBtn"),
  ].filter(Boolean);

  if (buttons.length === 0) {
    return;
  }

  const available = isOfflineSyncAvailable();
  buttons.forEach((button) => {
    button.disabled = !available;
    button.style.display = available ? "" : "none";
    button.setAttribute("aria-hidden", available ? "false" : "true");
    button.title = available
      ? "Sincronizacao offline habilitada neste ambiente."
      : "Disponivel apenas fora do ambiente Render.";
  });
}

let offlineReconcileInFlight = false;
let offlineReconnectMonitorStarted = false;
let lastOfflineConflictSignature = "";
let lastOfflineCapacitySignature = "";
let lastOfflineStatusMessage = "";
let systemStatusRefreshInFlight = null;
let lastSystemStatusPayload = null;
let lastSystemStatusFetchedAt = 0;
let offlineSyncAbortController = null;
let systemStatusAbortController = null;
const SYSTEM_STATUS_CACHE_MS = 1500;

function isShutdownInProgress() {
  return (
    window.__esiShutdownInProgress === true ||
    document?.documentElement?.dataset?.shutdownInProgress === "true"
  );
}

function abortAdminBackgroundRequests() {
  if (offlineSyncAbortController) {
    offlineSyncAbortController.abort();
    offlineSyncAbortController = null;
  }

  if (systemStatusAbortController) {
    systemStatusAbortController.abort();
    systemStatusAbortController = null;
  }
}

window.addEventListener("esi:shutdown-start", abortAdminBackgroundRequests);

async function callOfflineSyncEndpoint(endpoint, { silent = false } = {}) {
  if (isShutdownInProgress()) {
    return { success: false, skipped: true, message: "Shutdown em andamento." };
  }

  const controller = new AbortController();
  offlineSyncAbortController = controller;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        result.error || `Falha na sincronizacao (HTTP ${response.status}).`,
      );
      error.isConflict = response.status === 409 || result.conflict === true;
      error.payload = result;
      if (!silent) {
        throw error;
      }
      return { success: false, error: error.message, ...result };
    }

    return result;
  } catch (error) {
    if (controller.signal.aborted || isShutdownInProgress()) {
      return {
        success: false,
        skipped: true,
        message: "Shutdown em andamento.",
      };
    }
    throw error;
  } finally {
    if (offlineSyncAbortController === controller) {
      offlineSyncAbortController = null;
    }
  }
}

function buildOfflineConflictSignature(conflicts) {
  return (conflicts || [])
    .map((item) =>
      JSON.stringify({
        table: item?.table || "",
        item: item?.item || "",
        fields: Array.isArray(item?.field_conflicts)
          ? item.field_conflicts.map((field) => ({
              field: field?.field || "",
              offlineHasValue: Boolean(field?.offline_has_value),
              offlineValue: field?.offline_value ?? null,
              onlineHasValue: Boolean(field?.online_has_value),
              onlineValue: field?.online_value ?? null,
            }))
          : [],
      }),
    )
    .sort()
    .join("|");
}

function getOfflineConflictFieldCount(conflicts) {
  return (conflicts || []).reduce((total, item) => {
    const fieldConflicts = Array.isArray(item?.field_conflicts)
      ? item.field_conflicts.length
      : 0;
    return total + fieldConflicts;
  }, 0);
}

function ensureOfflineConflictModalStyles() {
  if (document.getElementById("offlineConflictModalStyles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "offlineConflictModalStyles";
  style.textContent = `
    .offline-conflict-modal {
      max-width: min(1100px, 96vw);
      max-height: min(88vh, 900px);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      color: #1f2937;
    }

    .offline-conflict-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .offline-conflict-header h3 {
      margin: 0 0 0.35rem;
    }

    .offline-conflict-header p {
      margin: 0;
      color: #475569;
      line-height: 1.5;
    }

    .offline-conflict-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .offline-conflict-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.45rem 0.8rem;
      border-radius: 999px;
      background: #eff6ff;
      color: #1d4ed8;
      font-size: 0.9rem;
      font-weight: 600;
    }

    .offline-conflict-list {
      overflow: auto;
      padding-right: 0.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .offline-conflict-card {
      border: 1px solid #dbeafe;
      border-radius: 16px;
      padding: 1rem;
      background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
    }

    .offline-conflict-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 0.75rem;
    }

    .offline-conflict-card-header h4 {
      margin: 0 0 0.35rem;
      font-size: 1rem;
    }

    .offline-conflict-card-header p {
      margin: 0;
      color: #475569;
      line-height: 1.45;
    }

    .offline-conflict-badge {
      padding: 0.35rem 0.65rem;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 700;
      background: #fff7ed;
      color: #c2410c;
      white-space: nowrap;
    }

    .offline-conflict-merged {
      margin: 0 0 0.9rem;
      color: #166534;
      font-size: 0.9rem;
    }

    .offline-conflict-table-wrap {
      overflow-x: auto;
    }

    .offline-conflict-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
    }

    .offline-conflict-table th,
    .offline-conflict-table td {
      padding: 0.8rem;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: top;
      text-align: left;
    }

    .offline-conflict-table th {
      background: #eff6ff;
      color: #1e3a8a;
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .offline-conflict-value {
      display: inline-flex;
      flex-direction: column;
      gap: 0.45rem;
      align-items: flex-start;
    }

    .offline-conflict-value code {
      display: inline-block;
      white-space: pre-wrap;
      word-break: break-word;
      background: #0f172a;
      color: #f8fafc;
      padding: 0.55rem 0.65rem;
      border-radius: 10px;
      font-size: 0.82rem;
      line-height: 1.45;
      max-width: 320px;
    }

    .offline-conflict-empty {
      color: #64748b;
      font-style: italic;
    }

    .offline-conflict-action-tag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.28rem 0.6rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 700;
    }

    .offline-conflict-action-tag.export {
      background: #dcfce7;
      color: #166534;
    }

    .offline-conflict-action-tag.import {
      background: #dbeafe;
      color: #1d4ed8;
    }

    .offline-conflict-action-copy {
      color: #475569;
      font-size: 0.88rem;
      line-height: 1.45;
    }

    @media (max-width: 768px) {
      .offline-conflict-modal {
        width: 96vw;
        max-height: 94vh;
        padding: 1rem;
      }

      .offline-conflict-header,
      .offline-conflict-card-header {
        flex-direction: column;
      }

      .offline-conflict-table {
        min-width: 620px;
      }
    }
  `;
  document.head.appendChild(style);
}

function stringifyOfflineConflictValue(value, hasValue) {
  if (!hasValue) {
    return '<span class="offline-conflict-empty">Sem valor</span>';
  }

  if (value === null) {
    return "<code>null</code>";
  }

  if (typeof value === "object") {
    const jsonValue = JSON.stringify(value);
    const limitedValue =
      jsonValue && jsonValue.length > 220
        ? `${jsonValue.slice(0, 220)}...`
        : jsonValue || "{}";
    return `<code>${escapeHtml(limitedValue)}</code>`;
  }

  const stringValue = String(value);
  const limitedValue =
    stringValue.length > 220 ? `${stringValue.slice(0, 220)}...` : stringValue;
  return `<code>${escapeHtml(limitedValue)}</code>`;
}

function formatOfflineConflictFieldLabel(fieldName) {
  const normalized = String(fieldName || "")
    .replace(/^raw_json\./, "")
    .replace(/^value_json\./, "")
    .replace(/^payload_json\./, "")
    .replace(/^credenciais_json\./, "credenciais.")
    .replace(/\./g, " > ");
  return normalized || "Campo";
}

function renderOfflineConflictFieldRows(conflict) {
  const fieldConflicts = Array.isArray(conflict?.field_conflicts)
    ? conflict.field_conflicts
    : [];

  if (fieldConflicts.length === 0) {
    return `
      <tr>
        <td colspan="4" class="offline-conflict-action-copy">
          Este registro precisa de revisao manual completa antes da sincronizacao.
        </td>
      </tr>
    `;
  }

  return fieldConflicts
    .map((fieldConflict) => {
      const recommendedAction =
        fieldConflict?.recommended_action === "import" ? "import" : "export";
      const recommendedText =
        recommendedAction === "import"
          ? "Importar o valor online para o computador"
          : "Exportar o valor offline para o banco online";

      return `
        <tr>
          <td><strong>${escapeHtml(formatOfflineConflictFieldLabel(fieldConflict?.field))}</strong></td>
          <td>
            <div class="offline-conflict-value">
              ${stringifyOfflineConflictValue(
                fieldConflict?.offline_value,
                Boolean(fieldConflict?.offline_has_value),
              )}
              <span class="offline-conflict-action-tag export">Exportar</span>
            </div>
          </td>
          <td>
            <div class="offline-conflict-value">
              ${stringifyOfflineConflictValue(
                fieldConflict?.online_value,
                Boolean(fieldConflict?.online_has_value),
              )}
              <span class="offline-conflict-action-tag import">Importar</span>
            </div>
          </td>
          <td class="offline-conflict-action-copy">
            <strong>${escapeHtml(recommendedText)}</strong><br>
            ${escapeHtml(
              fieldConflict?.baseline_has_value
                ? "A ultima base comum tinha outro valor para este campo."
                : "Este campo ainda nao tinha uma base comum entre online e offline.",
            )}
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderOfflineConflictCards(conflicts) {
  return (conflicts || [])
    .map((conflict, index) => {
      const fieldCount = Array.isArray(conflict?.field_conflicts)
        ? conflict.field_conflicts.length
        : 0;
      const autoMerged = Array.isArray(conflict?.auto_merged_columns)
        ? conflict.auto_merged_columns
        : [];

      return `
        <section class="offline-conflict-card">
          <div class="offline-conflict-card-header">
            <div>
              <h4>${escapeHtml(conflict?.item || `Registro ${index + 1}`)}</h4>
              <p>${escapeHtml(
                conflict?.reason ||
                  "O sistema preservou os valores offline e online para evitar perda de dados.",
              )}</p>
            </div>
            <span class="offline-conflict-badge">
              ${fieldCount > 0 ? `${fieldCount} campo(s) em sobreposicao` : "Revisao manual"}
            </span>
          </div>
          ${
            autoMerged.length > 0
              ? `<p class="offline-conflict-merged">Campos sincronizados automaticamente: ${escapeHtml(autoMerged.map(formatOfflineConflictFieldLabel).join(", "))}.</p>`
              : ""
          }
          <div class="offline-conflict-table-wrap">
            <table class="offline-conflict-table">
              <thead>
                <tr>
                  <th>Campo</th>
                  <th>Valor offline</th>
                  <th>Valor online</th>
                  <th>Acao recomendada</th>
                </tr>
              </thead>
              <tbody>
                ${renderOfflineConflictFieldRows(conflict)}
              </tbody>
            </table>
          </div>
        </section>
      `;
    })
    .join("");
}

function openOfflineConflictModal(conflicts) {
  const modal = document.getElementById("offlineConflictModal");
  const content = document.getElementById("offlineConflictModalContent");
  if (!modal || !content) {
    return;
  }

  ensureOfflineConflictModalStyles();

  const conflictCount = (conflicts || []).length;
  const fieldCount = getOfflineConflictFieldCount(conflicts);
  content.innerHTML = `
    <div class="offline-conflict-header">
      <div>
        <h3>Sobreposicao de sincronizacao</h3>
        <p>
          O sistema ja juntou automaticamente os campos que nao colidiam.
          Os itens abaixo precisam de decisao manual para concluir a sincronizacao.
        </p>
      </div>
      <button class="btn btn-secondary btn-small" type="button" onclick="closeOfflineConflictModal()">
        Fechar
      </button>
    </div>
    <div class="offline-conflict-summary">
      <span class="offline-conflict-pill">${conflictCount} registro(s) com revisao</span>
      <span class="offline-conflict-pill">${fieldCount} campo(s) em sobreposicao</span>
      <span class="offline-conflict-pill">Recomendacao padrao: Exportar valor offline</span>
    </div>
    <div class="offline-conflict-list">
      ${renderOfflineConflictCards(conflicts)}
    </div>
    <div class="modal-actions">
      <button class="btn btn-info" type="button" onclick="runOfflineConflictSync('import')">
        Importar valores online
      </button>
      <button class="btn btn-warning" type="button" onclick="runOfflineConflictSync('export')">
        Exportar valores offline
      </button>
      <button class="btn btn-secondary" type="button" onclick="closeOfflineConflictModal()">
        Decidir depois
      </button>
    </div>
  `;
  modal.style.display = "flex";
}

function closeOfflineConflictModal() {
  const modal = document.getElementById("offlineConflictModal");
  if (modal) {
    modal.style.display = "none";
  }
}

async function runOfflineConflictSync(action) {
  closeOfflineConflictModal();
  if (action === "import") {
    return importOnlineToOffline();
  }
  return exportOfflineToOnline();
}

function notifyOfflineReconcileWarnings(result) {
  const conflicts = Array.isArray(result?.conflicts) ? result.conflicts : [];
  const conflictSignature = buildOfflineConflictSignature(conflicts);
  if (conflicts.length > 0 && conflictSignature !== lastOfflineConflictSignature) {
    lastOfflineConflictSignature = conflictSignature;
    const fieldCount = getOfflineConflictFieldCount(conflicts);
    const listedItems = conflicts
      .slice(0, 3)
      .map((item) => item.item)
      .filter(Boolean)
      .join(", ");
    const warningMessage = listedItems
      ? `Foram encontrados ${fieldCount || conflicts.length} campo(s) com sobreposicao em ${conflicts.length} item(ns): ${listedItems}. Revise e escolha Importar ou Exportar.`
      : `Foram encontrados ${fieldCount || conflicts.length} campo(s) com sobreposicao. Revise e escolha Importar ou Exportar.`;
    showWarning(warningMessage);
    openOfflineConflictModal(conflicts);
    console.warn(" Itens com dupla modificacao online/offline:", conflicts);
  } else if (conflicts.length === 0) {
    lastOfflineConflictSignature = "";
    closeOfflineConflictModal();
  }

  const blockedCount = Number(result?.blocked_offline_to_online_count || 0);
  const capacitySignature = `${blockedCount}:${result?.storage_status?.percent_used || 0}`;
  if (blockedCount > 0 && capacitySignature !== lastOfflineCapacitySignature) {
    lastOfflineCapacitySignature = capacitySignature;
    showWarning(
      `${blockedCount} alteracao(oes) offline ficaram pendentes porque o online esta sem espaco suficiente no momento.`,
    );
  } else if (blockedCount === 0) {
    lastOfflineCapacitySignature = "";
  }
}

function resolveFriendlyOfflineSyncMessage(result) {
  if (!result || typeof result !== "object") {
    return "Nao foi possivel concluir a sincronizacao agora.";
  }

  if (result.manual_sync_required || result.failure_stage === "manual-sync-required") {
    return "Historico restaurado, usando dados offline. Recomendado exportar para sincronizar.";
  }

  if (result.storage_guard_active || result.failure_stage === "storage-guard") {
    return (
      result.message ||
      "Banco online com pouco espaco. Sistema usando base local ate o uso cair para 80%."
    );
  }

  if (result.failure_stage === "connect-online" || result.online_available === false) {
    return "Banco online indisponivel. Sistema usando o banco local no momento.";
  }

  if (result.failure_stage === "reconcile-runtime") {
    return "Banco online disponivel. Sistema usando o banco local no momento.";
  }

  if (result.success && result.skipped) {
    return "Seus dados ja estavam atualizados entre a copia local e o banco online.";
  }

  if (result.success) {
    return result.message || "Sincronizacao concluida com sucesso.";
  }

  if (result.skipped) {
    return (
      result.message ||
      "A sincronizacao nao precisou alterar seus dados locais neste momento."
    );
  }

  return result.message || result.error || "Nao foi possivel concluir a sincronizacao agora.";
}

function applySystemStatusPayload(payload) {
  const badge = document.getElementById("systemStatusBadge");
  const text = document.getElementById("systemStatusText");
  const notice = document.getElementById("offlineSyncNotice");

  if (!badge || !text || !notice || !payload || typeof payload !== "object") {
    return;
  }

  const mode = payload.data_source_mode === "online" ? "online" : "offline";
  const summary =
    payload.data_source_summary ||
    (mode === "online"
      ? "Sistema usando base online."
      : "Sistema usando base local.");

  badge.classList.remove("online", "offline");
  badge.classList.add(mode);
  text.textContent = summary;

  const pendingMessage = String(payload.pending_sync_message || "").trim();
  if (pendingMessage) {
    notice.textContent = pendingMessage;
    notice.style.display = "";
  } else {
    notice.textContent = "";
    notice.style.display = "none";
  }
}

function applyBootstrapSystemStatus() {
  const bootstrapPayload =
    window.__SYSTEM_BOOTSTRAP__ && typeof window.__SYSTEM_BOOTSTRAP__ === "object"
      ? window.__SYSTEM_BOOTSTRAP__
      : null;

  const storageStatus = bootstrapPayload?.storage_status;
  if (storageStatus && typeof storageStatus === "object") {
    applySystemStatusPayload(storageStatus);
    return true;
  }

  return false;
}

async function refreshSystemStatus() {
  if (isShutdownInProgress()) {
    return null;
  }

  const now = Date.now();
  if (systemStatusRefreshInFlight) {
    return systemStatusRefreshInFlight;
  }

  if (lastSystemStatusPayload && now - lastSystemStatusFetchedAt < SYSTEM_STATUS_CACHE_MS) {
    applySystemStatusPayload(lastSystemStatusPayload);
    return lastSystemStatusPayload;
  }

  try {
    systemStatusAbortController = new AbortController();
    systemStatusRefreshInFlight = fetch(`/api/system/storage-status?t=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
      signal: systemStatusAbortController.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Erro HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        lastSystemStatusPayload = payload;
        lastSystemStatusFetchedAt = Date.now();
        if (window.__SYSTEM_BOOTSTRAP__ && typeof window.__SYSTEM_BOOTSTRAP__ === "object") {
          window.__SYSTEM_BOOTSTRAP__.storage_status = payload;
        }
        applySystemStatusPayload(payload);
        return payload;
      })
      .finally(() => {
        systemStatusRefreshInFlight = null;
        systemStatusAbortController = null;
      });

    return await systemStatusRefreshInFlight;
  } catch (error) {
    if (isShutdownInProgress()) {
      systemStatusRefreshInFlight = null;
      systemStatusAbortController = null;
      return null;
    }
    console.warn(" Falha ao atualizar status do sistema:", error);
    systemStatusRefreshInFlight = null;
    systemStatusAbortController = null;
    return null;
  }
}

function notifyOfflineStatusMessage(result) {
  const friendlyMessage = resolveFriendlyOfflineSyncMessage(result);
  const manualSyncRequired =
    result?.manual_sync_required || result?.failure_stage === "manual-sync-required";
  const shouldNotify =
    friendlyMessage &&
    friendlyMessage !== lastOfflineStatusMessage &&
    (manualSyncRequired ||
      result?.failure_stage === "connect-online" ||
      result?.failure_stage === "reconcile-runtime");

  if (!shouldNotify) {
    return;
  }

  lastOfflineStatusMessage = friendlyMessage;
  showInfo(friendlyMessage);
  refreshSystemStatus();
}

async function reconcileOfflineAndOnline({
  endpoint = "/api/system/offline/reconcile",
} = {}) {
  if (isShutdownInProgress()) {
    return { success: false, skipped: true, message: "Shutdown em andamento." };
  }

  if (!isOfflineSyncAvailable()) {
    return { success: false, skipped: true };
  }

  if (offlineReconcileInFlight) {
    return {
      success: false,
      skipped: true,
      message: "Uma reconciliacao offline/online ja esta em andamento.",
    };
  }

  offlineReconcileInFlight = true;
  try {
    const result = await callOfflineSyncEndpoint(endpoint, { silent: true });
    notifyOfflineReconcileWarnings(result);
    notifyOfflineStatusMessage(result);
    refreshSystemStatus();

    if (result?.success) {
      console.log(resolveFriendlyOfflineSyncMessage(result));
      return result;
    }

    if (result?.skipped) {
      console.info(resolveFriendlyOfflineSyncMessage(result));
      return result;
    }

    console.warn(
      " Falha na reconciliacao offline/online:",
      result?.error || result?.message || "erro desconhecido",
    );
    return result;
  } catch (error) {
    if (isShutdownInProgress()) {
      return { success: false, skipped: true, message: "Shutdown em andamento." };
    }
    console.warn(" Falha na reconciliacao offline/online:", error);
    return { success: false, error: error.message };
  } finally {
    offlineReconcileInFlight = false;
  }
}

async function backgroundSyncOfflineAfterSave() {
  return {
    success: true,
    skipped: true,
    message: "Sincronizacao automatica desativada. Use Importar ou Exportar manualmente.",
  };
}

export async function importOnlineToOffline() {
  try {
    const realPendingChanges = getRealPendingChanges();
    if (realPendingChanges.size > 0) {
      showLoading("Salvando alteracoes antes da importacao...");
      const saveResult = await saveDataWithFix({ silent: true });
      if (!saveResult?.success) {
        throw new Error(
          saveResult?.error ||
            "Nao foi possivel salvar as alteracoes antes da importacao.",
        );
      }
    }

    showLoading("Importando dados online para o banco offline...");
    const result = await callOfflineSyncEndpoint("/api/system/offline/import");

    const totalRegistros = Object.values(result.table_counts || {}).reduce(
      (total, count) => total + Number(count || 0),
      0,
    );

    showSuccess(
      `Importacao concluida. ${totalRegistros} registros copiados para database/app.sqlite3.`,
    );

    if (result.sql_dump_path) {
      showInfo("Copia de seguranca de dados local atualizada com sucesso.");
    }

    refreshSystemStatus();
    await loadData();

    return result;
  } catch (error) {
    console.error("Erro ao importar online para offline:", error);
    showError(`Erro ao importar: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    hideLoading();
  }
}

export async function exportOfflineToOnline() {
  try {
    showLoading("Exportando banco offline para o online...");
    const result = await callOfflineSyncEndpoint("/api/system/offline/export");

    if (result?.skipped) {
      showInfo(result.message || "Nenhuma alteracao offline pendente para exportar.");
      return result;
    }

    showSuccess(result.message || "Banco offline exportado com sucesso.");
    refreshSystemStatus();
    await loadData();
    return result;
  } catch (error) {
    console.error("Erro ao exportar offline para online:", error);
    showError(`Erro ao exportar: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    hideLoading();
  }
}

window.closeOfflineConflictModal = closeOfflineConflictModal;
window.runOfflineConflictSync = runOfflineConflictSync;

function startOfflineReconnectMonitor() {
  if (!isOfflineSyncAvailable() || offlineReconnectMonitorStarted) {
    return;
  }

  offlineReconnectMonitorStarted = true;
  let onlineRecoveryChecked = false;

  const triggerReconcile = () => {
    if (onlineRecoveryChecked) {
      return;
    }
    onlineRecoveryChecked = true;
    reconcileOfflineAndOnline();
  };

  window.addEventListener("online", triggerReconcile);
  setTimeout(triggerReconcile, 2000);
}

// Função para corrigir dados automaticamente
export function fixDataIssues() {
  try {
    console.log(" Corrigindo problemas de dados...");
    let fixedIssues = 0;

    // Corrigir dutos
    if (systemData.dutos && Array.isArray(systemData.dutos)) {
      systemData.dutos.forEach((duto, index) => {
        // Garantir que valor é número
        if (typeof duto.valor !== "number" || isNaN(duto.valor)) {
          console.warn(`Corrigindo valor do duto ${index}: ${duto.valor} -> 0`);
          duto.valor = 0;
          fixedIssues++;
        }

        // Garantir que type é string
        if (typeof duto.type !== "string") {
          duto.type = String(duto.type || "Duto sem nome");
          fixedIssues++;
        }

        // Garantir que descricao é string
        if (duto.descricao && typeof duto.descricao !== "string") {
          duto.descricao = String(duto.descricao);
          fixedIssues++;
        }

        // Corrigir opcionais
        if (duto.opcionais) {
          if (!Array.isArray(duto.opcionais)) {
            duto.opcionais = [];
            fixedIssues++;
          } else {
            duto.opcionais.forEach((opcional, opcIndex) => {
              if (typeof opcional.value !== "number" || isNaN(opcional.value)) {
                opcional.value = 0;
                fixedIssues++;
              }
            });
          }
        }
      });
    }

    // Corrigir acessorios
    if (
      systemData.banco_acessorios &&
      typeof systemData.banco_acessorios === "object"
    ) {
      Object.entries(systemData.banco_acessorios).forEach(([id, equip]) => {
        // Garantir código
        if (!equip.codigo || typeof equip.codigo !== "string") {
          equip.codigo = `EQP_${Date.now().toString().slice(-6)}`;
          fixedIssues++;
        }

        // Garantir descrição
        if (typeof equip.descricao !== "string") {
          equip.descricao = String(
            equip.descricao || "Acessorio sem descrição",
          );
          fixedIssues++;
        }

        // Garantir valores_padrao
        if (!equip.valores_padrao || typeof equip.valores_padrao !== "object") {
          equip.valores_padrao = {};
          fixedIssues++;
        }
      });
    }

    if (fixedIssues > 0) {
      console.log(` ${fixedIssues} problemas corrigidos automaticamente.`);
      showInfo(`${fixedIssues} problemas de dados corrigidos automaticamente.`);

      // Atualizar referências globais
      if (window.dutosData && systemData.dutos) {
        window.dutosData = systemData.dutos;
      }

      if (window.acessoriesData && systemData.banco_acessorios) {
        window.acessoriesData = systemData.banco_acessorios;
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error("Erro ao corrigir dados:", error);
    return false;
  }
}

// Função de salvamento com correção automática
export async function saveDataWithFix(options = {}) {
  try {
    // Primeiro tentar corrigir problemas
    const issuesFixed = fixDataIssues();

    if (issuesFixed) {
      if (!options.silent) {
        showWarning(
          "Problemas de dados corrigidos. Tentando salvar novamente...",
        );
        setTimeout(() => saveData(options), 1000);
        return { success: true, deferred: true };
      }

      return saveData(options);
    } else {
      // Se não há problemas, salvar normalmente
      return await saveData(options);
    }
  } catch (error) {
    console.error("Erro no salvamento com correção:", error);
    if (!options.silent) {
      showError(`Erro ao salvar: ${error.message}`);
    }
    return { success: false, error: error.message };
  }
}

export async function saveDataSilently(options = {}) {
  return saveDataWithFix({ ...options, silent: true });
}

// Exportar funções globalmente
window.loadData = loadData;
window.saveData = saveDataWithFix; // Usar versão com correção
window.saveDataSilently = saveDataSilently;
window.fixDataIssues = fixDataIssues;
window.debugDataValidation = debugDataValidation;
window.importOnlineToOffline = importOnlineToOffline;
window.exportOfflineToOnline = exportOfflineToOnline;
window.addEventListener("DOMContentLoaded", () => {
  updateOfflineSyncButtonsState();
  if (!applyBootstrapSystemStatus()) {
    refreshSystemStatus();
  }
  startOfflineReconnectMonitor();
});
