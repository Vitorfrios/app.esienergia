// empresa-form-manager.js
/**
 * EMPRESA-FORM-MANAGER.JS - Gerenciamento de Formulários de Empresa
 * Responsabilidade: Formulários inline, datepicker, validação, campos de data
 */

import { inicializarInputEmpresaHibrido } from "./empresa-autocomplete.js";
import { APP_CONFIG } from "../../core/config.js";
import { loadSystemBootstrap } from "../../core/system-bootstrap.js";
import {
  formatarDataEmTempoReal,
  validarDataInput,
  permitirApenasNumerosEControles,
} from "./empresa-ui-helpers.js";

let adminEmpresasCachePromise = null;
const EMPRESA_CREDENTIAL_DRAFT_PREFIX = "esi.empresaCredentialDraft.";
let empresaCredentialStorageListenerBound = false;

function isAdminCreateMode() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    APP_CONFIG.mode !== "client" &&
    window.location.pathname === "/admin/obras/create"
  );
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function formatEmpresaDate(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    return value;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  const day = String(parsedDate.getDate()).padStart(2, "0");
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const year = parsedDate.getFullYear();
  return `${day}/${month}/${year}`;
}

function generateEmpresaAccessToken(length = 32) {
  const bytesLength = Math.max(16, Math.ceil(length / 2));
  const bytes = new Uint8Array(bytesLength);
  const cryptoObject = globalThis.crypto || window.crypto;

  if (cryptoObject?.getRandomValues) {
    cryptoObject.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

function getEmpresaCredentialDraftKey(empresaSigla, empresaNome) {
  const baseKey = String(empresaSigla || empresaNome || "")
    .trim()
    .toUpperCase();

  if (!baseKey) {
    return "";
  }

  return `${EMPRESA_CREDENTIAL_DRAFT_PREFIX}${baseKey}`;
}

function getEmpresaCredentialCompanyKey(empresaSigla, empresaNome) {
  return String(empresaSigla || empresaNome || "")
    .trim()
    .toUpperCase();
}

function getSelectedEmpresaDataFromObraElement(obraElement) {
  const obraId = String(obraElement?.dataset?.obraId || "").trim();
  const empresaInput = obraId
    ? document.getElementById(`empresa-input-${obraId}`)
    : null;

  return {
    obraId,
    empresaSigla: String(
      empresaInput?.dataset?.siglaSelecionada ||
        obraElement?.dataset?.empresaSigla ||
        obraElement?.dataset?.empresaCodigo ||
        ""
    ).trim(),
    empresaNome: String(
      empresaInput?.dataset?.nomeSelecionado || obraElement?.dataset?.empresaNome || ""
    ).trim(),
  };
}

function calcularDataExpiracaoISO(tempoUso = 30, dataCriacao = "") {
  const baseDate = String(dataCriacao || "").trim();
  const currentDate = baseDate ? new Date(baseDate) : new Date();
  const resolvedDate = Number.isNaN(currentDate.getTime()) ? new Date() : currentDate;
  resolvedDate.setDate(resolvedDate.getDate() + Number(tempoUso || 30));
  return resolvedDate.toISOString();
}

function createEmpresaCredentialDraft({
  empresaSigla = "",
  empresaNome = "",
  email = "",
  credenciais = null,
} = {}) {
  const source = credenciais && typeof credenciais === "object" ? credenciais : {};
  const tempoUso = Number.parseInt(source.tempoUso, 10) || 30;
  const dataCriacao = String(source.data_criacao || source.createdAt || "").trim();
  const token = String(source.token || "").trim() || generateEmpresaAccessToken();
  const usuario = String(source.usuario || "").trim();

  return {
    usuario,
    token,
    email: String(source.email || source.recoveryEmail || email || "").trim(),
    tempoUso,
    data_criacao: dataCriacao || new Date().toISOString(),
    data_expiracao:
      String(source.data_expiracao || source.expiracao || "").trim() ||
      calcularDataExpiracaoISO(tempoUso, dataCriacao),
  };
}

function readEmpresaCredentialDraft(empresaSigla, empresaNome) {
  const draftKey = getEmpresaCredentialDraftKey(empresaSigla, empresaNome);
  if (!draftKey || typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(draftKey);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    return parsedValue && typeof parsedValue === "object" ? parsedValue : null;
  } catch (error) {
    console.warn(" [EMPRESA] Não foi possível ler rascunho de credenciais:", error);
    return null;
  }
}

function writeEmpresaCredentialDraft(empresaSigla, empresaNome, credenciais) {
  const draftKey = getEmpresaCredentialDraftKey(empresaSigla, empresaNome);
  if (
    !draftKey ||
    typeof window === "undefined" ||
    !window.localStorage ||
    !credenciais ||
    typeof credenciais !== "object"
  ) {
    return;
  }

  try {
    window.localStorage.setItem(draftKey, JSON.stringify(credenciais));
  } catch (error) {
    console.warn(" [EMPRESA] Não foi possível salvar rascunho de credenciais:", error);
  }
}

function clearEmpresaCredentialDraft(empresaSigla, empresaNome) {
  const draftKey = getEmpresaCredentialDraftKey(empresaSigla, empresaNome);
  if (!draftKey || typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.removeItem(draftKey);
  } catch (error) {
    console.warn(" [EMPRESA] Não foi possível limpar rascunho de credenciais:", error);
  }
}

function clearAdminCredentialDataset(obraElement) {
  if (!obraElement) return;

  [
    "empresaCredUsuario",
    "empresaCredToken",
    "empresaCredTempoUso",
    "empresaCredDataCriacao",
    "empresaCredDataExpiracao",
    "empresaCredHasAccess",
    "empresaCredCompanyKey",
  ].forEach((campo) => delete obraElement.dataset[campo]);
}

function getAdminCredentialDataset(obraElement) {
  if (!obraElement) {
    return null;
  }

  const usuario = String(obraElement.dataset.empresaCredUsuario || "").trim();
  const token = String(obraElement.dataset.empresaCredToken || "").trim();
  const tempoUso = String(obraElement.dataset.empresaCredTempoUso || "").trim();
  const dataCriacao = String(obraElement.dataset.empresaCredDataCriacao || "").trim();
  const dataExpiracao = String(
    obraElement.dataset.empresaCredDataExpiracao || ""
  ).trim();

  if (!usuario && !token && !tempoUso && !dataCriacao && !dataExpiracao) {
    return null;
  }

  return {
    usuario,
    token,
    tempoUso,
    data_criacao: dataCriacao,
    data_expiracao: dataExpiracao,
  };
}

function hasAdminCredentialValue(credenciais) {
  if (!credenciais || typeof credenciais !== "object") {
    return false;
  }

  return [
    "usuario",
    "token",
    "email",
    "recoveryEmail",
    "tempoUso",
    "data_criacao",
    "data_expiracao",
    "createdAt",
    "expiracao",
  ].some((campo) => String(credenciais[campo] || "").trim() !== "");
}

function normalizeAdminCredentialData(credenciais, fallbackEmail = "") {
  const source = credenciais && typeof credenciais === "object" ? credenciais : {};

  return {
    usuario: String(source.usuario || "").trim(),
    token: String(source.token || "").trim(),
    email: String(source.email || source.recoveryEmail || fallbackEmail || "").trim(),
    tempoUso: Number.parseInt(source.tempoUso, 10) || 30,
    data_criacao: String(source.data_criacao || source.createdAt || "").trim(),
    data_expiracao: String(source.data_expiracao || source.expiracao || "").trim(),
  };
}

async function loadAdminEmpresasCache() {
  if (!isAdminCreateMode()) {
    return [];
  }

  if (!adminEmpresasCachePromise) {
    adminEmpresasCachePromise = loadSystemBootstrap({ force: true })
      .then((payload) => (Array.isArray(payload?.empresas) ? payload.empresas : []))
      .catch((error) => {
        console.error(" [EMPRESA] Erro ao carregar empresas do bootstrap:", error);
        adminEmpresasCachePromise = null;
        return [];
      });
  }

  return adminEmpresasCachePromise;
}

function bindEmpresaCredentialStorageSync() {
  if (
    empresaCredentialStorageListenerBound ||
    typeof window === "undefined" ||
    !isAdminCreateMode()
  ) {
    return;
  }

  window.addEventListener("storage", (event) => {
    const storageKey = String(event?.key || "").trim();
    if (!storageKey.startsWith(EMPRESA_CREDENTIAL_DRAFT_PREFIX)) {
      return;
    }

    document.querySelectorAll(".obra-block[data-obra-id]").forEach((obraElement) => {
      const { obraId, empresaSigla, empresaNome } =
        getSelectedEmpresaDataFromObraElement(obraElement);
      const companyDraftKey = getEmpresaCredentialDraftKey(empresaSigla, empresaNome);

      if (!obraId || !companyDraftKey || companyDraftKey !== storageKey) {
        return;
      }

      syncAdminEmpresaCredentialsForObra(obraId, {
        empresaSigla,
        empresaNome,
      });
    });
  });

  empresaCredentialStorageListenerBound = true;
}

function findEmpresaCredenciais(empresas, empresaSigla, empresaNome) {
  const normalizedSigla = String(empresaSigla || "")
    .trim()
    .toUpperCase();
  const normalizedNome = String(empresaNome || "")
    .trim()
    .toUpperCase();

  return (empresas || []).find((empresaItem) => {
    if (!empresaItem || typeof empresaItem !== "object") {
      return false;
    }

    const codigo = String(empresaItem.codigo || "")
      .trim()
      .toUpperCase();
    const nome = String(empresaItem.nome || "")
      .trim()
      .toUpperCase();

    return Boolean(
      (normalizedSigla && codigo === normalizedSigla) ||
        (normalizedNome && nome === normalizedNome)
    );
  });
}

function renderAdminCredentialUserField({
  obraId,
  usuario = "",
}) {
  if (!isAdminCreateMode()) {
    return "";
  }

  return `
 <div class="form-group-horizontal">
 <label>Usuário de acesso</label>
 <input type="text"
 class="empresa-usuario-cadastro"
 id="empresa-usuario-${obraId}"
 value="${escapeHtml(usuario)}"
 placeholder="Selecione uma empresa primeiro"
 disabled
 readonly
 oninput="window.syncEmpresaCredentialDraft?.('${obraId}')">
 </div>
 `;
}

function renderAdminCredentialTokenField({
  obraId,
  token = "",
  tempoUso = 30,
}) {
  if (!isAdminCreateMode()) {
    return "";
  }

  return `
 <div class="form-group-horizontal">
 <div class="empresa-token-tempo-split">
  <div class="empresa-token-column">
   <div class="empresa-token-column-label">Token de acesso</div>
   <div class="empresa-token-inline" style="display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:8px; align-items:stretch;">
   <input type="text"
    class="empresa-token-cadastro"
    id="empresa-token-${obraId}"
    value="${escapeHtml(token)}"
    placeholder="Selecione uma empresa primeiro"
    disabled
    readonly
    style="flex:1;">
    <div style="display:flex; flex-direction:column; gap:8px;">
    <button type="button"
    class="empresa-token-action"
    data-credential-action="copy"
    onclick="window.copyEmpresaTokenToClipboard('${obraId}', this)"
    title="Copiar token"
    aria-label="Copiar token"
    disabled
    style="white-space:nowrap; padding:0 12px; border:1px solid #d5d9e2; border-radius:8px; background:#f3f6fb; cursor:pointer;">
    Copiar
    </button>
    <button type="button"
    class="empresa-token-action"
    data-credential-action="generate"
    onclick="window.generateEmpresaTokenField('${obraId}')"
    disabled
    style="white-space:nowrap; padding:0 12px; border:none; border-radius:8px; background:#1f4b99; color:#fff; cursor:pointer;">
    Gerar
    </button>
    </div>
    </div>
   </div>
   ${renderAdminCredentialTempoUsoField({ obraId, tempoUso })}
  </div>
 </div>
 `;
}

function renderEmpresaEmailField({
  obraId,
  emailEmpresa = "",
}) {
  if (APP_CONFIG.mode === "client") {
    return "";
  }

  return `
    <div class="form-group-horizontal">
      <label>Email da empresa</label>
      <input type="email" 
        class="email-empresa-cadastro" 
        id="email-empresa-${obraId}"
        value="${emailEmpresa}"
        placeholder="Email para contato e recuperação"
        ${isAdminCreateMode() ? `oninput="window.syncEmpresaCredentialDraft?.('${obraId}')"` : ""}>
    </div>
  `;
}

function renderAdminCredentialTempoUsoField({
  obraId,
  tempoUso = 30,
}) {
  if (!isAdminCreateMode()) {
    return "";
  }

  const normalizedTempoUso = Number.parseInt(tempoUso, 10) || 30;
  const isPredefinedTime = [30, 60, 90].includes(normalizedTempoUso);
  const customValue = isPredefinedTime ? "" : normalizedTempoUso;

  return `
    <div class="empresa-tempo-uso-panel">
      <div class="empresa-tempo-uso-label">Dias</div>
      <div class="empresa-tempo-uso-inline">
        <div class="empresa-tempo-uso-presets">
          <label class="empresa-tempo-uso-option">
            <input type="radio"
              name="empresa-tempo-uso-${obraId}"
              value="30"
              ${normalizedTempoUso === 30 ? "checked" : ""}
              onchange="window.handleEmpresaTempoUsoChange?.('${obraId}')">
            <span>30</span>
          </label>
          <label class="empresa-tempo-uso-option">
            <input type="radio"
              name="empresa-tempo-uso-${obraId}"
              value="60"
              ${normalizedTempoUso === 60 ? "checked" : ""}
              onchange="window.handleEmpresaTempoUsoChange?.('${obraId}')">
            <span>60</span>
          </label>
          <label class="empresa-tempo-uso-option">
            <input type="radio"
              name="empresa-tempo-uso-${obraId}"
              value="90"
              ${normalizedTempoUso === 90 ? "checked" : ""}
              onchange="window.handleEmpresaTempoUsoChange?.('${obraId}')">
            <span>90</span>
          </label>
        </div>
        <div class="empresa-tempo-uso-custom-slot">
          <label class="empresa-tempo-uso-option empresa-tempo-uso-option-custom">
            <input type="radio"
              name="empresa-tempo-uso-${obraId}"
              value="personalizado"
              ${!isPredefinedTime ? "checked" : ""}
              onchange="window.handleEmpresaTempoUsoChange?.('${obraId}')">
            <span>Outro</span>
          </label>
          <div class="empresa-tempo-uso-custom ${!isPredefinedTime ? "is-visible" : ""}"
            id="empresa-tempo-uso-custom-${obraId}">
            <input type="number"
              class="empresa-tempo-uso-input"
              id="empresa-tempo-uso-input-${obraId}"
              value="${customValue}"
              placeholder="dias"
              min="1"
              max="999"
              oninput="window.syncEmpresaCredentialDraft?.('${obraId}')">
          </div>
        </div>
      </div>
    </div>
  `;
}

function getEmpresaTempoUsoValue(obraId) {
  const selectedOption = document.querySelector(
    `input[name="empresa-tempo-uso-${obraId}"]:checked`
  );
  const selectedValue = String(selectedOption?.value || "30").trim().toLowerCase();

  if (selectedValue === "personalizado") {
    const customInput = document.getElementById(`empresa-tempo-uso-input-${obraId}`);
    const customValue = Number.parseInt(customInput?.value, 10);
    return customValue > 0 ? customValue : 30;
  }

  const parsedValue = Number.parseInt(selectedValue, 10);
  return parsedValue > 0 ? parsedValue : 30;
}

function setEmpresaTempoUsoCustomVisibility(
  obraId,
  showCustomInput,
  customValue = ""
) {
  const customContainer = document.getElementById(`empresa-tempo-uso-custom-${obraId}`);
  const customInput = document.getElementById(`empresa-tempo-uso-input-${obraId}`);

  if (customContainer) {
    customContainer.classList.toggle("is-visible", showCustomInput);
  }

  if (customInput) {
    customInput.value = showCustomInput ? String(customValue || "").trim() : "";
  }
}

function setEmpresaTempoUsoValue(obraId, tempoUso = 30) {
  const normalizedTempoUso = Number.parseInt(tempoUso, 10) || 30;
  const selectedValue = [30, 60, 90].includes(normalizedTempoUso)
    ? String(normalizedTempoUso)
    : "personalizado";

  const radioToSelect = document.querySelector(
    `input[name="empresa-tempo-uso-${obraId}"][value="${selectedValue}"]`
  );
  if (radioToSelect) {
    radioToSelect.checked = true;
  }

  const showCustomInput = selectedValue === "personalizado";
  setEmpresaTempoUsoCustomVisibility(
    obraId,
    showCustomInput,
    showCustomInput ? normalizedTempoUso : ""
  );
}

function setAdminCredentialUiState(
  obraId,
  { hasCompany = false, hasToken = false, hasCredentialAccess = false } = {}
) {
  const usuarioInput = document.getElementById(`empresa-usuario-${obraId}`);
  const tokenInput = document.getElementById(`empresa-token-${obraId}`);
  const copyButton = document.querySelector(
    `[data-obra-id="${obraId}"] [data-credential-action="copy"]`
  );
  const generateButton = document.querySelector(
    `[data-obra-id="${obraId}"] [data-credential-action="generate"]`
  );

  if (usuarioInput) {
    usuarioInput.disabled = !hasCompany;
    usuarioInput.readOnly = !hasCompany;
    usuarioInput.placeholder = !hasCompany
      ? "Selecione uma empresa primeiro"
      : hasCredentialAccess
        ? "Usuário para login do cliente"
        : "Defina o usuário de acesso";
  }

  if (tokenInput) {
    tokenInput.disabled = !hasCompany;
    tokenInput.readOnly = true;
    tokenInput.placeholder = !hasCompany
      ? "Selecione uma empresa primeiro"
      : hasCredentialAccess
        ? "Token gerado automaticamente"
        : "Clique em Gerar para criar o token";
  }

  if (generateButton) {
    generateButton.disabled = !hasCompany;
  }

  if (copyButton) {
    copyButton.disabled = !hasCompany || !hasToken;
  }
}

async function syncAdminEmpresaCredentialsForObra(obraId, obraData = null) {
  if (!isAdminCreateMode()) {
    return;
  }

  const obraElement = document.querySelector(`[data-obra-id="${obraId}"]`);
  if (!obraElement) {
    return;
  }

  const usuarioInput = document.getElementById(`empresa-usuario-${obraId}`);
  const tokenInput = document.getElementById(`empresa-token-${obraId}`);
  const emailInput = document.getElementById(`email-empresa-${obraId}`);
  const empresaInput = document.getElementById(`empresa-input-${obraId}`);
  if (!usuarioInput || !tokenInput) {
    return;
  }

  const empresaInputVazio = !String(empresaInput?.value || "").trim();

  const empresaSigla = String(
    obraData?.empresaSigla ||
      obraData?.empresaCodigo ||
      obraElement.dataset.empresaSigla ||
      obraElement.dataset.empresaCodigo ||
      ""
  ).trim();
  const empresaNome = String(
    obraData?.empresaNome || obraElement.dataset.empresaNome || ""
  ).trim();
  const companyKey = getEmpresaCredentialCompanyKey(empresaSigla, empresaNome);
  const hasExplicitCredenciais =
    Boolean(obraData) &&
    Object.prototype.hasOwnProperty.call(obraData, "empresaCredenciais");
  const hasExplicitEmail =
    Boolean(obraData) &&
    (Object.prototype.hasOwnProperty.call(obraData, "emailEmpresa") ||
      Object.prototype.hasOwnProperty.call(obraData, "empresaEmail"));
  const preferExplicitEmail = Boolean(obraData?.preferExplicitEmail);

  if (empresaInputVazio || (!empresaSigla && !empresaNome)) {
    clearAdminCredentialDataset(obraElement);
    usuarioInput.value = "";
    tokenInput.value = "";
    setEmpresaTempoUsoValue(obraId, 30);
    if (emailInput) {
      emailInput.value = "";
    }
    delete obraElement.dataset.emailEmpresa;
    delete obraElement.dataset.empresaEmail;
    setAdminCredentialUiState(obraId, {
      hasCompany: false,
      hasToken: false,
      hasCredentialAccess: false,
    });
    return;
  }

  const credenciaisDaObra =
    hasExplicitCredenciais
      ? obraData?.empresaCredenciais
      : obraElement.dataset.empresaCredCompanyKey === companyKey
      ? getAdminCredentialDataset(obraElement)
      : null;
  const draftLocal = readEmpresaCredentialDraft(empresaSigla, empresaNome);
  const credenciaisRascunho =
    draftLocal && typeof draftLocal === "object" ? draftLocal : null;
  const explicitEmailValue = hasExplicitEmail
    ? String(obraData?.emailEmpresa ?? obraData?.empresaEmail ?? "").trim()
    : "";
  let credenciaisPersistidas = null;
  if (!hasExplicitCredenciais && !hasExplicitEmail) {
    const empresas = await loadAdminEmpresasCache();
    const empresaEncontrada = findEmpresaCredenciais(
      empresas,
      empresaSigla,
      empresaNome
    );
    credenciaisPersistidas = empresaEncontrada?.credenciais;
  }
  const emailResolvido = String(
    credenciaisDaObra?.email ||
      credenciaisDaObra?.recoveryEmail ||
      (preferExplicitEmail ? explicitEmailValue : "") ||
      credenciaisRascunho?.email ||
      credenciaisRascunho?.recoveryEmail ||
      credenciaisPersistidas?.email ||
      credenciaisPersistidas?.recoveryEmail ||
      explicitEmailValue ||
      obraElement.dataset.emailEmpresa ||
      obraElement.dataset.empresaEmail ||
      ""
  ).trim();

  let credenciaisResolvidas = null;
  let hasCredentialAccess = false;

  if (hasAdminCredentialValue(credenciaisDaObra)) {
    credenciaisResolvidas = normalizeAdminCredentialData(
      credenciaisDaObra,
      emailResolvido
    );
  } else if (hasAdminCredentialValue(credenciaisRascunho)) {
    credenciaisResolvidas = normalizeAdminCredentialData(
      credenciaisRascunho,
      emailResolvido
    );
  } else if (hasAdminCredentialValue(credenciaisPersistidas)) {
    credenciaisResolvidas = normalizeAdminCredentialData(
      credenciaisPersistidas,
      emailResolvido
    );
  }

  if (emailInput) {
    emailInput.value = emailResolvido;
  }

  if (emailResolvido) {
    obraElement.dataset.emailEmpresa = emailResolvido;
    obraElement.dataset.empresaEmail = emailResolvido;
  } else {
    delete obraElement.dataset.emailEmpresa;
    delete obraElement.dataset.empresaEmail;
  }

  if (!credenciaisResolvidas) {
    clearAdminCredentialDataset(obraElement);
    usuarioInput.value = "";
    tokenInput.value = "";
    setEmpresaTempoUsoValue(obraId, 30);
    setAdminCredentialUiState(obraId, {
      hasCompany: true,
      hasToken: false,
      hasCredentialAccess: false,
    });
    return;
  }

  usuarioInput.value = String(credenciaisResolvidas.usuario || "").trim();
  tokenInput.value = String(credenciaisResolvidas.token || "").trim();
  hasCredentialAccess = Boolean(usuarioInput.value || tokenInput.value);

  setAdminCredentialUiState(obraId, {
    hasCompany: true,
    hasCredentialAccess,
    hasToken: Boolean(tokenInput.value.trim()),
  });

  obraElement.dataset.empresaCredUsuario = usuarioInput.value.trim();
  obraElement.dataset.empresaCredToken = tokenInput.value.trim();
  obraElement.dataset.empresaCredHasAccess = hasCredentialAccess ? "true" : "false";
  obraElement.dataset.empresaCredCompanyKey = companyKey;
  obraElement.dataset.empresaCredTempoUso = String(
    credenciaisResolvidas.tempoUso || 30
  );
  setEmpresaTempoUsoValue(obraId, credenciaisResolvidas.tempoUso || 30);
  if (credenciaisResolvidas.data_criacao) {
    obraElement.dataset.empresaCredDataCriacao = String(
      credenciaisResolvidas.data_criacao
    );
  } else {
    delete obraElement.dataset.empresaCredDataCriacao;
  }
  if (credenciaisResolvidas.data_expiracao) {
    obraElement.dataset.empresaCredDataExpiracao = String(
      credenciaisResolvidas.data_expiracao
    );
  } else {
    delete obraElement.dataset.empresaCredDataExpiracao;
  }
}

/* ==== SEÇÃO 1: GERENCIAMENTO DE FORMULÁRIOS ==== */

/**
 * Atualiza a interface com os dados da empresa
 */
async function atualizarInterfaceComEmpresa(obraElement, obraData) {
  try {
    // Encontrar o container de cadastro de empresas
    const empresaContainer = obraElement.querySelector(
      ".projetc-header-record.very-dark",
    );
    if (!empresaContainer) {
      console.log(
        ` [EMPRESA] Container de empresa não encontrado na obra "${obraData.nome}"`,
      );
      return;
    }

    // ATUALIZAR HEADER DA OBRA COM SPAN (não botão)
    if (
      window.empresaCadastro &&
      typeof window.empresaCadastro.atualizarHeaderObra === "function"
    ) {
      window.empresaCadastro.atualizarHeaderObra(obraElement, obraData);
    }

    console.log(` [EMPRESA] Interface atualizada com SPAN no header`);
  } catch (error) {
    console.error(` [EMPRESA] Erro ao atualizar interface:`, error);
  }
}

/**
 * Atualiza campos do formulário de empresa existente - com data formatada
 */
function atualizarCamposEmpresaForm(obraData, formElement) {
  const camposMapping = {
    empresaSigla: "empresa-input",
    numeroClienteFinal: "numero-cliente-final",
    clienteFinal: "cliente-final",
    codigoCliente: "codigo-cliente",
    dataCadastro: "data-cadastro",
    orcamentistaResponsavel: "orcamentista-responsavel",
  };

  Object.entries(camposMapping).forEach(([dataField, inputId]) => {
    const input = formElement.querySelector(`#${inputId}`);
    if (input && obraData[dataField]) {
      // FORMATAR DATA SE FOR O CAMPO dataCadastro
      if (dataField === "dataCadastro") {
        input.value = formatEmpresaDate(obraData[dataField]);
      } else {
        input.value = obraData[dataField];
      }

      // Configurar dados adicionais para empresa
      if (dataField === "empresaSigla" && obraData.empresaNome) {
        input.dataset.siglaSelecionada = obraData.empresaSigla;
        input.dataset.nomeSelecionado = obraData.empresaNome;
      }
    }
  });

  // Atualizar preview do ID da obra
  const idObraValue = formElement.querySelector("#obra-id-value");
  if (idObraValue && obraData.idGerado) {
    idObraValue.textContent = obraData.idGerado;
  }
}

/**
 * Cria formulário de empresa com dados existentes - CORRIGIDO
 * Layout em 3 linhas:
 * Linha 1: Empresa | Nº Cliente | Cliente Final
 * Linha 2: Código | Orçamentista | Data
 * Linha 3: Usuário | Email | Token
 */
function criarFormularioEmpresa(obraId, container, dadosExistentes = null) {
  console.log(
    ` [EMPRESA] Criando formulário para obra ${obraId}`,
    dadosExistentes ? "com dados" : "vazio",
  );

  // Remove qualquer botão existente no container
  const botoes = container.querySelectorAll(
    ".btn-empresa-cadastro, .btn-empresa-visualizar",
  );
  botoes.forEach((btn) => btn.remove());

  const dataAtual = new Date().toLocaleDateString("pt-BR");
  const modoEdicao = !!dadosExistentes;

  // Preparar valores
  const valorEmpresa =
    dadosExistentes?.empresaSigla && dadosExistentes?.empresaNome
      ? `${dadosExistentes.empresaSigla} - ${dadosExistentes.empresaNome}`
      : "";

  const numeroCliente = dadosExistentes?.numeroClienteFinal || "";
  const clienteFinal = dadosExistentes?.clienteFinal || "";
  const codigoCliente = dadosExistentes?.codigoCliente || "";
  const empresaCredenciais =
    dadosExistentes?.empresaCredenciais || dadosExistentes?.credenciais || null;
  const emailEmpresa =
    empresaCredenciais?.email ||
    empresaCredenciais?.recoveryEmail ||
    dadosExistentes?.emailEmpresa ||
    dadosExistentes?.empresaEmail ||
    "";
  const dataCadastro = dadosExistentes?.dataCadastro
    ? formatarData(dadosExistentes.dataCadastro)
    : dataAtual;
  const orcamentista = dadosExistentes?.orcamentistaResponsavel || "";

  const formularioHTML = `
<div class="empresa-formulario-ativo" data-modo="${modoEdicao ? "edicao" : "criacao"}">
  <h4>${modoEdicao ? "Dados da Empresa" : "Cadastro de Empresa"}</h4>

  <div class="empresa-form-grid-horizontal">
    <!-- LINHA 1: EMPRESA | Nº CLIENTE | CLIENTE FINAL -->
    <div class="form-group-horizontal">
      <label>Empresa ${!modoEdicao ? "*" : ""}</label>
      <div class="empresa-input-container">
        <input type="text" 
          class="empresa-input-cadastro" 
          id="empresa-input-${obraId}"
          value="${valorEmpresa}"
          placeholder="Digite sigla ou nome ou selecione..."
          autocomplete="off"
          ${modoEdicao ? "" : "required"}>
        <div class="empresa-dropdown" id="empresa-dropdown-${obraId}">
          <div class="dropdown-options" id="empresa-options-${obraId}"></div>
        </div>
      </div>
    </div>

    <div class="form-group-horizontal">
      <label>Nº Cliente</label>
      <input type="text" 
        class="numero-cliente-final-cadastro" 
        id="numero-cliente-${obraId}"
        value="${numeroCliente}"
        placeholder="${modoEdicao ? "Número do cliente" : "Será gerado automaticamente"}"
        ${modoEdicao ? "" : "readonly"}>
    </div>

    <div class="form-group-horizontal">
      <label>Cliente Final</label>
      <input type="text" 
        class="cliente-final-cadastro" 
        id="cliente-final-${obraId}"
        value="${clienteFinal}"
        placeholder="Nome do cliente final">
    </div>

    <!-- LINHA 2: CÓDIGO | ORÇAMENTISTA | DATA -->
    <div class="form-group-horizontal">
      <label>Código</label>
      <input type="text" 
        class="codigo-cliente-cadastro" 
        id="codigo-cliente-${obraId}"
        value="${codigoCliente}"
        placeholder="Código do cliente">
    </div>

    <div class="form-group-horizontal">
      <label>Orçamentista</label>
      <input type="text" 
        class="orcamentista-responsavel-cadastro" 
        id="orcamentista-${obraId}"
        value="${orcamentista}"
        placeholder="Nome do orçamentista">
    </div>

    <div class="form-group-horizontal">
      <label>Data</label>
      <div class="date-input-container">
        <input type="text" 
          class="data-cadastro-cadastro" 
          id="data-cadastro-${obraId}"
          value="${dataCadastro}"
          placeholder="DD/MM/AAAA"
          maxlength="10">
        <span class="calendar-icon" onclick="window.alternarDatePicker('${obraId}')"></span>
      </div>
    </div>

    <!-- LINHA 3: USUÁRIO | EMAIL | TOKEN -->
    ${renderAdminCredentialUserField({ obraId, usuario: empresaCredenciais?.usuario || "" })}
    
    ${renderEmpresaEmailField({ obraId, emailEmpresa })}

    ${renderAdminCredentialTokenField({
      obraId,
      token: empresaCredenciais?.token || "",
      tempoUso: empresaCredenciais?.tempoUso || 30,
    })}
  </div>

  <!-- BOTÕES -->
  <div class="empresa-form-actions">
    <button type="button" class="btn-ocultar" 
      onclick="window.ocultarFormularioEmpresa('${obraId}')">
      Ocultar
    </button>
    <button type="button" class="btn-limpar" 
      onclick="window.limparFormularioEmpresa('${obraId}')">
      Limpar
    </button>
  </div>
</div>
  `;

  // Remove formulário anterior se existir
  const formularioAnterior = container.querySelector(
    ".empresa-formulario-ativo",
  );
  if (formularioAnterior) formularioAnterior.remove();

  container.insertAdjacentHTML("beforeend", formularioHTML);

  setTimeout(() => {
    // Inicializar autocomplete
    if (
      window.APP_CONFIG?.features?.empresaAutocomplete !== false &&
      typeof window.inicializarInputEmpresaHibrido === "function"
    ) {
      window.inicializarInputEmpresaHibrido(obraId);
    }

    // Configurar campo de data
    const dataCampo = document.getElementById(`data-cadastro-${obraId}`);
    if (dataCampo) configurarCampoDataEspecifico(dataCampo);

    // Se tem dados, configurar data attributes e número cliente editável
    if (dadosExistentes) {
      const empresaInput = document.getElementById(`empresa-input-${obraId}`);
      if (empresaInput && dadosExistentes.empresaSigla) {
        empresaInput.dataset.siglaSelecionada = dadosExistentes.empresaSigla;
        empresaInput.dataset.nomeSelecionado =
          dadosExistentes.empresaNome || "";
      }

      const numeroInput = document.getElementById(`numero-cliente-${obraId}`);
      if (numeroInput) {
        numeroInput.removeAttribute("readonly");
        numeroInput.readOnly = false;
      }
    }

    if (typeof window.applyClientEmpresaRestrictions === "function") {
      window.applyClientEmpresaRestrictions(obraId, dadosExistentes);
    }

    syncAdminEmpresaCredentialsForObra(obraId, dadosExistentes);

    console.log(
      ` [EMPRESA] Formulário ${modoEdicao ? "de edição" : "de criação"} criado para obra ${obraId}`,
    );
  }, 12);
}

/**
 * Vincular eventos de mudança para os campos
 */
function vincularEventosMudanca(obraId, container) {
  // Vincular evento change para cada campo editável
  const campos = [
    { selector: ".cliente-final-input", campo: "clienteFinal" },
    { selector: ".codigo-cliente-input", campo: "codigoCliente" },
    {
      selector: ".orcamentista-responsavel-input",
      campo: "orcamentistaResponsavel",
    },
  ];

  campos.forEach(({ selector, campo }) => {
    const input = container.querySelector(selector);
    if (input) {
      // Remover event listener anterior se existir
      input.removeEventListener("change", input._changeHandler);

      // Adicionar handler
      input._changeHandler = function () {
        window.atualizarDadosEmpresa(this, campo, obraId);
      };

      input.addEventListener("change", input._changeHandler);
    }
  });
}

/* ==== SEÇÃO 2: SISTEMA DE DATEPICKER E FORMATAÇÃO DE DATA ==== */

/**
 * Configurar auto-formatação para todos os campos de data
 */
function configurarAutoFormatacaoData() {
  document.addEventListener("input", function (e) {
    if (
      e.target.classList.contains("data-cadastro-cadastro") ||
      e.target.classList.contains("data-cadastro-input")
    ) {
      formatarDataEmTempoReal(e.target);
    }
  });

  // Também prevenir caracteres não numéricos
  document.addEventListener("keydown", function (e) {
    if (
      e.target.classList.contains("data-cadastro-cadastro") ||
      e.target.classList.contains("data-cadastro-input")
    ) {
      permitirApenasNumerosEControles(e);
    }
  });

  // Validação ao sair do campo
  document.addEventListener(
    "blur",
    function (e) {
      if (
        e.target.classList.contains("data-cadastro-cadastro") ||
        e.target.classList.contains("data-cadastro-input")
      ) {
        validarDataInput(e.target);
      }
    },
    true,
  );

  console.log(" Sistema de auto-formatação de data configurado");
}

/**
 * Configura auto-formatação para um campo específico
 */
function configurarCampoDataEspecifico(inputElement) {
  if (!inputElement) return;

  inputElement.addEventListener("input", function () {
    formatarDataEmTempoReal(this);
  });

  inputElement.addEventListener("keydown", function (e) {
    permitirApenasNumerosEControles(e);
  });

  inputElement.addEventListener("blur", function () {
    validarDataInput(this);
  });

  // Configura placeholder e atributos
  inputElement.placeholder = "DD/MM/AAAA";
  inputElement.maxLength = 10;

  console.log(
    " Campo de data configurado com auto-formatação:",
    inputElement.id,
  );
}

/**
 * Alterna entre input text e date quando clica no ícone
 */
window.alternarDatePicker = function (obraId, tipo) {
  const textInput = document.getElementById(
    `data-cadastro-${tipo === "edit" ? "" : ""}${obraId}`,
  );
  const container = textInput?.closest(".date-input-container");

  if (!textInput || !container) return;

  textInput.style.display = "none";

  const datePickerHTML = `
 <div class="date-picker-visible-wrapper" id="date-picker-wrapper-${obraId}">
 <input type="date" 
 class="date-picker-visible"
 id="date-picker-temp-${obraId}"
 onchange="window.aplicarDataDoDatePicker('${obraId}', '${tipo}', this.value)"
 onblur="window.restaurarInputTexto('${obraId}', '${tipo}')">
 <div class="date-display-overlay" id="date-display-${obraId}"></div>
 </div>
 `;

  container.insertAdjacentHTML("beforeend", datePickerHTML);

  const datePicker = container.querySelector(".date-picker-visible");
  const dateDisplay = container.querySelector(`#date-display-${obraId}`);

  let dataInicial = "DD/MM/AAAA";
  if (textInput.value && /^\d{2}\/\d{2}\/\d{4}$/.test(textInput.value)) {
    const [dia, mes, ano] = textInput.value.split("/");
    datePicker.value = `${ano}-${mes}-${dia}`;
    dataInicial = textInput.value;
  }

  atualizarDisplayData(dateDisplay, dataInicial);

  datePicker.addEventListener("input", function () {
    if (this.value) {
      const [ano, mes, dia] = this.value.split("-");
      const dataBrasileira = `${dia}/${mes}/${ano}`;
      atualizarDisplayData(dateDisplay, dataBrasileira);
    } else {
      atualizarDisplayData(dateDisplay, "DD/MM/AAAA");
    }
  });

  datePicker.addEventListener("change", function () {
    if (this.value) {
      const [ano, mes, dia] = this.value.split("-");
      const dataBrasileira = `${dia}/${mes}/${ano}`;
      atualizarDisplayData(dateDisplay, dataBrasileira);
    }
  });

  setTimeout(() => {
    datePicker.focus();
    datePicker.showPicker();
  }, 12);

  console.log(" Date picker ativado para obra:", obraId);
};

/**
 * Aplica a data selecionada no datepicker ao campo de texto
 */
window.aplicarDataDoDatePicker = function (obraId, tipo, dataISO) {
  const container = document
    .querySelector(`#data-cadastro-${obraId}`)
    ?.closest(".date-input-container");
  const textInput = container?.querySelector(`#data-cadastro-${obraId}`);

  const datePickerWrapper = document.getElementById(
    `date-picker-wrapper-${obraId}`,
  );
  if (datePickerWrapper && datePickerWrapper.parentNode) {
    try {
      datePickerWrapper.remove();
    } catch (error) {
      console.log(" Date picker já foi removido:", error.message);
    }
  }

  if (dataISO && textInput) {
    const [ano, mes, dia] = dataISO.split("-");
    const dataBrasileira = `${dia}/${mes}/${ano}`;
    textInput.value = dataBrasileira;
  }

  if (textInput) {
    textInput.style.display = "block";
    setTimeout(() => {
      textInput.focus();
      textInput.setSelectionRange(
        textInput.value.length,
        textInput.value.length,
      );
    }, 50);
  }

  if (dataISO && textInput) {
    const event = new Event("change", { bubbles: true });
    textInput.dispatchEvent(event);
    console.log(" Data do date picker aplicada:", textInput.value);
  }
};

/**
 * Restaura o input de texto se o usuário cancelar
 */
window.restaurarInputTexto = function (obraId, tipo) {
  const container = document
    .querySelector(`#data-cadastro-${obraId}`)
    ?.closest(".date-input-container");
  const textInput = container?.querySelector(`#data-cadastro-${obraId}`);

  const datePickerWrapper = document.getElementById(
    `date-picker-wrapper-${obraId}`,
  );
  if (datePickerWrapper && datePickerWrapper.parentNode) {
    try {
      datePickerWrapper.remove();
    } catch (error) {
      console.log(" Date picker já foi removido (blur):", error.message);
    }
  }

  if (textInput) {
    textInput.style.display = "block";
    setTimeout(() => {
      textInput.focus();
      textInput.setSelectionRange(
        textInput.value.length,
        textInput.value.length,
      );
    }, 50);
  }

  console.log(" Input de texto restaurado");
};

/**
 * Atualiza o display visual da data
 */
function atualizarDisplayData(dateDisplay, dataFormatada) {
  if (!dateDisplay) return;

  dateDisplay.textContent = dataFormatada;

  if (dataFormatada && /^\d{2}\/\d{2}\/\d{4}$/.test(dataFormatada)) {
    dateDisplay.style.color = "#000";
    dateDisplay.style.fontWeight = "normal";
    dateDisplay.style.fontStyle = "normal";
  } else {
    dateDisplay.style.color = "#999";
    dateDisplay.style.fontWeight = "normal";
    dateDisplay.style.fontStyle = "italic";
  }
}

/* ==== SEÇÃO 3: UTILITÁRIOS DE DATA ==== */

/**
 * Obtém data formatada do campo
 * Retorna no formato DD/MM/AAAA para armazenamento (igual ao JSON)
 */
function obterDataFormatadaDoCampo(inputElement) {
  if (!inputElement || !inputElement.value) return null;

  const value = inputElement.value;
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return null;

  // RETORNA NO FORMATO DD/MM/AAAA (igual ao JSON)
  return value;
}

/**
 * Define data no campo formatado
 * Aceita formato YYYY-MM-DD ou DD/MM/AAAA
 */
function definirDataNoCampo(inputElement, data) {
  if (!inputElement || !data) return;

  let dataFormatada;

  if (data.includes("-")) {
    // Formato YYYY-MM-DD
    const [ano, mes, dia] = data.split("-");
    dataFormatada = `${dia}/${mes}/${ano}`;
  } else if (data.includes("/")) {
    // Já está no formato DD/MM/AAAA
    dataFormatada = data;
  } else {
    console.warn("Formato de data não reconhecido:", data);
    return;
  }

  inputElement.value = dataFormatada;
  validarDataInput(inputElement);
}

/**
 * Valida todos os campos de data do formulário
 */
function validarTodosCamposDataNoFormulario(formElement) {
  const camposData = formElement.querySelectorAll(
    ".data-cadastro-cadastro, .data-cadastro-input",
  );
  let todosValidos = true;

  camposData.forEach((campo) => {
    if (!validarDataInput(campo)) {
      todosValidos = false;
    }
  });

  return todosValidos;
}

/**
 * Limpa e reseta campo de data
 */
function limparCampoData(inputElement) {
  if (!inputElement) return;

  inputElement.value = "";
  inputElement.style.borderColor = "";
  inputElement.placeholder = "DD/MM/AAAA";
}

/* ==== SEÇÃO 4: OCULTAR FORMULÁRIO E LIMPEZA ==== */

/**
 * Função para forçar limpeza completa dos campos
 * (Pode ser chamada de qualquer lugar)
 */
function limparCamposEmpresaCompletamente(obraId) {
  try {
    const obraElement = document.querySelector(`[data-obra-id="${obraId}"]`);
    if (!obraElement) return;

    console.log(` [EMPRESA] Forçando limpeza completa para obra ${obraId}`);

    // 1. Todos os inputs de empresa (em qualquer formulário)
    const todosInputsEmpresa = obraElement.querySelectorAll(`
 .empresa-input-cadastro, 
 .empresa-input,
 .numero-cliente-final-cadastro,
 .numero-cliente-final-readonly,
 .cliente-final-cadastro,
 .cliente-final-input,
 .codigo-cliente-cadastro,
 .codigo-cliente-input,
 .email-empresa-cadastro,
 .empresa-usuario-cadastro,
 .empresa-token-cadastro,
 .data-cadastro-cadastro,
 .data-cadastro-input,
 .orcamentista-responsavel-cadastro,
 .orcamentista-responsavel-input
 `);

    todosInputsEmpresa.forEach((input) => {
      // Remover atributo value
      input.removeAttribute("value");

      // Limpar valor
      if (input.readOnly || input.disabled) {
        input.setAttribute("value", "");
      }
      input.value = "";

      // Limpar data attributes
      delete input.dataset.siglaSelecionada;
      delete input.dataset.nomeSelecionado;

      // Restaurar placeholders
      if (
        input.classList.contains("empresa-input-cadastro") ||
        input.classList.contains("empresa-input")
      ) {
        input.placeholder = "Digite sigla ou nome...";
      } else if (
        input.classList.contains("numero-cliente-final-readonly") ||
        input.classList.contains("numero-cliente-final-cadastro")
      ) {
        input.placeholder = "Número do cliente";
      }
    });

    // 2. Remover dropdowns de autocomplete
    const dropdowns = obraElement.querySelectorAll(".empresa-dropdown");
    dropdowns.forEach((dropdown) => dropdown.remove());

    // 3. Limpar data attributes da obra
    const camposParaLimpar = [
      "empresaSigla",
      "empresaNome",
      "numeroClienteFinal",
      "clienteFinal",
      "codigoCliente",
      "emailEmpresa",
      "empresaCredUsuario",
      "empresaCredToken",
      "empresaCredTempoUso",
      "empresaCredDataCriacao",
      "empresaCredDataExpiracao",
      "empresaCredHasAccess",
      "empresaCredCompanyKey",
      "dataCadastro",
      "orcamentistaResponsavel",
      "idGerado",
      "identificadorObra",
    ];

    camposParaLimpar.forEach((campo) => {
      delete obraElement.dataset[campo];
    });

    // 4. Restaurar botão se necessário
    const empresaContainer = obraElement.querySelector(
      ".projetc-header-record.very-dark",
    );
    if (
      empresaContainer &&
      !empresaContainer.querySelector(".btn-empresa-cadastro")
    ) {
      empresaContainer.innerHTML = "";
      const botao = document.createElement("button");
      botao.className = "btn-empresa-cadastro";
      botao.textContent = "Adicionar campos de cadastro de empresas";
      botao.onclick = () => window.ativarCadastroEmpresa(obraId);
      empresaContainer.appendChild(botao);
    }

    console.log(` [EMPRESA] Limpeza completa realizada para obra ${obraId}`);
  } catch (error) {
    console.error(" [EMPRESA] Erro na limpeza completa:", error);
  }
}

/**
 * Ocultar formulário sem limpar dados - corrigido
 */
window.ocultarFormularioEmpresa = function (obraId) {
  try {
    console.log(` [EMPRESA] Ocultando formulário para obra ${obraId}`);

    const obraElement = document.querySelector(`[data-obra-id="${obraId}"]`);
    if (!obraElement) return;

    const empresaContainer = obraElement.querySelector(
      ".projetc-header-record.very-dark",
    );
    if (!empresaContainer) return;

    const formulario = empresaContainer.querySelector(
      ".empresa-formulario-ativo",
    );
    if (formulario) {
      formulario.style.display = "none";

      // VERIFICAR SE TEM DADOS PARA MOSTRAR BOTÃO CORRETO
      const temDados =
        obraElement.dataset.empresaSigla ||
        obraElement.dataset.empresaNome ||
        obraElement.dataset.numeroClienteFinal;

      // Remover qualquer botão existente
      const botoesExistentes = empresaContainer.querySelectorAll(
        ".btn-empresa-cadastro, .btn-empresa-visualizar",
      );
      botoesExistentes.forEach((btn) => btn.remove());

      // Criar botão apropriado
      const novoBotao = document.createElement("button");

      if (temDados) {
        novoBotao.className = "btn-empresa-visualizar";
        novoBotao.textContent = "Visualizar campos de cadastro de empresas";
      } else {
        novoBotao.className = "btn-empresa-cadastro";
        novoBotao.textContent = "Adicionar campos de cadastro de empresas";
      }

      novoBotao.onclick = () => window.ativarCadastroEmpresa(obraId);
      empresaContainer.appendChild(novoBotao);

      console.log(
        ` [EMPRESA] Botão ${temDados ? "visualizar" : "cadastro"} criado`,
      );
    }
  } catch (error) {
    console.error(" [EMPRESA] Erro ao ocultar:", error);
  }
};

// Limpar campos (exceto data)
window.limparFormularioEmpresa = function (obraId) {
  try {
    console.log(` [EMPRESA] Limpando campos para obra ${obraId}`);

    const obraElement = document.querySelector(`[data-obra-id="${obraId}"]`);
    if (!obraElement) return;

    const empresaContainer = obraElement.querySelector(
      ".projetc-header-record.very-dark",
    );
    if (!empresaContainer) return;

    const formulario = empresaContainer.querySelector(
      ".empresa-formulario-ativo",
    );
    if (!formulario) return;

    // Limpar campos
    const camposParaLimpar = [
      "#empresa-input-" + obraId,
      "#numero-cliente-" + obraId,
      "#cliente-final-" + obraId,
      "#codigo-cliente-" + obraId,
      "#email-empresa-" + obraId,
      "#empresa-usuario-" + obraId,
      "#empresa-token-" + obraId,
      "#orcamentista-" + obraId,
    ];

    camposParaLimpar.forEach((seletor) => {
      const campo = formulario.querySelector(seletor);
      if (campo) {
        campo.value = "";
        campo.removeAttribute("value");

        if (seletor.includes("empresa-input")) {
          delete campo.dataset.siglaSelecionada;
          delete campo.dataset.nomeSelecionado;
        }

        if (seletor.includes("numero-cliente")) {
          campo.removeAttribute("readonly");
          campo.readOnly = false;
          campo.placeholder = "Será gerado automaticamente";
        }
      }
    });

    // Manter data atual
    const dataCampo = formulario.querySelector("#data-cadastro-" + obraId);
    if (dataCampo) {
      dataCampo.value = new Date().toLocaleDateString("pt-BR");
    }

    // Limpar data attributes da obra
    const camposParaRemover = [
      "empresaSigla",
      "empresaNome",
      "numeroClienteFinal",
      "clienteFinal",
      "codigoCliente",
      "emailEmpresa",
      "empresaCredUsuario",
      "empresaCredToken",
      "empresaCredTempoUso",
      "empresaCredDataCriacao",
      "empresaCredDataExpiracao",
      "empresaCredHasAccess",
      "empresaCredCompanyKey",
      "orcamentistaResponsavel",
      "idGerado",
      "identificadorObra",
    ];

    camposParaRemover.forEach((campo) => delete obraElement.dataset[campo]);
    clearAdminCredentialDataset(obraElement);

    const usuarioInput = formulario.querySelector(`#empresa-usuario-${obraId}`);
    if (usuarioInput) {
      usuarioInput.value = "";
    }

    const tokenInput = formulario.querySelector(`#empresa-token-${obraId}`);
    if (tokenInput) {
      tokenInput.value = "";
    }

    setAdminCredentialUiState(obraId, {
      hasCompany: false,
      hasToken: false,
      hasCredentialAccess: false,
    });

    // APÓS LIMPAR, FECHAR O FORMULÁRIO E MOSTRAR BOTÃO DE CADASTRO
    formulario.style.display = "none";

    // Remover botões existentes
    const botoesExistentes = empresaContainer.querySelectorAll(
      ".btn-empresa-cadastro, .btn-empresa-visualizar",
    );
    botoesExistentes.forEach((btn) => btn.remove());

    // Criar botão de cadastro (vazio)
    const novoBotao = document.createElement("button");
    novoBotao.className = "btn-empresa-cadastro";
    novoBotao.textContent = "Adicionar campos de cadastro de empresas";
    novoBotao.onclick = () => window.ativarCadastroEmpresa(obraId);
    empresaContainer.appendChild(novoBotao);

    // Resetar título
    const tituloElement = obraElement.querySelector(".obra-title");
    if (tituloElement) {
      tituloElement.textContent = "Nova Obra";
    }

    console.log(
      ` [EMPRESA] Campos limpos, formulário ocultado, botão de cadastro criado`,
    );
  } catch (error) {
    console.error(" [EMPRESA] Erro ao limpar formulário:", error);
  }
};

async function carregarDadosEmpresaNaObra(obraElement, obraData) {
  const obraId = obraElement.dataset.obraId;
  const container = obraElement.querySelector(
    ".projetc-header-record.very-dark",
  );
  if (!container) return;

  // Verificar se há dados de empresa
  const temDados =
    obraData.empresaSigla ||
    obraData.empresaNome ||
    obraData.numeroClienteFinal;
  if (!temDados) return;

  // Criar formulário com os dados
  criarFormularioEmpresa(obraId, container, obraData);

  if (typeof window.applyClientEmpresaRestrictions === "function") {
    setTimeout(() => {
      window.applyClientEmpresaRestrictions(obraId, obraData);
    }, 24);
  }

  // Atualizar o header (título e spacer)
  if (
    window.empresaCadastro &&
    typeof window.empresaCadastro.atualizarHeaderObra === "function"
  ) {
    window.empresaCadastro.atualizarHeaderObra(obraElement, obraData);
  }

  // Garantir que o título da obra seja SIGLA-NUMERO
  const tituloElement = obraElement.querySelector(".obra-title");
  if (tituloElement && obraData.empresaSigla && obraData.numeroClienteFinal) {
    tituloElement.textContent = `${obraData.empresaSigla}-${obraData.numeroClienteFinal}`;
  }

  syncAdminEmpresaCredentialsForObra(obraId, obraData);

  console.log(
    ` [EMPRESA] Dados carregados e interface atualizada para obra ${obraId}`,
  );
}

/* ==== SEÇÃO 5: INICIALIZAÇÃO ==== */
async function copyEmpresaTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const tempInput = document.createElement("input");
  tempInput.value = text;
  document.body.appendChild(tempInput);
  tempInput.select();
  tempInput.setSelectionRange(0, text.length);
  const copied = document.execCommand("copy");
  tempInput.remove();
  return copied;
}

window.generateEmpresaTokenField = function (obraId) {
  const obraElement = document.querySelector(`[data-obra-id="${obraId}"]`);
  const empresaSigla = String(
    obraElement?.dataset.empresaSigla ||
      obraElement?.dataset.empresaCodigo ||
      document.getElementById(`empresa-input-${obraId}`)?.dataset.siglaSelecionada ||
      ""
  ).trim();
  const empresaNome = String(
    obraElement?.dataset.empresaNome ||
      document.getElementById(`empresa-input-${obraId}`)?.dataset.nomeSelecionado ||
      ""
  ).trim();
  if (!empresaSigla && !empresaNome) {
    return;
  }

  const tokenInput = document.getElementById(`empresa-token-${obraId}`);
  if (!tokenInput || tokenInput.disabled) {
    return;
  }

  tokenInput.value = generateEmpresaAccessToken();
  if (obraElement) {
    obraElement.dataset.empresaCredHasAccess = "true";
    obraElement.dataset.empresaCredToken = tokenInput.value.trim();
  }

  setAdminCredentialUiState(obraId, {
    hasCompany: true,
    hasCredentialAccess: true,
    hasToken: true,
  });

  if (typeof window.syncEmpresaCredentialDraft === "function") {
    window.syncEmpresaCredentialDraft(obraId);
  }
};

window.copyEmpresaTokenToClipboard = async function (obraId, button) {
  const token = String(
    document.getElementById(`empresa-token-${obraId}`)?.value || ""
  ).trim();

  if (!token) {
    return;
  }

  try {
    const copied = await copyEmpresaTextToClipboard(token);
    if (!copied) {
      throw new Error("copy_failed");
    }

    if (button) {
      const previousLabel = button.textContent;
      button.textContent = "Ok";
      button.disabled = true;
      setTimeout(() => {
        if (!button.isConnected) return;
        button.textContent = previousLabel;
        button.disabled = false;
      }, 1200);
    }
  } catch (error) {
    console.error(" [EMPRESA] Erro ao copiar token:", error);
  }
};

window.syncEmpresaCredentialDraft = function (obraId) {
  if (!isAdminCreateMode()) {
    return;
  }

  const obraElement = document.querySelector(`[data-obra-id="${obraId}"]`);
  if (!obraElement) {
    return;
  }

  const empresaInput = document.getElementById(`empresa-input-${obraId}`);
  if (!String(empresaInput?.value || "").trim()) {
    clearAdminCredentialDataset(obraElement);
    const usuarioInput = document.getElementById(`empresa-usuario-${obraId}`);
    const tokenInput = document.getElementById(`empresa-token-${obraId}`);
    const emailInput = document.getElementById(`email-empresa-${obraId}`);
    if (usuarioInput) {
      usuarioInput.value = "";
    }
    if (tokenInput) {
      tokenInput.value = "";
    }
    if (emailInput) {
      emailInput.value = "";
    }
    delete obraElement.dataset.empresaSigla;
    delete obraElement.dataset.empresaNome;
    delete obraElement.dataset.emailEmpresa;
    delete obraElement.dataset.empresaEmail;
    setAdminCredentialUiState(obraId, {
      hasCompany: false,
      hasToken: false,
      hasCredentialAccess: false,
    });
    return;
  }

  const empresaSigla = String(
    obraElement.dataset.empresaSigla ||
      obraElement.dataset.empresaCodigo ||
      document.getElementById(`empresa-input-${obraId}`)?.dataset.siglaSelecionada ||
      ""
  ).trim();
  const empresaNome = String(
    obraElement.dataset.empresaNome ||
      document.getElementById(`empresa-input-${obraId}`)?.dataset.nomeSelecionado ||
      ""
  ).trim();
  const companyKey = getEmpresaCredentialCompanyKey(empresaSigla, empresaNome);

  if (!empresaSigla && !empresaNome) {
    clearAdminCredentialDataset(obraElement);
    const usuarioInput = document.getElementById(`empresa-usuario-${obraId}`);
    const tokenInput = document.getElementById(`empresa-token-${obraId}`);
    if (usuarioInput) {
      usuarioInput.value = "";
    }
    if (tokenInput) {
      tokenInput.value = "";
    }
    setAdminCredentialUiState(obraId, {
      hasCompany: false,
      hasToken: false,
      hasCredentialAccess: false,
    });
    return;
  }

  const usuarioInput = document.getElementById(`empresa-usuario-${obraId}`);
  const tokenInput = document.getElementById(`empresa-token-${obraId}`);
  const emailInput = document.getElementById(`email-empresa-${obraId}`);
  const usuarioAtual = String(usuarioInput?.value || "").trim();
  const tokenAtual = String(tokenInput?.value || "").trim();
  const emailAtual = String(emailInput?.value || "").trim();
  const tempoUsoAtual = getEmpresaTempoUsoValue(obraId);
  const hasCredentialAccess = Boolean(tokenAtual);

  if (!hasCredentialAccess) {
    clearAdminCredentialDataset(obraElement);
    clearEmpresaCredentialDraft(empresaSigla, empresaNome);
    setAdminCredentialUiState(obraId, {
      hasCompany: true,
      hasToken: false,
      hasCredentialAccess: false,
    });

    if (emailAtual) {
      obraElement.dataset.emailEmpresa = emailAtual;
      obraElement.dataset.empresaEmail = emailAtual;
    } else {
      delete obraElement.dataset.emailEmpresa;
      delete obraElement.dataset.empresaEmail;
    }
    return;
  }

  obraElement.dataset.empresaCredHasAccess = "true";
  obraElement.dataset.empresaCredCompanyKey = companyKey;
  obraElement.dataset.empresaCredUsuario = usuarioAtual;
  obraElement.dataset.empresaCredToken = tokenAtual;
  obraElement.dataset.empresaCredTempoUso = String(tempoUsoAtual);
  const dataCriacaoAtual = String(
    obraElement.dataset.empresaCredDataCriacao || new Date().toISOString()
  );
  obraElement.dataset.empresaCredDataCriacao = dataCriacaoAtual;
  obraElement.dataset.empresaCredDataExpiracao = String(
    calcularDataExpiracaoISO(tempoUsoAtual, dataCriacaoAtual)
  );

  if (emailAtual) {
    obraElement.dataset.emailEmpresa = emailAtual;
    obraElement.dataset.empresaEmail = emailAtual;
  } else {
    delete obraElement.dataset.emailEmpresa;
    delete obraElement.dataset.empresaEmail;
  }

  writeEmpresaCredentialDraft(empresaSigla, empresaNome, {
    source: "manual-create",
    usuario: obraElement.dataset.empresaCredUsuario,
    token: tokenAtual,
    email: emailAtual,
    tempoUso: tempoUsoAtual,
    data_criacao: obraElement.dataset.empresaCredDataCriacao,
    data_expiracao: obraElement.dataset.empresaCredDataExpiracao,
  });

  setAdminCredentialUiState(obraId, {
    hasCompany: true,
    hasCredentialAccess: true,
    hasToken: Boolean(tokenAtual),
  });
};

window.handleEmpresaTempoUsoChange = function (obraId) {
  if (!isAdminCreateMode()) {
    return;
  }

  const selectedOption = document.querySelector(
    `input[name="empresa-tempo-uso-${obraId}"]:checked`
  );
  const selectedValue = String(selectedOption?.value || "30").trim().toLowerCase();

  if (selectedValue === "personalizado") {
    const customInput = document.getElementById(`empresa-tempo-uso-input-${obraId}`);
    const currentCustomValue = Number.parseInt(customInput?.value, 10);
    setEmpresaTempoUsoCustomVisibility(
      obraId,
      true,
      currentCustomValue > 0 ? currentCustomValue : ""
    );

    if (customInput) {
      customInput.focus();
    }
  } else {
    setEmpresaTempoUsoValue(obraId, Number.parseInt(selectedValue, 10) || 30);
  }

  if (typeof window.syncEmpresaCredentialDraft === "function") {
    window.syncEmpresaCredentialDraft(obraId);
  }
};

export {
  atualizarInterfaceComEmpresa,
  atualizarCamposEmpresaForm,
  vincularEventosMudanca,
  configurarAutoFormatacaoData,
  configurarCampoDataEspecifico,
  atualizarDisplayData,
  obterDataFormatadaDoCampo,
  definirDataNoCampo,
  validarTodosCamposDataNoFormulario,
  limparCampoData,
  limparCamposEmpresaCompletamente,
  criarFormularioEmpresa,
  carregarDadosEmpresaNaObra,
  syncAdminEmpresaCredentialsForObra,
};

// Compatibilidade global
if (typeof window !== "undefined") {
  window.atualizarInterfaceComEmpresa = atualizarInterfaceComEmpresa;
  window.atualizarCamposEmpresaForm = atualizarCamposEmpresaForm;
  window.criarFormularioEmpresa = criarFormularioEmpresa;
  window.vincularEventosMudanca = vincularEventosMudanca;
  window.configurarAutoFormatacaoData = configurarAutoFormatacaoData;
  window.configurarCampoDataEspecifico = configurarCampoDataEspecifico;
  window.atualizarDisplayData = atualizarDisplayData;
  window.obterDataFormatadaDoCampo = obterDataFormatadaDoCampo;
  window.definirDataNoCampo = definirDataNoCampo;
  window.validarTodosCamposDataNoFormulario =
    validarTodosCamposDataNoFormulario;
  window.limparCampoData = limparCampoData;
  window.limparCamposEmpresaCompletamente = limparCamposEmpresaCompletamente;
  window.carregarDadosEmpresaNaObra = carregarDadosEmpresaNaObra;
  window.syncAdminEmpresaCredentialsForObra = syncAdminEmpresaCredentialsForObra;
}

// Inicializar configuração de data quando o módulo for carregado
document.addEventListener("DOMContentLoaded", function () {
  configurarAutoFormatacaoData();
  bindEmpresaCredentialStorageSync();
  console.log(" empresa-form-manager.js carregado com sucesso");
});
