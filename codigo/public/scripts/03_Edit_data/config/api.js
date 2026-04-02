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

    const response = await fetch("/api/system-data");
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
      backgroundSyncOfflineAfterSave();
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
    button.title = available
      ? "Sincronizacao offline habilitada neste ambiente."
      : "Disponivel apenas fora do ambiente Render.";
  });
}

let offlineReconcileInFlight = false;
let offlineReconnectMonitorStarted = false;
let lastOfflineConflictSignature = "";
let lastOfflineCapacitySignature = "";

async function callOfflineSyncEndpoint(endpoint, { silent = false } = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
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
}

function buildOfflineConflictSignature(conflicts) {
  return (conflicts || [])
    .map((item) => `${item.table || ""}:${item.item || ""}`)
    .sort()
    .join("|");
}

function notifyOfflineReconcileWarnings(result) {
  const conflicts = Array.isArray(result?.conflicts) ? result.conflicts : [];
  const conflictSignature = buildOfflineConflictSignature(conflicts);
  if (conflicts.length > 0 && conflictSignature !== lastOfflineConflictSignature) {
    lastOfflineConflictSignature = conflictSignature;
    const listedItems = conflicts
      .slice(0, 3)
      .map((item) => item.item)
      .filter(Boolean)
      .join(", ");
    const warningMessage = listedItems
      ? `Desincronizacao detectada em ${conflicts.length} item(ns): ${listedItems}. Sugestao: verificar antes de sincronizar manualmente.`
      : `Desincronizacao detectada em ${conflicts.length} item(ns). Sugestao: verificar antes de sincronizar manualmente.`;
    showWarning(warningMessage);
    console.warn(" Itens com dupla modificacao online/offline:", conflicts);
  } else if (conflicts.length === 0) {
    lastOfflineConflictSignature = "";
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

async function reconcileOfflineAndOnline({
  endpoint = "/api/system/offline/reconcile",
} = {}) {
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

    if (result?.success) {
      console.log(
        result?.message || " Reconciliacao offline/online executada com sucesso.",
      );
      return result;
    }

    if (result?.skipped) {
      console.info(
        result?.message ||
          " Reconciliacao offline/online preservou o estado local.",
      );
      return result;
    }

    console.warn(
      " Falha na reconciliacao offline/online:",
      result?.error || result?.message || "erro desconhecido",
    );
    return result;
  } catch (error) {
    console.warn(" Falha na reconciliacao offline/online:", error);
    return { success: false, error: error.message };
  } finally {
    offlineReconcileInFlight = false;
  }
}

async function backgroundSyncOfflineAfterSave() {
  return reconcileOfflineAndOnline({
    endpoint: "/api/system/offline/background-save",
  });
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

function startOfflineReconnectMonitor() {
  if (!isOfflineSyncAvailable() || offlineReconnectMonitorStarted) {
    return;
  }

  offlineReconnectMonitorStarted = true;

  const triggerReconcile = () => {
    reconcileOfflineAndOnline();
  };

  window.addEventListener("online", triggerReconcile);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      triggerReconcile();
    }
  });

  setTimeout(triggerReconcile, 2000);
  window.setInterval(triggerReconcile, 60000);
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
  startOfflineReconnectMonitor();
});
