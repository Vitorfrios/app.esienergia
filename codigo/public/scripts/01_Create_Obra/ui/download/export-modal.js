import { showSystemStatus } from "../components/status.js";
import { downloadGeneratedFiles, waitForBackgroundJob } from "./word-modal.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function isValidEmail(value) {
  return EMAIL_REGEX.test(String(value || "").trim());
}

function getActionLabel(type) {
  if (type === "download") return "Baixar";
  if (type === "email") return "Enviar";
  return "Exportar";
}

function getSuccessMessage(type) {
  if (type === "download") return "Download iniciado com sucesso";
  if (type === "email") return "Envio de email iniciado com sucesso";
  return "Exportação concluída com sucesso";
}

function inferCompanyEmail(obraBlock) {
  if (!obraBlock) return "";

  return (
    obraBlock.dataset.empresaEmail ||
    obraBlock.dataset.emailEmpresa ||
    obraBlock.dataset.email ||
    ""
  ).trim();
}

function getObraMetadata(obraBlock, obraName, obraId) {
  const totalElement = document.getElementById(`total-obra-valor-${obraId}`);
  const valorTotal =
    (obraBlock?.dataset?.valorTotalObra || "").trim() ||
    (totalElement?.textContent || "").trim() ||
    "R$ 0,00";

  return {
    nome: obraName,
    empresaNome: (obraBlock?.dataset?.empresaNome || "").trim(),
    empresaSigla: (obraBlock?.dataset?.empresaSigla || "").trim(),
    clienteFinal: (obraBlock?.dataset?.clienteFinal || "").trim(),
    codigoCliente: (obraBlock?.dataset?.codigoCliente || "").trim(),
    numeroClienteFinal: (obraBlock?.dataset?.numeroClienteFinal || "").trim(),
    dataCadastro: (obraBlock?.dataset?.dataCadastro || "").trim(),
    orcamentistaResponsavel: (obraBlock?.dataset?.orcamentistaResponsavel || "").trim(),
    valorTotalObra: valorTotal,
  };
}

function buildCompanyMessage(metadata) {
  return [
    "Prezados,",
    "",
    `Segue em anexo a exportação da obra ${metadata.nome}.`,
    "",
    "Os arquivos foram organizados para análise e consulta.",
    "",
    "Fico à disposição para qualquer ajuste ou esclarecimento.",
  ].join("\n");
}

function buildSelfMessage(metadata) {
  const empresaLinha = metadata.empresaSigla
    ? `${metadata.empresaNome} (${metadata.empresaSigla})`
    : metadata.empresaNome;

  return [
    `Segue arquivos da obra ${metadata.nome}`,
    `Nome: ${metadata.nome}`,
    `Empresa: ${empresaLinha}`,
    `Cliente Final: ${metadata.clienteFinal}`,
    `Código Cliente: ${metadata.codigoCliente}`,
    `Número Cliente: ${metadata.numeroClienteFinal}`,
    `Data: ${metadata.dataCadastro}`,
    `Responsável: ${metadata.orcamentistaResponsavel}`,
    `Valor: ${metadata.valorTotalObra}`,
  ].join("\n");
}

function buildDefaultMessage(recipientMode, metadata) {
  return recipientMode === "self"
    ? buildSelfMessage(metadata)
    : buildCompanyMessage(metadata);
}

async function fetchEmailConfig() {
  const response = await fetch("/api/admin/email-config");
  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.success) {
    throw new Error(result.error || "Não foi possível carregar a configuração de email.");
  }

  return result;
}

function createState(obraId, obraName, companyEmail, obraMetadata) {
  const defaultRecipientMode = companyEmail ? "company" : "self";
  return {
    obraId,
    obraName,
    companyEmail,
    obraMetadata,
    selectedType: "download",
    selectedFormat: "ambos",
    recipientMode: defaultRecipientMode,
    recipientValue: companyEmail || "",
    message: buildDefaultMessage(defaultRecipientMode, obraMetadata),
    emailConfig: null,
    emailConfigError: "",
    currentStep: "decision",
    loadingTimers: [],
  };
}

function createModalShell(obraName) {
  const overlay = document.createElement("div");
  overlay.className = "word-modal-overlay export-modal-overlay";

  const modal = document.createElement("div");
  modal.className = "word-modal export-modal";
  modal.innerHTML = `
    <div class="word-modal-header export-modal-header">
      <div>
        <span class="export-modal-kicker">Exportação</span>
        <h2 class="word-modal-title">Exportar Obra</h2>
      </div>
      <button class="word-modal-close" type="button" aria-label="Fechar">&times;</button>
    </div>
    <div class="word-modal-content export-modal-content"></div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  return { overlay, modal, content: modal.querySelector(".export-modal-content") };
}

function closeModal(state, overlay) {
  state.loadingTimers.forEach((timerId) => clearTimeout(timerId));
  state.loadingTimers = [];
  overlay.style.opacity = "0";

  setTimeout(() => {
    overlay.remove();
    document.body.style.overflow = "";
  }, 180);
}

function renderDecisionStep(state, shell) {
  state.currentStep = "decision";
  shell.content.innerHTML = `
    <div class="export-modal-step-copy">
      <p class="word-modal-subtitle">Escolha como deseja exportar a obra <strong>${escapeHtml(state.obraName)}</strong>.</p>
    </div>

    <div class="export-choice-grid">
      ${renderTypeCard("download", "Download", "Gera os arquivos e inicia o download imediato.", state.selectedType)}
      ${renderTypeCard("email", "Enviar por email", "Anexa os arquivos gerados diretamente no email.", state.selectedType)}
      ${renderTypeCard("completo", "Exportação completa", "Executa download e envio de email no mesmo fluxo.", state.selectedType)}
    </div>

    <div class="word-modal-footer export-modal-footer">
      <button class="word-modal-btn word-modal-btn-cancel" type="button" data-action="cancel">Cancelar</button>
      <button class="word-modal-btn word-modal-btn-download" type="button" data-action="continue">Continuar</button>
    </div>
  `;

  bindDecisionEvents(state, shell);
}

function renderTypeCard(id, title, description, selectedType) {
  if (id === "completo") {
    return "";
  }

  const checked = id === selectedType;
  return `
    <label class="model-option export-choice-card ${checked ? "selected" : ""}" data-type="${id}">
      <input class="model-option-checkbox" type="radio" name="exportType" value="${id}" ${checked ? "checked" : ""}>
      <div class="model-option-details">
        <div class="model-option-title">${title}</div>
        <div class="model-option-description">${description}</div>
      </div>
    </label>
  `;
}

function renderDetailStep(state, shell) {
  state.currentStep = "details";
  const needsFormat = ["download", "email", "completo"].includes(state.selectedType);
  const needsEmail = state.selectedType === "email" || state.selectedType === "completo";
  const emailConfig = state.emailConfig?.config || {};
  const emailConfigLoaded = state.emailConfig !== null;
  const emailConfigured = Boolean(state.emailConfig?.configured);
  const selfEmail = (emailConfig.email || "").trim();
  const recipientValue = resolveVisibleRecipientValue(state, selfEmail);

  shell.content.innerHTML = `
    <div class="export-modal-stage-row">
      <span class="export-stage-pill">${labelForType(state.selectedType)}</span>
      <span class="export-stage-description">${escapeHtml(state.obraName)}</span>
    </div>

    ${needsFormat ? `
      <section class="export-panel">
        <div class="export-panel-header">
          <h3>Formato dos arquivos</h3>
          <p>Escolha quais documentos devem entrar na exportação.</p>
        </div>
        <div class="export-format-grid">
          ${renderFormatCard("pt", "PT", "Proposta Técnica", state.selectedFormat)}
          ${renderFormatCard("pc", "PC", "Proposta Comercial", state.selectedFormat)}
          ${renderFormatCard("ambos", "Ambos", "PT + PC", state.selectedFormat)}
        </div>
      </section>
    ` : ""}

    ${needsEmail ? `
      <section class="export-panel">
        <div class="export-panel-header">
          <h3>Envio por email</h3>
          <p>Os arquivos serão enviados como anexos usando o email administrativo configurado.</p>
        </div>
        ${!emailConfigLoaded ? `
          <div class="export-inline-alert export-inline-alert-info">
            Carregando a configuração de email do ADM...
          </div>
        ` : emailConfigured ? `
          <div class="export-sender-chip">Remetente: <strong>${escapeHtml(emailConfig.nome || "Administrador")}</strong> · ${escapeHtml(selfEmail)}</div>
        ` : `
          <div class="export-inline-alert export-inline-alert-error">
            Configure o email do ADM na aba <strong>Credenciais ADM</strong> antes de enviar exportações.
          </div>
        `}
        ${state.emailConfigError ? `<div class="export-inline-alert export-inline-alert-error">${escapeHtml(state.emailConfigError)}</div>` : ""}
        <div class="export-recipient-options">
          ${renderRecipientOption("company", "Enviar para empresa", "Usa o email da empresa quando disponível.", state.recipientMode)}
          ${renderRecipientOption("self", "Enviar para mim (ADM)", "Usa o email administrativo configurado.", state.recipientMode)}
          ${renderRecipientOption("other", "Outro", "Permite informar um destinatário manualmente.", state.recipientMode)}
        </div>
        <label class="export-field">
          <span>Destinatário</span>
          <input id="exportRecipientInput" type="email" value="${escapeHtml(recipientValue)}" placeholder="nome@empresa.com" ${state.recipientMode === "self" ? "readonly" : ""}>
        </label>
        <label class="export-field">
          <span>Mensagem</span>
          <textarea id="exportMessageInput" rows="4" placeholder="Digite a mensagem do email">${escapeHtml(state.message)}</textarea>
        </label>
      </section>
    ` : ""}

    <div class="word-modal-footer export-modal-footer">
      <button class="word-modal-btn word-modal-btn-cancel" type="button" data-action="back">Voltar</button>
      <button class="word-modal-btn word-modal-btn-download" type="button" data-action="submit">${getActionLabel(state.selectedType)}</button>
    </div>
  `;

  bindDetailEvents(state, shell);
}

function renderFormatCard(value, tag, description, selectedFormat) {
  const checked = value === selectedFormat;
  return `
    <label class="export-format-card ${checked ? "selected" : ""}" data-format="${value}">
      <input type="radio" name="exportFormat" value="${value}" ${checked ? "checked" : ""}>
      <span class="export-format-tag">${tag}</span>
      <strong>${description}</strong>
    </label>
  `;
}

function renderRecipientOption(value, label, description, selectedValue) {
  const checked = value === selectedValue;
  return `
    <label class="export-recipient-card ${checked ? "selected" : ""}" data-recipient-mode="${value}">
      <input type="radio" name="exportRecipientMode" value="${value}" ${checked ? "checked" : ""}>
      <div>
        <strong>${label}</strong>
        <span>${description}</span>
      </div>
    </label>
  `;
}

function renderLoadingStep(state, shell) {
  state.currentStep = "loading";
  shell.content.innerHTML = `
    <div class="word-modal-loading export-modal-loading">
      <div class="word-modal-loading-spinner"></div>
      <div class="word-modal-loading-text" id="exportLoadingText">Gerando arquivos...</div>
      <div class="word-modal-loading-hint" id="exportLoadingHint">Preparando a exportação da obra ${escapeHtml(state.obraName)}.</div>
    </div>
  `;

  const loadingText = shell.content.querySelector("#exportLoadingText");
  const loadingHint = shell.content.querySelector("#exportLoadingHint");
  const steps = state.selectedType === "download"
    ? [
        ["Gerando arquivos...", "Organizando os documentos para download."],
        ["Preparando download...", "Quase pronto para iniciar o download."],
      ]
    : [
        ["Gerando arquivos...", "Preparando os documentos da obra."],
        ["Enviando email...", "Anexando os documentos e preparando o envio ao destinatario."],
      ];

  steps.slice(1).forEach(([title, hint], index) => {
    const timerId = window.setTimeout(() => {
      if (loadingText) loadingText.textContent = title;
      if (loadingHint) loadingHint.textContent = hint;
    }, 900 * (index + 1));
    state.loadingTimers.push(timerId);
  });
}

function updateExportLoadingState(shell, job) {
  const loadingText = shell.content.querySelector("#exportLoadingText");
  const loadingHint = shell.content.querySelector("#exportLoadingHint");
  if (!loadingText || !loadingHint || !job) {
    return;
  }

  if (job.stage === "preparing_download") {
    loadingText.textContent = "Preparando download...";
    loadingHint.textContent = "Os arquivos ja foram gerados e o download sera iniciado em instantes.";
    return;
  }

  if (job.stage === "queueing_email") {
    loadingText.textContent = "Enfileirando email...";
    loadingHint.textContent = "O envio sera processado em segundo plano assim que os arquivos estiverem prontos.";
    return;
  }

  loadingText.textContent = "Gerando arquivos...";
  loadingHint.textContent = `Preparando a exportacao da obra ${stateSafeObraName(job, shell)}.`;
}

function stateSafeObraName(job, shell) {
  return (
    job?.obra_nome ||
    shell?.content?.querySelector(".export-stage-description")?.textContent ||
    "selecionada"
  );
}

function renderSuccessStep(state, shell, message) {
  state.currentStep = "success";
  shell.content.innerHTML = `
    <div class="word-modal-success export-modal-success">
      <div class="word-modal-success-icon">✓</div>
      <div class="word-modal-success-text">${escapeHtml(message)}</div>
    </div>
  `;
}

function bindDecisionEvents(state, shell) {
  shell.content.querySelectorAll("[data-type]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedType = card.dataset.type;
      renderDecisionStep(state, shell);
    });
  });

  shell.content.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
    closeModal(state, shell.overlay);
  });

  shell.content.querySelector('[data-action="continue"]')?.addEventListener("click", () => {
    renderDetailStep(state, shell);
  });
}

function bindDetailEvents(state, shell) {
  shell.content.querySelectorAll("[data-format]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedFormat = card.dataset.format;
      renderDetailStep(state, shell);
    });
  });

  shell.content.querySelectorAll("[data-recipient-mode]").forEach((card) => {
    card.addEventListener("click", () => {
      state.recipientMode = card.dataset.recipientMode;
      if (state.recipientMode === "company") {
        state.recipientValue = state.companyEmail || "";
      }
      if (state.recipientMode === "self") {
        state.recipientValue = state.emailConfig?.config?.email || "";
      }
      state.message = buildDefaultMessage(state.recipientMode, state.obraMetadata);
      renderDetailStep(state, shell);
    });
  });

  shell.content.querySelector('[data-action="back"]')?.addEventListener("click", () => {
    renderDecisionStep(state, shell);
  });

  shell.content.querySelector("#exportRecipientInput")?.addEventListener("input", (event) => {
    state.recipientValue = event.target.value;
  });

  shell.content.querySelector("#exportMessageInput")?.addEventListener("input", (event) => {
    state.message = event.target.value;
  });

  shell.content.querySelector('[data-action="submit"]')?.addEventListener("click", async () => {
    const validationError = validateExportState(state, shell);
    if (validationError) {
      showSystemStatus(validationError, "error");
      return;
    }

    await submitExport(state, shell);
  });
}

function labelForType(type) {
  if (type === "download") return "Download";
  if (type === "email") return "Email";
  return "Completo";
}

function resolveVisibleRecipientValue(state, selfEmail) {
  if (state.recipientMode === "self") {
    return selfEmail;
  }

  if (state.recipientMode === "company" && !state.recipientValue) {
    return state.companyEmail || "";
  }

  return state.recipientValue || "";
}

function resolveDestination(state) {
  if (state.recipientMode === "self") {
    return (state.emailConfig?.config?.email || "").trim();
  }

  return (state.recipientValue || "").trim();
}

function validateExportState(state, shell) {
  const needsEmail = state.selectedType === "email" || state.selectedType === "completo";

  if (["download", "email", "completo"].includes(state.selectedType) && !state.selectedFormat) {
    return "Selecione o formato da exportação.";
  }

  if (!needsEmail) {
    return "";
  }

  if (state.emailConfig === null) {
    return "Aguarde o carregamento da configuração de email.";
  }

  if (!state.emailConfig?.configured) {
    return "Configure o email do ADM antes de enviar arquivos.";
  }

  const recipientInput = shell.content.querySelector("#exportRecipientInput");
  if (recipientInput) {
    state.recipientValue = recipientInput.value;
  }

  const messageInput = shell.content.querySelector("#exportMessageInput");
  if (messageInput) {
    state.message = messageInput.value;
  }

  const destination = resolveDestination(state);
  if (!destination || !isValidEmail(destination)) {
    return "Informe um email de destino válido.";
  }

  return "";
}

async function submitExport(state, shell) {
  renderLoadingStep(state, shell);

  try {
    const payload = {
      obraId: state.obraId,
      tipo: state.selectedType,
      formato: state.selectedFormat,
      mensagem: state.message,
      recipientMode: state.recipientMode,
    };

    if (state.selectedType === "email" || state.selectedType === "completo") {
      payload.destinatario = resolveDestination(state);
    }

    const response = await fetch("/api/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
      throw new Error(result.error || "Falha ao exportar a obra.");
    }

    const finalResult = result.job_id
      ? await waitForBackgroundJob(result.job_id, {
          onProgress: (job) => updateExportLoadingState(shell, job),
        })
      : result;

    const downloadIds = Array.isArray(finalResult.download_ids)
      ? finalResult.download_ids.filter(Boolean)
      : finalResult.download_id
        ? [finalResult.download_id]
        : [];

    if (downloadIds.length) {
      await downloadGeneratedFiles(downloadIds);
    }

    const successMessage = finalResult.email_error
      ? "Download iniciado, mas o envio do email não foi enfileirado."
      : getSuccessMessage(state.selectedType);
    renderSuccessStep(state, shell, successMessage);
    showSystemStatus(successMessage, finalResult.email_error ? "warning" : "success");

    const timerId = window.setTimeout(() => {
      closeModal(state, shell.overlay);
    }, 1400);
    state.loadingTimers.push(timerId);
  } catch (error) {
    state.loadingTimers.forEach((timerId) => clearTimeout(timerId));
    state.loadingTimers = [];
    renderDetailStep(state, shell);
    showSystemStatus(error.message || "Falha ao exportar a obra.", "error");
  }
}

export function abrirModalExportacao(obraId) {
  const obraBlock = document.querySelector(`[data-obra-id="${obraId}"]`);
  if (!obraBlock) {
    showSystemStatus("Obra não encontrada para exportação.", "error");
    return;
  }

  const obraName = obraBlock.dataset.obraName || obraId;
  const state = createState(
    obraId,
    obraName,
    inferCompanyEmail(obraBlock),
    getObraMetadata(obraBlock, obraName, obraId),
  );
  const shell = createModalShell(obraName);
  shell.overlay.addEventListener("click", (event) => {
    if (event.target === shell.overlay) {
      closeModal(state, shell.overlay);
    }
  });
  shell.modal.querySelector(".word-modal-close")?.addEventListener("click", () => {
    closeModal(state, shell.overlay);
  });

  renderDecisionStep(state, shell);

  fetchEmailConfig()
    .then((result) => {
      state.emailConfig = result;
      state.emailConfigError = "";
      if (state.recipientMode === "self") {
        state.recipientValue = result.config?.email || "";
      }
      if (state.currentStep === "details") {
        renderDetailStep(state, shell);
      }
    })
    .catch((error) => {
      state.emailConfig = { configured: false, config: {} };
      state.emailConfigError = error.message || "Falha ao carregar a configuração de email.";
      if (state.currentStep === "details") {
        renderDetailStep(state, shell);
      }
    });
}
