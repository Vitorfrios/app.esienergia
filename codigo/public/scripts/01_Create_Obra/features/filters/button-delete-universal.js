/* ==== INÍCIO: button-delete-universal.js ==== */

import {
  getObraCatalogRuntimeData,
  removeObraFromRuntimeBootstrap,
} from "../../core/runtime-data.js";

class ButtonDeleteUniversal {
  constructor() {
    // APENAS configuração para obras
    this.BUTTON_CONFIGS = {
      deleteObra: {
        type: "obra",
        extractIds: (onclick) => {
          const match = onclick.match(/deleteObra\('([^']+)',\s*'([^']+)'\)/);
          return match ? { obraName: match[1], obraId: match[2] } : null;
        },
        buildPath: (ids) => (ids ? ["obras", ids.obraId] : null),
        confirmMessage:
          "Tem certeza que deseja DELETAR esta OBRA? Todos os projetos, salas e máquinas serão perdidos. Esta ação é permanente!",
        successMessage: "Obra deletada com sucesso",
        itemType: "obra",
      },
    };

    this.pendingDeletion = null;
    this.undoTimeout = null;
    this.toastContainer = null;
    this.inFlightDeletions = new Set();

    console.log(" ButtonDeleteUniversal configurado (APENAS OBRAS)");
  }

  /**
   * Verifica se deve configurar botão (apenas com filtro ativo)
   */
  shouldSetupButton() {
    if (window.FilterSystem && window.FilterSystem.isFilterActive) {
      return window.FilterSystem.isFilterActive();
    }

    const filterToggle = document.getElementById("filter-toggle");
    if (filterToggle) {
      return filterToggle.checked;
    }

    return false;
  }

  /**
   * Busca o nome da obra no DOM
   */
  getItemNameFromDOM(button, itemType, ids) {
    console.log(` Buscando nome para obra...`, ids);

    let titleElement = null;

    // Procurar especificamente por elementos de obra
    const obraElement =
      document.getElementById(ids.obraId) ||
      document.querySelector(`[data-obra-id="${ids.obraId}"]`) ||
      button.closest('.obra-container, .obra-item, [class*="obra"]');

    if (obraElement) {
      console.log(" Elemento obra encontrado:", obraElement);

      // Buscar título da obra (prioridade para elementos editáveis)
      titleElement = obraElement.querySelector(
        '.obra-title, h2.obra-title, [data-editable="true"]',
      );

      if (!titleElement) {
        // Se não encontrar, procurar qualquer h2
        titleElement = obraElement.querySelector("h2");
      }

      if (titleElement) {
        let itemName = "";

        if (
          titleElement.tagName === "INPUT" ||
          titleElement.tagName === "TEXTAREA"
        ) {
          itemName = titleElement.value.trim();
        } else {
          itemName = titleElement.textContent.trim();
        }

        if (itemName && itemName.length > 0) {
          console.log(` Nome encontrado: "${itemName}"`);
          return itemName;
        }
      }
    }

    // Fallback para o nome da obra do onclick
    if (ids.obraName) {
      console.log(` Usando nome do onclick: "${ids.obraName}"`);
      return ids.obraName;
    }

    return "Obra sem nome";
  }

  /**
   * Analisa apenas botões de obra
   */
  analyzeButton(button) {
    if (!button || !button.getAttribute) return null;

    const onclick = button.getAttribute("onclick") || "";
    const text = button.textContent?.trim() || "";

    // APENAS verificar deleteObra
    if (onclick.includes("deleteObra")) {
      const config = this.BUTTON_CONFIGS["deleteObra"];
      const ids = config.extractIds(onclick);

      if (ids) {
        const path = config.buildPath(ids);
        const itemName = this.getItemNameFromDOM(button, config.type, ids);

        return {
          button,
          funcName: "deleteObra",
          config,
          ids,
          path,
          itemName,
          originalText: text,
          originalOnclick: onclick,
        };
      }
    }

    return null;
  }

  /**
   * Configura apenas botões de obra
   */
  setupButton(button) {
    // Verificar se filtro está ativo
    if (!this.shouldSetupButton()) {
      console.log(" Botão não configurado - filtro desativado");
      return;
    }

    const buttonInfo = this.analyzeButton(button);
    if (!buttonInfo) {
      // Não é botão de obra - ignorar silenciosamente
      return;
    }

    console.log(` Configurando botão de obra:`, buttonInfo.itemName);

    // Clonar botão para remover event listeners antigos
    const newButton = button.cloneNode(true);

    // Remover onclick original
    newButton.removeAttribute("onclick");

    // Guardar dados originais + nome
    newButton.setAttribute("data-original-onclick", buttonInfo.originalOnclick);
    newButton.setAttribute("data-original-text", buttonInfo.originalText);
    newButton.setAttribute("data-button-type", buttonInfo.config.type);
    newButton.setAttribute("data-item-id", JSON.stringify(buttonInfo.ids));
    newButton.setAttribute("data-item-name", buttonInfo.itemName);

    // Adicionar classe
    newButton.classList.add("delete-real");

    // Adicionar novo evento
    const runtimeButtonInfo = {
      ...buttonInfo,
      button: newButton,
    };

    newButton.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      await this.showAdvancedConfirmation(runtimeButtonInfo);
    });

    // Substituir o botão antigo
    button.parentNode.replaceChild(newButton, button);

    console.log(` Botão de obra configurado para "${buttonInfo.itemName}"`);
    return newButton;
  }

  /**
   * Mostra confirmação APENAS para obras
   */
  async showAdvancedConfirmation(buttonInfo) {
    const { config, ids, itemName } = buttonInfo;

    console.log(` Mostrando confirmação para deletar obra: "${itemName}"`);

    if (window.UniversalDeleteModal) {
      const confirmed = await UniversalDeleteModal.confirmDelete(
        "obra",
        itemName,
        `ID: ${ids.obraId}`,
      );

      if (confirmed) {
        await this.executeRealDeletion(buttonInfo);
      }
    } else {
      // Fallback para confirm nativo
      if (confirm(`Deseja DELETAR PERMANENTEMENTE a obra "${itemName}"?`)) {
        await this.executeRealDeletion(buttonInfo);
      }
    }
  }

  async obraExisteNoSistema(obraId) {
    const tentativas = [{}, { forceReload: true }];

    for (const options of tentativas) {
      try {
        const catalogo = await getObraCatalogRuntimeData(options);
        const existe = Array.isArray(catalogo)
          && catalogo.some((obra) => String(obra?.id || "").trim() === String(obraId).trim());

        if (existe) {
          return true;
        }
      } catch (error) {
        console.warn(" [DELETE-REAL] Falha ao verificar existencia da obra:", error);
      }
    }

    return false;
  }

  /**
   * Executa deleção da obra
   */
  async executeRealDeletion(buttonInfo) {
    const { config, ids, path, itemName } = buttonInfo;
    const obraId = String(ids?.obraId || "").trim();

    console.log(` Executando deleção REAL da obra: "${itemName}"`, path);

    if (!obraId) {
      this.showToast("ID da obra inválido para exclusão", "error");
      return false;
    }

    const obraExisteNoSistema = await this.obraExisteNoSistema(obraId);
    if (!obraExisteNoSistema) {
      removeObraFromRuntimeBootstrap(obraId);
      if (window.FilterSystem?.notifyObraDeleted) {
        window.FilterSystem.notifyObraDeleted(obraId);
      }
      this.removeElementFromDOM(buttonInfo);
      return true;
    }

    if (this.inFlightDeletions.has(obraId)) {
      console.warn(` [DELETE-REAL] Exclusão já em andamento para ${obraId}`);
      return false;
    }

    try {
      this.inFlightDeletions.add(obraId);
      if (buttonInfo.button) {
        buttonInfo.button.disabled = true;
        buttonInfo.button.dataset.deleting = "true";
        buttonInfo.button.textContent = "Removendo...";
      }

      this.showToast(`Obra "${itemName}" sendo deletada...`, "processing");

      const response = await fetch("/api/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: path,
          itemType: config.type,
          itemId: JSON.stringify(ids),
          itemName: itemName,
        }),
      });

      const result = await response.json().catch(() => ({
        success: false,
        error: `Resposta inválida do servidor (${response.status})`,
      }));

      if (result.success) {
        console.log(` [DELETE-REAL] Sucesso: ${result.message}`);

        removeObraFromRuntimeBootstrap(obraId);
        if (window.FilterSystem?.notifyObraDeleted) {
          window.FilterSystem.notifyObraDeleted(obraId);
        }

        this.removeElementFromDOM(buttonInfo);
        if (!result.already_deleted) {
          this.showToast(
            `Obra "${itemName}" deletada permanentemente`,
            "success",
          );
        }

        if (typeof window.invalidateRuntimeBootstrap === "function") {
          window.invalidateRuntimeBootstrap();
        }
        if (typeof window.loadRuntimeBootstrap === "function") {
          window
            .loadRuntimeBootstrap({ forceReload: true })
            .catch((error) =>
              console.warn(" [DELETE-REAL] Falha ao sincronizar cache:", error),
            );
        }

        return true;
      } else {
        console.error(" [DELETE-REAL] Erro:", result.error);
        this.showToast(`Erro ao deletar obra: ${result.error}`, "error");
        return false;
      }
    } catch (error) {
      console.error(" [DELETE-REAL] Exceção:", error);
      this.showToast("Erro ao conectar com o servidor", "error");
      return false;
    } finally {
      this.inFlightDeletions.delete(obraId);

      if (buttonInfo.button?.isConnected) {
        buttonInfo.button.disabled = false;
        buttonInfo.button.removeAttribute("data-deleting");
        const originalText =
          buttonInfo.button.getAttribute("data-original-text") ||
          buttonInfo.originalText ||
          "Remover Obra";
        buttonInfo.button.textContent = originalText;
      }
    }
  }

  /**
   * Remove elemento da obra do DOM
   */
  removeElementFromDOM(buttonInfo) {
    const { ids, itemName } = buttonInfo;

    let elementToRemove =
      document.getElementById(ids.obraId) ||
      document.querySelector(`[data-obra-id="${ids.obraId}"]`) ||
      buttonInfo.button.closest('.obra-container, .obra-item, [class*="obra"]');

    if (elementToRemove) {
      elementToRemove.style.transition = "all 0.5s ease";
      elementToRemove.style.opacity = "0";
      elementToRemove.style.transform = "translateX(-100%)";
      elementToRemove.style.maxHeight = "0";
      elementToRemove.style.overflow = "hidden";

      setTimeout(() => {
        if (elementToRemove.parentNode) {
          elementToRemove.remove();
          console.log(` Obra "${itemName}" removida do DOM`);
        }
      }, 62);
    } else {
      console.warn(` Não encontrou elemento para remover: obra`, ids);
      setTimeout(() => window.location.reload(), 125);
    }
  }

  showToast(message, type = "info") {
    if (!this.toastContainer) {
      this.toastContainer = document.createElement("div");
      this.toastContainer.id = "universal-toast-container";
      this.toastContainer.style.cssText = `
 position: fixed;
 top: 20px;
 right: 20px;
 z-index: 10000;
 display: flex;
 flex-direction: column;
 gap: 10px;
 `;
      document.body.appendChild(this.toastContainer);
    }

    const colors = {
      success: "#4CAF50",
      error: "#f44336",
      warning: "#ff9800",
      info: "#2196F3",
      processing: "#9C27B0",
    };

    const icons = {
      success: "",
      error: "",
      warning: "",
      info: "",
      processing: "",
    };

    const toast = document.createElement("div");
    toast.style.cssText = `
 background: ${colors[type] || colors.info};
 color: white;
 padding: 15px 20px;
 border-radius: 8px;
 box-shadow: 0 4px 12px rgba(0,0,0,0.15);
 display: flex;
 align-items: center;
 gap: 12px;
 min-width: 300px;
 max-width: 400px;
 transform: translateX(100%);
 opacity: 0;
 animation: slideIn 0.3s forwards;
 `;

    toast.innerHTML = `
 <span style="font-size: 20px;">${icons[type] || ""}</span>
 <span>${message}</span>
 `;

    if (!document.querySelector("#toast-animation")) {
      const style = document.createElement("style");
      style.id = "toast-animation";
      style.textContent = `
 @keyframes slideIn {
 to { transform: translateX(0); opacity: 1; }
 }
 @keyframes slideOut {
 from { transform: translateX(0); opacity: 1; }
 to { transform: translateX(100%); opacity: 0; }
 }
 `;
      document.head.appendChild(style);
    }

    this.toastContainer.appendChild(toast);

    setTimeout(
      () => {
        toast.style.animation = "slideOut 0.3s forwards";
        setTimeout(() => {
          if (toast.parentNode) {
            toast.remove();
          }
        }, 37);
      },
      type === "processing" ? 3000 : 5000,
    );
  }

  /**
   * Configura APENAS botões de obra
   */
  setupAllDeleteButtons() {
    if (!this.shouldSetupButton()) {
      console.log(
        " [DELETE-REAL] Filtro não está ativo - ignorando configuração de botões",
      );
      return 0;
    }

    console.log(" [DELETE-REAL] Buscando botões de OBRA (filtro ATIVO)...");

    // Buscar especificamente botões que parecem ser de obra
    const obraButtons = document.querySelectorAll(
      '[onclick*="deleteObra"], .btn-delete-obra, .delete-obra-btn',
    );
    let configuredButtons = 0;

    obraButtons.forEach((button) => {
      const setup = this.setupButton(button);
      if (setup) configuredButtons++;
    });

    console.log(
      ` [DELETE-REAL] ${configuredButtons} botões de obra configurados`,
    );
    return configuredButtons;
  }

  /**
   * Restaura apenas botões de obra
   */
  restoreOriginalButtons() {
    console.log(" [DELETE-REAL] Restaurando botões de obra originais...");

    const universalButtons = document.querySelectorAll(".delete-real");
    let restoredCount = 0;

    universalButtons.forEach((button) => {
      const originalOnclick = button.getAttribute("data-original-onclick");
      const originalText = button.getAttribute("data-original-text");

      if (originalOnclick) {
        button.setAttribute("onclick", originalOnclick);
      }

      if (originalText) {
        button.textContent = originalText;
      }

      // Remover atributos e classes
      button.classList.remove("delete-real");
      button.classList.remove("filter-mode-active");
      button.style.fontWeight = "";
      button.removeAttribute("data-original-onclick");
      button.removeAttribute("data-original-text");
      button.removeAttribute("data-button-type");
      button.removeAttribute("data-item-id");
      button.removeAttribute("data-item-name");

      // Remover event listeners
      const newButton = button.cloneNode(true);
      button.parentNode.replaceChild(newButton, button);

      restoredCount++;
    });

    console.log(` [DELETE-REAL] ${restoredCount} botões de obra restaurados`);
    return restoredCount;
  }
}

export { ButtonDeleteUniversal };

if (typeof window !== "undefined") {
  window.ButtonDeleteUniversal = ButtonDeleteUniversal;
}
/* ==== FIM: button-delete-universal.js ==== */
