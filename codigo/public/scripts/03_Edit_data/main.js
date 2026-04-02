// scripts/03_Edit_data/main.js
import { createSmartLogger } from "../01_Create_Obra/core/logger.js";
import "../01_Create_Obra/core/system-bootstrap.js";
import { pendingChanges, hasRealChanges } from "./config/state.js";
import { saveDataSilently } from "./config/api.js";
import "./config/ui.js";
import "./core/constants.js";
import "./core/machines.js";
import "./core/materials.js";
import "./core/empresas.js";
import "./core/acessorios.js";
import "./core/dutos.js";
import "./core/tubos.js";
import { initializeDashboard } from "./core/dashboard-summary.js";
import { initializeAdminCredentials } from "./core/admin-credentials.js";

// ==================== CONFIGURAÇÃO INICIAL ====================

// INICIALIZAR LOGGER IMEDIATAMENTE
window.logger = createSmartLogger();

// EXPOR FUNÇÃO GLOBAL PARA CONTROLE DO LOGGER
window.toggleSystemLogger = function (enable = null) {
  if (window.logger && typeof window.toggleLogger === "function") {
    return window.toggleLogger(enable);
  } else {
    console.warn(" Logger não disponível para controle");
    return false;
  }
};

// Função para garantir que systemData tenha estrutura completa
function normalizeADMData(admData, legacyAdministradores = null) {
  const source = admData ?? legacyAdministradores;

  if (Array.isArray(source)) {
    return source
      .filter((admin) => admin && typeof admin === "object")
      .map((admin) => ({ ...admin }));
  }

  if (source && typeof source === "object") {
    return [{ ...source }];
  }

  return [];
}

function ensureCompleteSystemData(data) {
  if (!data || typeof data !== "object") {
    return {
      ADM: [],
      constants: {},
      machines: [],
      materials: {},
      empresas: [],
      banco_acessorios: {},
      dutos: {
        tipos: [],
        opcionais: [],
      },
      tubos: [],
    };
  }

  const { administradores, ...sanitizedData } = data;

  return {
    ...sanitizedData,
    ADM: normalizeADMData(data.ADM, administradores),
    constants: data.constants || {},
    machines: data.machines || [],
    materials: data.materials || {},
    empresas: data.empresas || [],
    banco_acessorios: data.banco_acessorios || {},
    dutos: data.dutos || {
      tipos: [],
      opcionais: [],
    },
    tubos: Array.isArray(data.tubos) ? data.tubos : [],
  };
}

// Sobrescrever o setter de window.systemData para garantir estrutura
Object.defineProperty(window, "systemData", {
  get() {
    return window._systemData;
  },
  set(value) {
    console.log(" systemData sendo definido...");

    // Sempre garante estrutura completa
    window._systemData = ensureCompleteSystemData(value);

    console.log(" systemData corrigido:", {
      ADM: window._systemData.ADM.length,
      constants: Object.keys(window._systemData.constants).length,
      machines: window._systemData.machines.length,
      materials: Object.keys(window._systemData.materials).length,
      empresas: window._systemData.empresas.length,
      banco_acessorios: Object.keys(window._systemData.banco_acessorios).length,
      dutos: {
        tipos: window._systemData.dutos?.tipos?.length || 0,
        opcionais: window._systemData.dutos?.opcionais?.length || 0,
      },
      tubos: window._systemData.tubos?.length || 0,
    });
  },
  configurable: true,
  enumerable: true,
});

// Inicializar systemData vazio
window._systemData = ensureCompleteSystemData({});

function ensureLoadDataFunction() {
  window.loadData =
    window.loadData ||
    async function () {
      console.log("Carregando dados do sistema...");

      const response = await fetch(`/api/system-data?t=${Date.now()}`, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
      });
      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (typeof window.updateSystemData === "function") {
        window.updateSystemData(data);
      }

      window.dispatchEvent(
        new CustomEvent("dataLoaded", {
          detail: data,
        }),
      );

      return data;
    };
}

function refreshAdminArea() {
  initializeDashboard();
  initializeAdminCredentials();
}

function safeInvokeLoader(loaderName, loaderFn) {
  if (typeof loaderFn !== "function") {
    return;
  }

  try {
    loaderFn();
  } catch (error) {
    console.error(` Falha ao atualizar modulo ${loaderName}:`, error);
  }
}

function refreshChangedSections(changes = [], options = {}) {
  const normalizedChanges = Array.isArray(changes) ? changes : [];
  const refreshJsonEditor = options.refreshJsonEditor !== false;
  const refreshDashboard = options.refreshDashboard !== false;

  const loadersBySection = {
    constants: () => safeInvokeLoader("constants", window.loadConstants),
    machines: () => {
      safeInvokeLoader("machines", window.loadMachines);
      safeInvokeLoader("machines-filter", window.filterMachines);
    },
    materials: () => safeInvokeLoader("materials", window.loadMaterials),
    empresas: () => safeInvokeLoader("empresas", window.loadEmpresas),
    banco_acessorios: () =>
      safeInvokeLoader("acessorios", window.loadAcessorios),
    dutos: () => safeInvokeLoader("dutos", window.loadDutos),
    tubos: () => safeInvokeLoader("tubos", window.loadTubos),
    ADM: () => safeInvokeLoader("admin-credentials", initializeAdminCredentials),
  };

  normalizedChanges.forEach((section) => {
    const loader = loadersBySection[section];
    if (typeof loader === "function") {
      loader();
    }
  });

  if (refreshDashboard && normalizedChanges.length > 0) {
    safeInvokeLoader("dashboard", initializeDashboard);
  }

  if (refreshJsonEditor && window.loadJSONEditor) {
    safeInvokeLoader("json-editor", window.loadJSONEditor);
  }
}

function refreshAllAdminViews() {
  refreshChangedSections(
    [
      "constants",
      "machines",
      "materials",
      "empresas",
      "banco_acessorios",
      "dutos",
      "tubos",
      "ADM",
    ],
    {
      refreshJsonEditor: true,
      refreshDashboard: true,
    },
  );
}

function hasUnsavedAdminDataChanges() {
  for (const section of pendingChanges) {
    if (hasRealChanges(section)) {
      return true;
    }
  }

  return false;
}

async function autoSaveAdminDataBeforeNavigation(options = {}) {
  if (!hasUnsavedAdminDataChanges()) {
    return { success: true, skipped: true };
  }

  if (window.__adminDataAutoSavePromise) {
    return window.__adminDataAutoSavePromise;
  }

  window.__adminDataAutoSavePromise = saveDataSilently(options).finally(() => {
    window.__adminDataAutoSavePromise = null;
  });

  return window.__adminDataAutoSavePromise;
}

function resolveAutosaveNavigationTarget(target) {
  const link = target.closest?.("a[href]");
  if (link && !link.target) {
    return {
      url: link.href,
      replace: false,
    };
  }

  const clickable = target.closest?.("[onclick]");
  const onclick = clickable?.getAttribute("onclick") || "";
  const hrefMatch =
    onclick.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i) ||
    onclick.match(/window\.location\.replace\(\s*['"]([^'"]+)['"]\s*\)/i);

  if (!hrefMatch) {
    return null;
  }

  return {
    url: new URL(hrefMatch[1], window.location.origin).toString(),
    replace: /window\.location\.replace/i.test(hrefMatch[0]),
  };
}

function isMeaningfulNavigation(targetUrl) {
  try {
    const currentUrl = new URL(window.location.href);
    const nextUrl = new URL(targetUrl, window.location.origin);

    currentUrl.hash = "";
    nextUrl.hash = "";

    return currentUrl.toString() !== nextUrl.toString();
  } catch (error) {
    console.warn("Falha ao analisar navegação para autosave:", error);
    return false;
  }
}

async function navigateWithAutoSave(url, { replace = false } = {}) {
  const result = await autoSaveAdminDataBeforeNavigation();

  if (result?.success === false) {
    return false;
  }

  if (replace) {
    window.location.replace(url);
  } else {
    window.location.href = url;
  }

  return true;
}

function bindAutoSaveNavigation() {
  document.addEventListener(
    "click",
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const navigationTarget = resolveAutosaveNavigationTarget(event.target);
      if (!navigationTarget || !navigationTarget.url) {
        return;
      }

      if (!isMeaningfulNavigation(navigationTarget.url)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      void navigateWithAutoSave(navigationTarget.url, {
        replace: navigationTarget.replace,
      });
    },
    true,
  );

  window.addEventListener("pagehide", () => {
    if (hasUnsavedAdminDataChanges()) {
      void autoSaveAdminDataBeforeNavigation({ keepalive: true });
    }
  });
}

// ==================== INICIALIZAÇÃO PRINCIPAL ====================

document.addEventListener("DOMContentLoaded", async function () {
  console.log(" Sistema de Edição de Dados iniciado");

  window.navigateWithAutoSave = navigateWithAutoSave;
  bindAutoSaveNavigation();

  // Carregar todos os módulos
  ensureLoadDataFunction();

  // Inicializar sistema de staging
  window.stagingData = null;
  window.hasPendingChanges = false;

  // Inicializar módulos das novas abas
  initializeDashboard();
  initializeAdminCredentials();

  // Função para forçar atualização do editor quando a tab é aberta
  window.activateJSONTab = function () {
    console.log(" Ativando visualizador JSON...");

    if (typeof window.loadJSONEditor === "function") {
      setTimeout(() => {
        window.loadJSONEditor();
      }, 100);
    }
  };

  // Carregar dados iniciais
  setTimeout(async () => {
    console.log(" Iniciando carregamento de dados...");

    if (typeof window.loadData === "function") {
      try {
        // Força o carregamento dos dados
        await window.loadData();

        // Verifica se os dados foram carregados corretamente
        console.log(" Dados carregados. Verificando estrutura...");
        console.log(" window.systemData:", window.systemData);
        console.log(
          " Tem banco_acessorios?",
          "banco_acessorios" in window.systemData,
        );
        console.log(" Tem dutos?", "dutos" in window.systemData);
        console.log(" Tem tubos?", "tubos" in window.systemData);
        console.log(" Tem ADM?", "ADM" in window.systemData);

        // Atualiza as novas abas
        initializeDashboard();
        initializeAdminCredentials();

        // Atualiza o visualizador com os dados carregados
        if (typeof window.loadJSONEditor === "function") {
          setTimeout(window.loadJSONEditor, 200);
        }
      } catch (error) {
        console.error(" Erro ao carregar dados:", error);

        // Mesmo com erro, atualiza o visualizador com estrutura vazia
        if (typeof window.loadJSONEditor === "function") {
          setTimeout(window.loadJSONEditor, 200);
        }
      }
    } else {
      console.warn(" Função loadData não encontrada");
      // Atualiza visualizador com estrutura vazia
      if (typeof window.loadJSONEditor === "function") {
        setTimeout(window.loadJSONEditor, 200);
      }
    }
  }, 500);
});

// ==================== FUNÇÕES GLOBAIS ====================

// Funções globais para modais
window.confirmAction = function (confirmed) {
  const modal = document.getElementById("confirmationModal");
  if (modal) modal.style.display = "none";

  if (confirmed && window.confirmCallback) {
    window.confirmCallback();
    window.confirmCallback = null;
  }
};

window.closeEditModal = function () {
  const modal = document.getElementById("editModal");
  if (modal) modal.style.display = "none";
};

window.saveEdit = function () {
  closeEditModal();
};

// ==================== MANIPULAÇÃO DE TABS ====================

// Função principal para alternar entre tabs
window.switchTab = function (tabName) {
  console.log(` Alternando para tab: ${tabName}`);

  // Esconder todas as tabs
  document.querySelectorAll(".tab-pane").forEach((tab) => {
    tab.classList.remove("active");
    tab.style.display = "none";
  });

  // Remover active de todos os botões
  document.querySelectorAll(".tabs .tab").forEach((tabBtn) => {
    tabBtn.classList.remove("active");
  });

  // Mostrar tab selecionada
  const tabElement = document.getElementById(tabName + "Tab");
  if (tabElement) {
    tabElement.classList.add("active");
    tabElement.style.display = "block";

    // Ativar botão correspondente
    const tabButtons = document.querySelectorAll(".tabs .tab");
    tabButtons.forEach((btn) => {
      const btnText = btn.textContent.toLowerCase().replace(/[^a-z]/g, "");
      const tabNameClean = tabName.toLowerCase().replace(/[^a-z]/g, "");

      if (
        btnText.includes(tabNameClean) ||
        btn.getAttribute("onclick")?.includes(tabName)
      ) {
        btn.classList.add("active");
      }
    });

    // Disparar evento personalizado
    const event = new CustomEvent("tabChanged", {
      detail: { tab: tabName },
    });
    document.dispatchEvent(event);

    // Ações específicas por tab
    setTimeout(() => {
      switch (tabName) {
        case "dashboard":
          console.log(" Inicializando dashboard");
          initializeDashboard();
          break;

        case "adminCredentials":
          console.log(" Inicializando credenciais do ADM");
          initializeAdminCredentials();
          break;

        case "dutos":
          console.log(" Tab de dutos ativada");
          if (typeof window.loadDutos === "function") {
            window.loadDutos();
          }
          break;

        case "tubos":
          console.log(" Tab de tubos ativada");
          if (typeof window.loadTubos === "function") {
            window.loadTubos();
          }
          break;

        case "acessories":
        case "acessorios":
          console.log(" Tab de acessórios ativada");
          if (typeof window.loadAcessorios === "function") {
            window.loadAcessorios();
          } else if (typeof window.loadAcessoriesData === "function") {
            window.loadAcessoriesData();
          }
          break;

        case "constants":
          console.log(" Tab de constantes ativada");
          if (typeof window.loadConstants === "function") {
            window.loadConstants();
          }
          break;

        case "machines":
          console.log(" Tab de máquinas ativada");
          if (typeof window.loadMachines === "function") {
            window.loadMachines();
          }
          break;

        case "materials":
          console.log(" Tab de materiais ativada");
          if (typeof window.loadMaterials === "function") {
            window.loadMaterials();
          }
          break;

        case "empresas":
          console.log(" Tab de empresas ativada");
          if (typeof window.loadEmpresas === "function") {
            window.loadEmpresas();
          }
          break;

        case "raw":
          console.log(" Tab JSON ativada");
          if (typeof window.loadJSONEditor === "function") {
            window.loadJSONEditor();
          }
          break;
      }
    }, 100);
  }
};

// Adiciona evento para quando as tabs forem clicadas
document.addEventListener("DOMContentLoaded", function () {
  // Encontra todas as tabs
  const tabs = document.querySelectorAll(".tab");

  tabs.forEach((tab) => {
    tab.addEventListener("click", function () {
      const tabText = this.textContent.toLowerCase();

      // Mapear texto da tab para nome da tab
      if (tabText.includes("dashboard")) {
        // Já tratado pelo onclick
      } else if (tabText.includes("credenciais") || tabText.includes("adm")) {
        // Já tratado pelo onclick
      } else if (
        tabText.includes("json") ||
        tabText.includes("raw") ||
        tabText.includes("bruto")
      ) {
        console.log(" Tab JSON clicada, atualizando visualizador...");

        setTimeout(() => {
          if (typeof window.loadJSONEditor === "function") {
            window.loadJSONEditor();
          }
        }, 150);
      } else if (tabText.includes("dutos") || tabText.includes("duto")) {
        console.log(" Tab de dutos clicada");

        setTimeout(() => {
          if (typeof window.loadDutos === "function") {
            window.loadDutos();
          }
        }, 150);
      } else if (tabText.includes("tubos") || tabText.includes("tubo")) {
        console.log(" Tab de tubos clicada");

        setTimeout(() => {
          if (typeof window.loadTubos === "function") {
            window.loadTubos();
          }
        }, 150);
      } else if (
        tabText.includes("acessorio") ||
        tabText.includes("acessorie")
      ) {
        console.log(" Tab de acessórios clicada");

        setTimeout(() => {
          if (typeof window.loadAcessorios === "function") {
            window.loadAcessorios();
          } else if (typeof window.loadAcessoriesData === "function") {
            window.loadAcessoriesData();
          }
        }, 150);
      }
    });
  });

  // Inicializar a tab ativa se houver
  const activeTab = document.querySelector(".tab.active");
  if (activeTab) {
    const onclickAttr = activeTab.getAttribute("onclick");
    if (onclickAttr) {
      const match = onclickAttr.match(/'([^']+)'/);
      if (match && match[1]) {
        setTimeout(() => {
          if (match[1] === "dashboard") {
            initializeDashboard();
          } else if (match[1] === "adminCredentials") {
            initializeAdminCredentials();
          }
        }, 200);
      }
    }
  }
});

// ==================== MÓDULO JSON VIEWER ====================

const jsonViewerModule = {
  loadJSONEditor: function () {
    console.log(" Carregando visualizador JSON...");
    const editor = document.getElementById("jsonEditor");
    if (!editor) {
      console.warn(" Visualizador JSON não encontrado");
      return;
    }

    const systemData = window.systemData || {};
    console.log(" Dados para o visualizador:", {
      banco_acessorios: Object.keys(systemData.banco_acessorios || {}).length,
      dutos: {
        tipos: systemData.dutos?.tipos?.length || 0,
        opcionais: systemData.dutos?.opcionais?.length || 0,
      },
      tubos: systemData.tubos?.length || 0,
      ADM: systemData.ADM?.length || 0,
    });

    editor.readOnly = true;
    editor.value = JSON.stringify(systemData, null, 2);
  },

  copyJSONToClipboard: async function (button) {
    const editor = document.getElementById("jsonEditor");
    if (!editor || !editor.value) {
      console.warn(" Nenhum JSON disponível para copiar");
      return;
    }

    const originalLabel = button?.textContent?.trim() || "Copiar JSON";

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(editor.value);
      } else {
        editor.focus();
        editor.select();
        document.execCommand("copy");
        editor.setSelectionRange(0, 0);
        editor.blur();
      }

      if (button) {
        button.textContent = "Copiado";
        setTimeout(() => {
          button.textContent = originalLabel;
        }, 1500);
      }
    } catch (error) {
      console.error(" Erro ao copiar JSON:", error);

      if (button) {
        button.textContent = "Erro ao copiar";
        setTimeout(() => {
          button.textContent = originalLabel;
        }, 1500);
      }
    }
  },
};

// Atribuir função global do visualizador JSON
window.loadJSONEditor = jsonViewerModule.loadJSONEditor.bind(jsonViewerModule);
window.copyJSONToClipboard =
  jsonViewerModule.copyJSONToClipboard.bind(jsonViewerModule);

// ==================== EVENT LISTENERS ====================

// Disparar evento quando os dados são carregados
window.addEventListener("dataLoaded", function (event) {
  const data = event.detail;

  console.log(" EVENTO dataLoaded recebido na main.js");
  console.log(" Dados recebidos:", {
    constants: Object.keys(data.constants || {}).length,
    machines: data.machines?.length || 0,
    materials: Object.keys(data.materials || {}).length,
    empresas: data.empresas?.length || 0,
    banco_acessorios: Object.keys(data.banco_acessorios || {}).length,
    dutos: {
      tipos: data.dutos?.tipos?.length || 0,
      opcionais: data.dutos?.opcionais?.length || 0,
    },
    tubos: data.tubos?.length || 0,
    ADM: data.ADM?.length || 0,
  });

  // Atualiza window.systemData com os dados recebidos
  window.systemData = data;

  // Carrega todos os componentes
  setTimeout(() => {
    refreshAllAdminViews();

    // Atualiza as novas abas
    safeInvokeLoader("admin-area", refreshAdminArea);

    // Limpar staging
    window.stagingData = null;
    window.hasPendingChanges = false;

    console.log(" Todos os componentes carregados após dataLoaded");
  }, 100);
});

// Disparar evento quando os dados são importados (via staging)
window.addEventListener("dataImported", function (event) {
  const data = event.detail;

  console.log(" EVENTO dataImported recebido");
  window.systemData = data;

  if (window.loadConstants) window.loadConstants();
  if (window.loadMachines) window.loadMachines();
  if (window.loadMaterials) window.loadMaterials();
  if (window.loadEmpresas) window.loadEmpresas();
  if (window.loadAcessorios) window.loadAcessorios();
  if (window.loadDutos) window.loadDutos();
  if (window.loadTubos) window.loadTubos();
  if (window.filterMachines) window.filterMachines();
  if (window.loadJSONEditor) window.loadJSONEditor();

  // Atualiza as novas abas
  refreshAdminArea();

  // Limpar staging
  window.stagingData = null;
  window.hasPendingChanges = false;
});

// Evento: Dados aplicados via botão "Aplicar JSON"
window.addEventListener("dataApplied", function (event) {
  const data = event.detail.data;
  const changes = Array.isArray(event.detail.changes) ? event.detail.changes : [];
  changes.summary = { total_changes: changes.length };

  console.log(" EVENTO dataApplied recebido:", changes);

  // Atualizar window.systemData
  window.systemData = data;

  refreshChangedSections(changes);

  // Registrar no logger se disponível
  if (window.logger && window.logger.log) {
    window.logger.log(
      "Sistema",
      `JSON aplicado: ${changes.summary.total_changes} alterações`,
    );
  }
});

// ==================== FUNÇÕES DE DEBUG ====================

// Função de debug para verificar dados
window.debugSystemData = function () {
  console.log("=== DEBUG SYSTEMDATA ===");
  console.log("systemData:", window.systemData);
  console.log("Tem banco_acessorios?", "banco_acessorios" in window.systemData);
  console.log("Tem dutos?", "dutos" in window.systemData);
  console.log("Tem tubos?", "tubos" in window.systemData);
  console.log("Tem ADM?", "ADM" in window.systemData);
  console.log("banco_acessorios:", window.systemData?.banco_acessorios);
  console.log("dutos:", window.systemData?.dutos);
  console.log("tubos:", window.systemData?.tubos);
  console.log("ADM:", window.systemData?.ADM);
  console.log(
    "Número de acessórios:",
    Object.keys(window.systemData?.banco_acessorios || {}).length,
  );
  console.log(
    "Número de tipos de dutos:",
    window.systemData?.dutos?.tipos?.length || 0,
  );
  console.log(
    "Número de opcionais:",
    window.systemData?.dutos?.opcionais?.length || 0,
  );
  console.log("Número de tubos:", window.systemData?.tubos?.length || 0);
  console.log("Número de ADM:", window.systemData?.ADM?.length || 0);
  console.log(
    "Keys de banco_acessorios:",
    Object.keys(window.systemData?.banco_acessorios || {}),
  );

  // Verifica o editor
  const editor = document.getElementById("jsonEditor");
  if (editor && editor.value) {
    try {
      const parsed = JSON.parse(editor.value);
      console.log("Editor tem banco_acessorios?", "banco_acessorios" in parsed);
      console.log("Editor tem dutos?", "dutos" in parsed);
      console.log("Editor tem tubos?", "tubos" in parsed);
      console.log("Editor tem ADM?", "ADM" in parsed);
      console.log(
        "Acessórios no editor:",
        Object.keys(parsed?.banco_acessorios || {}).length,
      );
      console.log(
        "Tipos de dutos no editor:",
        parsed?.dutos?.tipos?.length || 0,
      );
      console.log("Tubos no editor:", parsed?.tubos?.length || 0);
    } catch (e) {
      console.error("Erro ao parsear editor:", e);
    }
  }
};

// Função para forçar recarregamento completo
window.reloadCompleteData = async function () {
  console.log(" Forçando recarregamento completo...");

  try {
    // Busca dados diretamente da API
    const response = await fetch(`/api/system-data?t=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
    });
    if (response.ok) {
      const data = await response.json();
      console.log(" Dados da API:", {
        banco_acessorios: Object.keys(data.banco_acessorios || {}).length,
        dutos: {
          tipos: data.dutos?.tipos?.length || 0,
          opcionais: data.dutos?.opcionais?.length || 0,
        },
        tubos: data.tubos?.length || 0,
        ADM: data.ADM?.length || 0,
      });

      // Atualiza window.systemData
      window.systemData = data;

      // Dispara evento
      window.dispatchEvent(
        new CustomEvent("dataLoaded", {
          detail: data,
        }),
      );

      console.log(" Dados recarregados com sucesso!");
      return data;
    } else {
      throw new Error(`Erro ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error(" Erro ao recarregar dados:", error);
    throw error;
  }
};

// ==================== INICIALIZAÇÃO EXTRA ====================

// Adiciona listener para debug quando o sistema está pronto
setTimeout(() => {
  console.log(" Sistema completamente inicializado");
  console.log(" Estado final do systemData:", {
    constants: Object.keys(window.systemData?.constants || {}).length,
    machines: window.systemData?.machines?.length || 0,
    materials: Object.keys(window.systemData?.materials || {}).length,
    empresas: window.systemData?.empresas?.length || 0,
    banco_acessorios: Object.keys(window.systemData?.banco_acessorios || {})
      .length,
    dutos: {
      tipos: window.systemData?.dutos?.tipos?.length || 0,
      opcionais: window.systemData?.dutos?.opcionais?.length || 0,
    },
    tubos: window.systemData?.tubos?.length || 0,
    ADM: window.systemData?.ADM?.length || 0,
  });

  // Inicializa as abas se estiverem ativas
  const activeTab = document.querySelector(".tab-pane.active");
  if (activeTab) {
    if (activeTab.id === "dashboardTab") {
      initializeDashboard();
    } else if (activeTab.id === "adminCredentialsTab") {
      initializeAdminCredentials();
    }
  }
}, 2000);
