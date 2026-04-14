// scripts/03_Edit_data/empresas.js
// Gerenciamento de empresas com credenciais - Integrado com sistema geral

import { systemData, addPendingChange } from '../config/state.js';
import { escapeHtml, showError, showInfo, showWarning, showConfirmation, showSuccess } from '../config/ui.js';
import { normalizeEmpresa, normalizeEmpresas } from '../../01_Create_Obra/core/shared-utils.js';

const EMPRESA_CREDENTIAL_DRAFT_PREFIX = 'esi.empresaCredentialDraft.';

// Função para formatar data no padrão DD/MM/AAAA
function formatarData(dataISO) {
    if (!dataISO) return '';
    const data = new Date(dataISO);
    const dia = String(data.getDate()).padStart(2, '0');
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const ano = data.getFullYear();
    return `${dia}/${mes}/${ano}`;
}

// Função para gerar token mais complexo usando hexadecimal e formatos variados
function generateToken(length = 32) {
    // Múltiplos formatos para tornar o token mais complexo
    const formats = [
        // UUID-like format (8-4-4-4-12)
        () => {
            const hex = () => Math.floor(Math.random() * 16).toString(16);
            const group = (size) => Array(size).fill().map(hex).join('');
            return `${group(8)}-${group(4)}-${group(4)}-${group(4)}-${group(12)}`;
        },
        // Base64-like com caracteres especiais
        () => {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            return Array(length).fill().map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
        },
        // Hexadecimal puro
        () => {
            return Array(length).fill().map(() => Math.floor(Math.random() * 16).toString(16)).join('');
        },
        // Formato com timestamp e hash
        () => {
            const timestamp = Date.now().toString(36);
            const random = Math.random().toString(36).substring(2, 15);
            const hash = Array(8).fill().map(() => Math.floor(Math.random() * 16).toString(16)).join('');
            return `${timestamp}.${random}.${hash}`;
        }
    ];
    
    // Selecionar formato aleatório
    const selectedFormat = formats[Math.floor(Math.random() * formats.length)];
    let token = selectedFormat();
    
    // Garantir o tamanho mínimo
    if (token.length < length) {
        token += Array(length - token.length).fill().map(() => 
            Math.floor(Math.random() * 16).toString(16)).join('');
    }
    
    return token;
}

function getEmpresaCredentialDraftKey(codigo, nome = '') {
    const normalized = String(codigo || nome || '')
        .trim()
        .toUpperCase();

    return normalized ? `${EMPRESA_CREDENTIAL_DRAFT_PREFIX}${normalized}` : '';
}

function readEmpresaCredentialDraft(codigo, nome = '') {
    const draftKey = getEmpresaCredentialDraftKey(codigo, nome);
    if (!draftKey || typeof window === 'undefined' || !window.localStorage) {
        return null;
    }

    try {
        const rawValue = window.localStorage.getItem(draftKey);
        if (!rawValue) {
            return null;
        }

        const parsedValue = JSON.parse(rawValue);
        return parsedValue && typeof parsedValue === 'object' ? parsedValue : null;
    } catch (error) {
        console.warn('Erro ao ler rascunho de credenciais da empresa:', error);
        return null;
    }
}

function writeEmpresaCredentialDraft(codigo, nome, credenciais) {
    const draftKey = getEmpresaCredentialDraftKey(codigo, nome);
    if (!draftKey || typeof window === 'undefined' || !window.localStorage || !credenciais) {
        return;
    }

    try {
        window.localStorage.setItem(draftKey, JSON.stringify(credenciais));
    } catch (error) {
        console.warn('Erro ao salvar rascunho de credenciais da empresa:', error);
    }
}

function clearEmpresaCredentialDraft(codigo, nome = '') {
    const draftKey = getEmpresaCredentialDraftKey(codigo, nome);
    if (!draftKey || typeof window === 'undefined' || !window.localStorage) {
        return;
    }

    try {
        window.localStorage.removeItem(draftKey);
    } catch (error) {
        console.warn('Erro ao limpar rascunho de credenciais da empresa:', error);
    }
}

function buildEmpresaCredentialState(empresa, credenciais = null) {
    const source = credenciais && typeof credenciais === 'object' ? credenciais : {};
    const tempoUso = parseInt(source.tempoUso, 10) || 30;
    const dataCriacao = String(source.data_criacao || source.createdAt || '').trim();
    const dataBase = new Date(dataCriacao);

    const dataExpiracao =
        String(source.data_expiracao || source.expiracao || '').trim() ||
        (dataCriacao && !Number.isNaN(dataBase.getTime())
            ? (() => {
            const expirationDate = new Date(dataBase);
            expirationDate.setDate(expirationDate.getDate() + tempoUso);
            return expirationDate.toISOString();
        })()
            : '');

    return {
        usuario: String(source.usuario || '').trim(),
        email: String(source.email || source.recoveryEmail || '').trim(),
        token: String(source.token || '').trim(),
        data_criacao: dataCriacao,
        data_expiracao: dataExpiracao,
        tempoUso,
    };
}

function getEmpresaNumeroClienteAtual(empresa) {
    return Math.max(parseInt(empresa?.numeroClienteAtual, 10) || 0, 0);
}

function resolveNumeroClienteAtualInput(defaultValue = 0) {
    const inputValue = document.getElementById('numeroClienteAtualInput')?.value;
    const parsedValue = parseInt(inputValue, 10);
    return Math.max(Number.isNaN(parsedValue) ? defaultValue : parsedValue, 0);
}

function syncEmpresaCredenciaisInRenderedObras(empresa, credenciais = null) {
    if (typeof document === 'undefined' || !empresa) {
        return;
    }

    const empresaCodigo = String(empresa.codigo || '').trim().toUpperCase();
    const empresaNome = String(empresa.nome || '').trim().toUpperCase();
    const credencialValida = credenciais && typeof credenciais === 'object' ? credenciais : null;

    document.querySelectorAll('.obra-block[data-obra-id]').forEach((obraElement) => {
        const obraId = obraElement.dataset.obraId;
        const empresaInput = obraId ? document.getElementById(`empresa-input-${obraId}`) : null;
        const obraCodigo = String(
            empresaInput?.dataset?.siglaSelecionada ||
            obraElement.dataset.empresaSigla ||
            obraElement.dataset.empresaCodigo ||
            ''
        ).trim().toUpperCase();
        const obraNome = String(
            empresaInput?.dataset?.nomeSelecionado ||
            obraElement.dataset.empresaNome ||
            ''
        ).trim().toUpperCase();

        if (!((empresaCodigo && obraCodigo === empresaCodigo) || (empresaNome && obraNome === empresaNome))) {
            return;
        }

        const usuarioInput = obraId ? document.getElementById(`empresa-usuario-${obraId}`) : null;
        const tokenInput = obraId ? document.getElementById(`empresa-token-${obraId}`) : null;
        const emailInput = obraId ? document.getElementById(`email-empresa-${obraId}`) : null;

        if (!credencialValida) {
            [
                'empresaCredUsuario',
                'empresaCredToken',
                'empresaCredTempoUso',
                'empresaCredDataCriacao',
                'empresaCredDataExpiracao',
                'empresaCredHasAccess',
                'empresaCredCompanyKey'
            ].forEach((field) => delete obraElement.dataset[field]);

            if (usuarioInput) usuarioInput.value = '';
            if (tokenInput) tokenInput.value = '';
            if (emailInput) emailInput.value = '';
            delete obraElement.dataset.emailEmpresa;
            delete obraElement.dataset.empresaEmail;

            if (obraId && typeof window.syncAdminEmpresaCredentialsForObra === 'function') {
                window.syncAdminEmpresaCredentialsForObra(obraId, {
                    empresaSigla: empresa.codigo || '',
                    empresaCodigo: empresa.codigo || '',
                    empresaNome: empresa.nome || '',
                    emailEmpresa: '',
                    empresaCredenciais: null
                });
            }
            return;
        }

        const usuario = String(credencialValida.usuario || '').trim();
        const token = String(credencialValida.token || '').trim();
        const email = String(credencialValida.email || '').trim();
        const hasAccess = Boolean(usuario || token);

        obraElement.dataset.empresaCredUsuario = usuario;
        obraElement.dataset.empresaCredToken = token;
        obraElement.dataset.empresaCredTempoUso = String(credencialValida.tempoUso || 30);
        obraElement.dataset.empresaCredHasAccess = hasAccess ? 'true' : 'false';
        obraElement.dataset.empresaCredCompanyKey = empresaCodigo || empresaNome;

        if (credencialValida.data_criacao) {
            obraElement.dataset.empresaCredDataCriacao = String(credencialValida.data_criacao);
        } else {
            delete obraElement.dataset.empresaCredDataCriacao;
        }

        if (credencialValida.data_expiracao) {
            obraElement.dataset.empresaCredDataExpiracao = String(credencialValida.data_expiracao);
        } else {
            delete obraElement.dataset.empresaCredDataExpiracao;
        }

        if (email) {
            obraElement.dataset.emailEmpresa = email;
            obraElement.dataset.empresaEmail = email;
        } else {
            delete obraElement.dataset.emailEmpresa;
            delete obraElement.dataset.empresaEmail;
        }

        if (usuarioInput) usuarioInput.value = usuario;
        if (tokenInput) tokenInput.value = token;
        if (emailInput) emailInput.value = email;

        if (obraId && typeof window.syncAdminEmpresaCredentialsForObra === 'function') {
            window.syncAdminEmpresaCredentialsForObra(obraId, {
                empresaSigla: empresa.codigo || '',
                empresaCodigo: empresa.codigo || '',
                empresaNome: empresa.nome || '',
                emailEmpresa: email,
                empresaCredenciais: credencialValida,
                preferExplicitEmail: true
            });
        }
    });
}

// Calcular data de expiração baseada no tempo de uso
function calcularDataExpiracao(tempoUso) {
    const data = new Date();
    data.setDate(data.getDate() + tempoUso);
    return data.toISOString();
}

// Função para atualizar a data de expiração no modal em tempo real
function atualizarDataExpiracao() {
    const tempoUsoRadio = document.querySelector('input[name="tempoUso"]:checked');
    if (!tempoUsoRadio) return;
    
    let tempoUso;
    
    if (tempoUsoRadio.value === 'personalizado') {
        const tempoPersonalizado = document.getElementById('tempoPersonalizado')?.value;
        tempoUso = parseInt(tempoPersonalizado);
        if (!tempoPersonalizado || isNaN(tempoUso) || tempoUso < 1) return;
    } else {
        tempoUso = parseInt(tempoUsoRadio.value);
    }
    
    const dataExpiracao = calcularDataExpiracao(tempoUso);
    const dataExpiracaoElement = document.getElementById('dataExpiracaoDisplay');
    if (dataExpiracaoElement) {
        dataExpiracaoElement.textContent = formatarData(dataExpiracao);
    }
}

function updateCredentialsAutosaveStatus(message, tone = 'muted') {
    const statusElement = document.getElementById('credentialsAutosaveStatus');
    if (!statusElement) {
        return;
    }

    const palette = {
        muted: '#a0aec0',
        success: '#68d391',
        warning: '#f6ad55',
        error: '#fc8181'
    };

    statusElement.textContent = message || 'Pré-salvamento automático ao sair do campo.';
    statusElement.style.color = palette[tone] || palette.muted;
}

function resolveCredentialTempoUso(showErrors = false) {
    const tempoUsoRadio = document.querySelector('input[name="tempoUso"]:checked');

    if (!tempoUsoRadio) {
        if (showErrors) {
            showError('Selecione o tempo de uso');
        }
        return null;
    }

    if (tempoUsoRadio.value === 'personalizado') {
        const tempoPersonalizado = document.getElementById('tempoPersonalizado')?.value;
        const tempoUso = parseInt(tempoPersonalizado, 10);

        if (!tempoPersonalizado || Number.isNaN(tempoUso) || tempoUso < 1) {
            if (showErrors) {
                showError('Digite um valor válido para o tempo personalizado (mínimo 1 dia)');
            }
            return null;
        }

        if (tempoUso > 999) {
            if (showErrors) {
                showError('O tempo máximo é 999 dias');
            }
            return null;
        }

        return tempoUso;
    }

    return parseInt(tempoUsoRadio.value, 10) || 30;
}

function buildCredentialDraftPayload(currentCredenciais = null) {
    const tempoUso = resolveCredentialTempoUso(false);
    const dataCriacaoAtual = String(currentCredenciais?.data_criacao || '').trim();
    const numeroClienteAtualPadrao = Math.max(
        parseInt(document.getElementById('numeroClienteAtualInput')?.defaultValue, 10) || 0,
        0
    );

    return {
        usuario: document.getElementById('usuarioInput')?.value?.trim() || '',
        email: document.getElementById('emailInput')?.value?.trim() || '',
        token: document.getElementById('tokenInput')?.value?.trim() || '',
        numeroClienteAtual: resolveNumeroClienteAtualInput(numeroClienteAtualPadrao),
        tempoUso: tempoUso || parseInt(currentCredenciais?.tempoUso, 10) || 30,
        data_criacao: dataCriacaoAtual || new Date().toISOString(),
        data_expiracao: tempoUso ? calcularDataExpiracao(tempoUso) : String(currentCredenciais?.data_expiracao || '').trim(),
        source: 'manual-edit-draft'
    };
}

function persistCredentialModalState(empresaIndex, { quiet = true, showFeedback = false } = {}) {
    try {
        if (!systemData.empresas || !systemData.empresas[empresaIndex]) {
            if (!quiet) {
                showError('Empresa não encontrada');
            }
            updateCredentialsAutosaveStatus('Empresa não encontrada.', 'error');
            return false;
        }

        const empresa = normalizeEmpresa(systemData.empresas[empresaIndex]);
        const credenciaisAtuais = empresa?.credenciais && typeof empresa.credenciais === 'object'
            ? empresa.credenciais
            : readEmpresaCredentialDraft(empresa?.codigo, empresa?.nome);
        const draft = buildCredentialDraftPayload(credenciaisAtuais);
        const numeroClienteAtual = Math.max(parseInt(draft.numeroClienteAtual, 10) || 0, 0);

        writeEmpresaCredentialDraft(empresa.codigo, empresa.nome, draft);

        if (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) {
            if (!quiet) {
                showError('Informe um email válido para recuperação.');
            }
            updateCredentialsAutosaveStatus('Rascunho salvo. Corrija o email para aplicar.', 'warning');
            return false;
        }

        if (!draft.usuario || !draft.token) {
            updateCredentialsAutosaveStatus('Rascunho salvo. Usuário e token são obrigatórios.', 'warning');
            return false;
        }

        const tempoUso = resolveCredentialTempoUso(!quiet);
        if (!tempoUso) {
            updateCredentialsAutosaveStatus('Rascunho salvo. Defina um tempo de uso válido.', 'warning');
            return false;
        }

        const dataCriacao = String(credenciaisAtuais?.data_criacao || draft.data_criacao || '').trim() || new Date().toISOString();
        const credenciais = {
            usuario: draft.usuario,
            email: draft.email,
            token: draft.token,
            data_criacao: dataCriacao,
            data_expiracao: calcularDataExpiracao(tempoUso),
            tempoUso,
            source: 'manual-edit'
        };

        systemData.empresas[empresaIndex] = {
            ...empresa,
            numeroClienteAtual,
            credenciais
        };

        writeEmpresaCredentialDraft(empresa.codigo, empresa.nome, credenciais);
        syncEmpresaCredenciaisInRenderedObras(empresa, credenciais);
        addPendingChange('empresas');
        updateCredentialsAutosaveStatus('Pré-salvo automaticamente.', 'success');

        if (showFeedback) {
            showSuccess(`Credenciais ${empresa.credenciais ? 'atualizadas' : 'criadas'} em pré-salvamento.`);
        }

        return true;
    } catch (error) {
        console.error('Erro no pré-salvamento das credenciais:', error);
        updateCredentialsAutosaveStatus('Falha ao pré-salvar.', 'error');
        if (!quiet) {
            showError('Erro ao processar credenciais');
        }
        return false;
    }
}

function closeCredentialsModal(empresaIndex, { persist = true } = {}) {
    if (persist) {
        persistCredentialModalState(empresaIndex, { quiet: true });
    }

    document.getElementById('credentialsModal')?.remove();
    loadEmpresas();
}

// Modal de gerenciamento de credenciais - MODO ESCURO (apenas o modal)
function showCredentialsModal(index) {
    // Validar índice
    if (index === undefined || index === null || !systemData.empresas || !systemData.empresas[index]) {
        showError('Empresa não encontrada');
        return;
    }
    
    const empresa = normalizeEmpresa(systemData.empresas[index]);
    
    // Validar empresa
    if (!empresa) {
        showError('Dados da empresa inválidos');
        return;
    }
    
    // Remover modal existente se houver
    const existingModal = document.getElementById('credentialsModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Verificar credenciais de forma segura
    const temCredenciais = empresa.credenciais && 
                          typeof empresa.credenciais === 'object' && 
                          empresa.credenciais !== null;
    
    // Valores padrão para o formulário
    const credenciaisPersistidas = temCredenciais ? empresa.credenciais : null;
    const credenciaisRascunho = readEmpresaCredentialDraft(empresa.codigo, empresa.nome);
    const credenciaisRascunhoValidas = ['manual-edit', 'manual-edit-draft'].includes(credenciaisRascunho?.source)
        ? credenciaisRascunho
        : null;
    const credenciais = buildEmpresaCredentialState(
        empresa,
        credenciaisPersistidas || credenciaisRascunhoValidas
    );
    
    // Garantir que todos os campos existam
    const usuarioAtual = credenciais.usuario || '';
    const emailAtual = credenciais.email || credenciais.recoveryEmail || '';
    const tokenAtual = credenciais.token || '';
    const tempoUsoAtual = credenciais.tempoUso || 30;
    const dataCriacaoAtual = credenciais.data_criacao;
    const dataExpiracaoAtual = credenciais.data_expiracao;
    
    // Verificar se o tempo atual está nos valores predefinidos
    const isPredefinedTime = [30, 60, 90].includes(tempoUsoAtual);
    const numeroClienteAtual = getEmpresaNumeroClienteAtual(empresa);
    
    const modal = document.createElement('div');
    modal.id = 'credentialsModal';
    modal.className = 'modal';
    modal.dataset.empresaCodigo = empresa.codigo || '';
    modal.dataset.empresaNome = empresa.nome || '';
    modal.dataset.empresaIndex = String(index);
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        backdrop-filter: blur(4px);
    `;
    
    // Fechar modal ao clicar fora
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeCredentialsModal(index);
        }
    });
    
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.cssText = `
        background: #1a2634;
        padding: 24px;
        border-radius: 12px;
        max-width: 600px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4);
        border: 1px solid #2d3748;
        color: #e2e8f0;
    `;
    
    modalContent.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #2d3748; padding-bottom: 16px;">
            <h2 style="margin: 0; color: #f7fafc; font-size: 1.5rem; font-weight: 600;">
                ${temCredenciais ? 'Editar' : 'Criar'} Credenciais - ${escapeHtml(empresa.codigo || '')}
            </h2>
            <button class="modal-close" style="
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #a0aec0;
                padding: 0 8px;
                line-height: 1;
                transition: all 0.2s ease;
                border-radius: 4px;
            " onmouseover="this.style.color='#f7fafc'; this.style.background='#2d3748'" 
               onmouseout="this.style.color='#a0aec0'; this.style.background='none'">&times;</button>
        </div>
        
        <div style="margin-bottom: 20px; background: #25303f; padding: 12px; border-radius: 6px; border-left: 4px solid #4a5568;">
            <p style="margin: 0 0 5px 0;"><strong style="color: #cbd5e0;">Empresa:</strong> <span style="color: #f7fafc;">${escapeHtml(empresa.nome || '')}</span></p>
            ${dataCriacaoAtual ? `
                <p style="margin: 0 0 5px 0;"><strong style="color: #cbd5e0;">Data de Criação:</strong> <span style="color: #f7fafc;">${formatarData(dataCriacaoAtual)}</span></p>
            ` : ''}
            <p style="margin: 0;"><strong style="color: #cbd5e0;">Data de Expiração:</strong> <span id="dataExpiracaoDisplay" style="color: #f7fafc; font-weight: 500;">${formatarData(dataExpiracaoAtual)}</span></p>
        </div>
        
        <form id="credentialsForm">
            <div style="margin-bottom: 16px; opacity: 0.88;">
                <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #cbd5e0;">
                    Nº Cliente:
                </label>
                <input type="number" id="numeroClienteAtualInput" value="${numeroClienteAtual}"
                       min="0"
                       inputmode="numeric"
                       style="width: 140px; padding: 7px 8px; border: 1px solid #2d3748; border-radius: 6px; font-size: 0.95rem; background: #25303f; color: #cbd5e0;">
                <small style="color: #a0aec0; display: block; margin-top: 5px; font-size: 0.8rem;">
                    Último número de obra da empresa. O valor não retrocede abaixo do maior número já usado.
                </small>
            </div>
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #cbd5e0;">
                    Usuário:
                </label>
                <input type="text" id="usuarioInput" value="${escapeHtml(usuarioAtual)}" 
                       placeholder="Nome de usuário para acesso"
                       required
                       style="width: 100%; padding: 8px; border: 1px solid #2d3748; border-radius: 6px; font-size: 1rem; transition: all 0.2s ease; background: #2d3748; color: #f7fafc;"
                       onfocus="this.style.borderColor='#4a5568'; this.style.boxShadow='0 0 0 3px rgba(74, 85, 104, 0.3)'; this.style.outline='none'"
                       onblur="this.style.borderColor='#2d3748'; this.style.boxShadow='none'">
            </div>

            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #cbd5e0;">
                    Email de recuperação:
                </label>
                <input type="email" id="emailInput" value="${escapeHtml(emailAtual)}" 
                       placeholder="Email usado para recuperar a senha"
                       style="width: 100%; padding: 8px; border: 1px solid #2d3748; border-radius: 6px; font-size: 1rem; transition: all 0.2s ease; background: #2d3748; color: #f7fafc;"
                       onfocus="this.style.borderColor='#4a5568'; this.style.boxShadow='0 0 0 3px rgba(74, 85, 104, 0.3)'; this.style.outline='none'"
                       onblur="this.style.borderColor='#2d3748'; this.style.boxShadow='none'">
                <small style="color: #a0aec0; display: block; margin-top: 5px; font-size: 0.85rem;">
                    Este email receberá o token caso o cliente esqueça o acesso.
                </small>
            </div>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #cbd5e0;">
                    Token de Acesso:
                </label>
                <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                    <input type="text" id="tokenInput" value="${escapeHtml(tokenAtual)}" 
                           placeholder="Token gerado automaticamente"
                           readonly
                           required
                           style="flex: 1; padding: 8px; border: 1px solid #2d3748; border-radius: 6px; background: #25303f; font-family: monospace; font-size: 0.9rem; color: #cbd5e0;">
                    <button type="button" onclick="window.copyTokenToClipboard(this)" 
                            title="Copiar token"
                            aria-label="Copiar token"
                            class="btn btn-secondary"
                            style="width: 42px; min-width: 42px; padding: 8px; display: inline-flex; align-items: center; justify-content: center; background: #2d3748; color: white; border: none; border-radius: 6px; cursor: pointer; transition: background 0.2s ease;"
                            onmouseover="this.style.background='#3a4758'" 
                            onmouseout="this.style.background=this.dataset.active==='true' ? '#2f855a' : '#2d3748'">
                        <i class="fa-regular fa-copy" aria-hidden="true"></i>
                    </button>
                    <button type="button" onclick="window.generateNewToken()" 
                            class="btn btn-secondary"
                            style="padding: 8px 16px; white-space: nowrap; background: #4a5568; color: white; border: none; border-radius: 6px; font-weight: 500; cursor: pointer; transition: background 0.2s ease;"
                            onmouseover="this.style.background='#5f6b7a'" 
                            onmouseout="this.style.background='#4a5568'">
                        Gerar Novo
                    </button>
                </div>
                <small style="color: #a0aec0; display: block; font-size: 0.85rem;">
                    Token complexo gerado automaticamente com formatos variados (hex, uuid, base64)
                </small>
            </div>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 10px; font-weight: 600; color: #cbd5e0;">
                    Tempo de Uso (dias):
                </label>
                <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 10px;">
                    <label style="display: flex; align-items: center; gap: 5px; cursor: pointer; color: #cbd5e0;">
                        <input type="radio" name="tempoUso" value="30" ${isPredefinedTime && tempoUsoAtual === 30 ? 'checked' : ''} onchange="window.atualizarDataExpiracao(); toggleTempoPersonalizado(false);" style="accent-color: #4a5568;">
                        <span>30 dias</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 5px; cursor: pointer; color: #cbd5e0;">
                        <input type="radio" name="tempoUso" value="60" ${isPredefinedTime && tempoUsoAtual === 60 ? 'checked' : ''} onchange="window.atualizarDataExpiracao(); toggleTempoPersonalizado(false);" style="accent-color: #4a5568;">
                        <span>60 dias</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 5px; cursor: pointer; color: #cbd5e0;">
                        <input type="radio" name="tempoUso" value="90" ${isPredefinedTime && tempoUsoAtual === 90 ? 'checked' : ''} onchange="window.atualizarDataExpiracao(); toggleTempoPersonalizado(false);" style="accent-color: #4a5568;">
                        <span>90 dias</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 5px; cursor: pointer; color: #cbd5e0;">
                        <input type="radio" name="tempoUso" value="personalizado" ${!isPredefinedTime ? 'checked' : ''} onchange="window.atualizarDataExpiracao(); toggleTempoPersonalizado(true);" style="accent-color: #4a5568;">
                        <span>Personalizado</span>
                    </label>
                </div>
                
                <div id="tempoPersonalizadoContainer" style="margin-top: 10px; ${!isPredefinedTime ? 'display: block;' : 'display: none;'}">
                    <input type="number" id="tempoPersonalizado" 
                           value="${!isPredefinedTime ? tempoUsoAtual : ''}" 
                           placeholder="Digite o número de dias"
                           min="1" max="999"
                           oninput="window.atualizarDataExpiracao()"
                           style="width: 100%; padding: 8px; border: 1px solid #2d3748; border-radius: 6px; font-size: 1rem; background: #2d3748; color: #f7fafc;"
                           onfocus="this.style.borderColor='#4a5568'; this.style.outline='none'"
                           onblur="this.style.borderColor='#2d3748'">
                    <small style="color: #a0aec0; display: block; margin-top: 5px; font-size: 0.85rem;">
                        Digite um valor personalizado (1 a 999 dias)
                    </small>
                </div>
            </div>
            
            <div style="display: flex; gap: 10px; justify-content: flex-end; align-items: center; margin-top: 20px; border-top: 1px solid #2d3748; padding-top: 20px;">
                <span id="credentialsAutosaveStatus" style="margin-right: auto; color: #a0aec0; font-size: 0.85rem;">
                    Pré-salvamento automático ao sair do campo.
                </span>
                <button type="button" onclick="window.closeCredentialsModal?.(${index})" 
                        class="btn btn-secondary"
                        style="padding: 8px 16px; background: #4a5568; color: white; border: none; border-radius: 6px; font-weight: 500; cursor: pointer; transition: background 0.2s ease;"
                        onmouseover="this.style.background='#5f6b7a'" 
                        onmouseout="this.style.background='#4a5568'">
                    Fechar
                </button>
            </div>
        </form>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Adicionar eventos
    const closeBtn = modalContent.querySelector('.modal-close');
    closeBtn.addEventListener('click', () => closeCredentialsModal(index));
    
    const form = document.getElementById('credentialsForm');

    form.addEventListener('focusout', (event) => {
        if (event.target instanceof HTMLInputElement) {
            persistCredentialModalState(index, { quiet: true });
        }
    });

    form.addEventListener('change', () => {
        persistCredentialModalState(index, { quiet: true });
    });
    
    // Adicionar funções globais para o modal
    window.toggleTempoPersonalizado = function(show) {
        const container = document.getElementById('tempoPersonalizadoContainer');
        if (container) {
            container.style.display = show ? 'block' : 'none';
        }
    };
    
    window.atualizarDataExpiracao = atualizarDataExpiracao;
    window.closeCredentialsModal = closeCredentialsModal;
    updateCredentialsAutosaveStatus();
}

// Função global para gerar novo token
window.generateNewToken = function() {
    const tokenInput = document.getElementById('tokenInput');
    if (tokenInput) {
        tokenInput.value = generateToken(32);
        const modal = document.getElementById('credentialsModal');
        const empresaIndex = parseInt(modal?.dataset?.empresaIndex || '', 10);
        if (Number.isInteger(empresaIndex)) {
            persistCredentialModalState(empresaIndex, { quiet: true });
        }
    }
};

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }

    const tokenInput = document.getElementById('tokenInput');
    if (!tokenInput) {
        return false;
    }

    tokenInput.removeAttribute('readonly');
    tokenInput.select();
    tokenInput.setSelectionRange(0, tokenInput.value.length);
    const copied = document.execCommand('copy');
    tokenInput.setAttribute('readonly', 'readonly');
    tokenInput.blur();
    return copied;
}

window.copyTokenToClipboard = async function(button) {
    const token = document.getElementById('tokenInput')?.value?.trim();

    if (!token) {
        showWarning('Não há token para copiar.');
        return;
    }

    try {
        const copied = await copyTextToClipboard(token);
        if (!copied) {
            throw new Error('copy_failed');
        }

        if (button) {
            button.dataset.active = 'true';
            button.style.background = '#2f855a';
            button.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i>';
            window.setTimeout(() => {
                if (!button.isConnected) return;
                button.dataset.active = 'false';
                button.style.background = '#2d3748';
                button.innerHTML = '<i class="fas fa-copy" aria-hidden="true"></i>';
            }, 1600);
        }

        showSuccess('Token copiado para a area de transferencia.');
    } catch (error) {
        console.error('Erro ao copiar token:', error);
        showError('Não foi possível copiar o token.');
    }
};

// Função para salvar credenciais (apenas localmente, sem chamada API)
window.saveCredentials = function(empresaIndex) {
    try {
        const usuario = document.getElementById('usuarioInput')?.value;
        const email = document.getElementById('emailInput')?.value?.trim() || '';
        const token = document.getElementById('tokenInput')?.value;
        
        // Pegar o valor do radio button selecionado
        const tempoUsoRadio = document.querySelector('input[name="tempoUso"]:checked');
        
        if (!tempoUsoRadio) {
            showError('Selecione o tempo de uso');
            return;
        }
        
        let tempoUso;
        
        if (tempoUsoRadio.value === 'personalizado') {
            // Usar valor personalizado
            const tempoPersonalizado = document.getElementById('tempoPersonalizado')?.value;
            tempoUso = parseInt(tempoPersonalizado);
            
            if (!tempoPersonalizado || isNaN(tempoUso) || tempoUso < 1) {
                showError('Digite um valor válido para o tempo personalizado (mínimo 1 dia)');
                return;
            }
            
            if (tempoUso > 999) {
                showError('O tempo máximo é 999 dias');
                return;
            }
        } else {
            // Usar valor predefinido
            tempoUso = parseInt(tempoUsoRadio.value);
        }
        
        // Validações
        if (!usuario || usuario.trim() === '') {
            showError('O campo usuário é obrigatório');
            return;
        }
        
        if (!token || token.trim() === '') {
            showError('O token é obrigatório. Clique em "Gerar Novo" para criar um token.');
            return;
        }
        
        // Validar empresa
        if (!systemData.empresas || !systemData.empresas[empresaIndex]) {
            showError('Empresa não encontrada');
            return;
        }
        
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showError('Informe um email válido para recuperação.');
            return;
        }

        const empresa = normalizeEmpresa(systemData.empresas[empresaIndex]);
        const credenciaisAtuais = empresa?.credenciais && typeof empresa.credenciais === 'object'
            ? empresa.credenciais
            : readEmpresaCredentialDraft(empresa?.codigo, empresa?.nome);
        
        // Calcular datas
        const dataCriacao = String(credenciaisAtuais?.data_criacao || '').trim() || new Date().toISOString();
        const dataExpiracao = calcularDataExpiracao(tempoUso);
        
        // Criar objeto de credenciais
        const credenciais = {
            usuario: usuario.trim(),
            email,
            token: token.trim(),
            data_criacao: dataCriacao,
            data_expiracao: dataExpiracao,
            tempoUso: tempoUso,
            source: 'manual-edit'
        };
        
        // Atualizar localmente
        systemData.empresas[empresaIndex] = {
            ...empresa,
            credenciais: credenciais
        };

        writeEmpresaCredentialDraft(empresa.codigo, empresa.nome, credenciais);
        syncEmpresaCredenciaisInRenderedObras(empresa, credenciais);
        
        // Fechar modal
        document.getElementById('credentialsModal')?.remove();
        
        // Recarregar tabela
        loadEmpresas();
        
        // Sinalizar que houve mudança para o sistema geral de salvamento
        addPendingChange('empresas');
        
        showSuccess(`Credenciais ${empresa.credenciais ? 'atualizadas' : 'criadas'} com sucesso!`);
        
    } catch (error) {
        console.error('Erro no formulário:', error);
        showError('Erro ao processar formulário');
    }
};

// Função para remover credenciais (apenas localmente, sem chamada API)
window.saveCredentials = function(empresaIndex) {
    if (persistCredentialModalState(empresaIndex, { quiet: false, showFeedback: true })) {
        closeCredentialsModal(empresaIndex, { persist: false });
    }
};

async function removeCredentials(index, sigla) {
    try {
        if (!systemData.empresas || !systemData.empresas[index]) {
            showError('Empresa não encontrada');
            return;
        }
        
        const empresa = normalizeEmpresa(systemData.empresas[index]);
        
        showConfirmation(`Deseja remover as credenciais da empresa "${sigla}"?`, async () => {
            try {
                // Atualizar localmente
                systemData.empresas[index] = {
                    ...empresa,
                    credenciais: null
                };

                clearEmpresaCredentialDraft(empresa.codigo, empresa.nome);
                syncEmpresaCredenciaisInRenderedObras(empresa, null);
                
                loadEmpresas();
                
                // Sinalizar que houve mudança para o sistema geral de salvamento
                addPendingChange('empresas');
                
                showWarning(`Credenciais removidas da empresa "${sigla}".`);
                
            } catch (error) {
                console.error('Erro ao remover credenciais:', error);
                showError(`Erro ao remover credenciais: ${error.message}`);
            }
        });
    } catch (error) {
        console.error('Erro ao processar remoção:', error);
        showError('Erro ao processar remoção de credenciais');
    }
}

export function loadEmpresas() {
    const tbody = document.getElementById('empresasTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (!systemData.empresas || !Array.isArray(systemData.empresas)) {
        systemData.empresas = [];
        return;
    }

    systemData.empresas = normalizeEmpresas(systemData.empresas);
    
    if (systemData.empresas.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: var(--spacing-xl, 30px);">
                    <div class="empty-state">
                        <i class="icon-company" style="font-size: 48px; opacity: 0.5; color: var(--color-gray-400, #94A3B8);"></i>
                        <h3 style="color: var(--color-gray-700, #334155); margin: var(--spacing-md, 16px) 0 var(--spacing-sm, 8px);">Nenhuma empresa cadastrada</h3>
                        <p style="color: var(--color-gray-500, #64748B); margin-bottom: var(--spacing-lg, 20px);">Clique no botão abaixo para adicionar sua primeira empresa.</p>
                        <button class="btn btn-success" onclick="addEmpresa()" style="padding: var(--spacing-sm, 8px) var(--spacing-lg, 20px); background: var(--success-gradient); color: var(--text-primary, white); border: none; border-radius: var(--border-radius, 4px); font-weight: 500; cursor: pointer; transition: opacity 0.2s ease;">
                            <i class="icon-add"></i> Adicionar Primeira Empresa
                        </button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    systemData.empresas.forEach((empresa, index) => {
        const empresaNormalizada = normalizeEmpresa(empresa);
        const sigla = empresaNormalizada?.codigo || '';
        const nome = empresaNormalizada?.nome || '';
        const numeroClienteAtual = getEmpresaNumeroClienteAtual(empresaNormalizada);
        const temCredenciais = empresaNormalizada?.credenciais && 
                              typeof empresaNormalizada.credenciais === 'object' && 
                              empresaNormalizada.credenciais !== null;
        const credenciais = temCredenciais ? empresaNormalizada.credenciais : null;
        
        // Verificar se token está expirado
        const tokenExpirado = credenciais?.data_expiracao ? 
            new Date(credenciais.data_expiracao) < new Date() : false;
        
        const row = document.createElement('tr');
        row.style.cssText = `
            border-bottom: 1px solid var(--color-gray-200, #E2E8F0);
            transition: background 0.2s ease;
        `;
        row.addEventListener('mouseover', () => {
            row.style.background = 'var(--color-gray-50, #F8FAFC)';
        });
        row.addEventListener('mouseout', () => {
            row.style.background = 'transparent';
        });
        
        row.innerHTML = `
            <td style="padding: var(--spacing-sm, 8px);">
                <input type="text" value="${escapeHtml(sigla)}"
                       onchange="updateEmpresaSigla(${index}, this.value)"
                       placeholder="Sigla"
                       class="form-input" maxlength="10"
                       style="width: 100%; padding: var(--spacing-xs, 6px) var(--spacing-sm, 10px); border: 1px solid var(--color-gray-300, #CBD5E0); border-radius: var(--border-radius, 4px); font-size: 0.95rem; transition: border-color 0.2s ease;"
                       onfocus="this.style.borderColor='var(--color-primary, #4A5568)'"
                       onblur="this.style.borderColor='var(--color-gray-300, #CBD5E0)'">
            </td>
            <td style="padding: var(--spacing-sm, 8px);">
                <input type="text" value="${escapeHtml(nome)}"
                       onchange="updateEmpresaNome(${index}, this.value)"
                       placeholder="Nome completo da empresa"
                       class="form-input"
                       style="width: 100%; padding: var(--spacing-xs, 6px) var(--spacing-sm, 10px); border: 1px solid var(--color-gray-300, #CBD5E0); border-radius: var(--border-radius, 4px); font-size: 0.95rem; transition: border-color 0.2s ease;"
                       onfocus="this.style.borderColor='var(--color-primary, #4A5568)'"
                       onblur="this.style.borderColor='var(--color-gray-300, #CBD5E0)'">
            </td>
            <td style="padding: var(--spacing-sm, 8px); text-align: center;">
                <input type="number" value="${numeroClienteAtual}"
                       min="0"
                       onchange="updateEmpresaNumeroClienteAtual(${index}, this.value)"
                       title="Último número de obra da empresa"
                       class="form-input"
                       style="width: 90px; padding: var(--spacing-xs, 6px) var(--spacing-sm, 10px); border: 1px solid var(--color-gray-300, #CBD5E0); border-radius: var(--border-radius, 4px); font-size: 0.95rem; background: var(--color-gray-50, #F8FAFC); color: var(--color-gray-700, #334155); text-align: center;">
            </td>
            <td class="credentials-cell" style="padding: var(--spacing-sm, 8px);">
                ${temCredenciais ? `
                    <div class="credentials-info" style="display: flex; align-items: center; gap: var(--spacing-sm, 10px); justify-content: center; flex-wrap: wrap;">
                        <span class="badge ${tokenExpirado ? 'badge-danger' : 'badge-success'}" style="
                            background: ${tokenExpirado ? 'var(--danger-gradient, #C53030)' : 'var(--success-gradient, #2D774E)'};
                            color: var(--text-primary, white);
                            padding: 4px var(--spacing-xs, 8px);
                            border-radius: var(--border-radius, 4px);
                            font-size: 12px;
                            white-space: nowrap;
                            font-weight: 500;
                        ">
                            <i class="icon-${tokenExpirado ? 'warning' : 'check'}"></i> 
                            ${tokenExpirado ? 'Expirado' : 'Ativo'}
                        </span>
                        <small style="color: var(--color-gray-500, #666);" title="Expira em: ${credenciais?.data_expiracao ? formatarData(credenciais.data_expiracao) : ''}">
                            ${escapeHtml(credenciais?.usuario || '')} | ${credenciais?.tempoUso || 30}d
                        </small>
                        <small style="color: var(--color-gray-500, #666);">
                            ${escapeHtml(credenciais?.email || credenciais?.recoveryEmail || 'Sem email cadastrado')}
                        </small>
                        <div style="display: flex; gap: var(--spacing-xs, 5px);">
                            <button class="btn btn-small btn-info" 
                                    onclick="showCredentialsModal(${index})"
                                    title="Editar credenciais"
                                    style="padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px); background: var(--info-gradient, linear-gradient(135deg, #3182CE 0%, #63B3ED 100%)); color: var(--text-primary, white); border: none; border-radius: var(--border-radius, 4px); cursor: pointer; transition: opacity 0.2s ease;"
                                    onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                                <i class="icon-edit"></i>
                            </button>
                            <button class="btn btn-small btn-warning" 
                                    onclick="removeCredentials(${index}, '${sigla}')"
                                    title="Remover credenciais"
                                    style="padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px); background: var(--warning-gradient, linear-gradient(135deg, #139090 0%)); color: var(--text-primary, white); border: none; border-radius: var(--border-radius, 4px); cursor: pointer; transition: opacity 0.2s ease;"
                                    onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                                <i class="icon-delete"></i>
                            </button>
                        </div>
                    </div>
                ` : `
                    <button class="btn btn-small btn-success" 
                            onclick="showCredentialsModal(${index})"
                            title="Criar credenciais"
                            style="padding: var(--spacing-xs, 4px) var(--spacing-sm, 10px); background: var(--success-gradient); color: var(--text-primary, white); border: none; border-radius: var(--border-radius, 4px); cursor: pointer; font-size: 0.9rem; transition: opacity 0.2s ease;"
                            onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                        <i class="icon-add"></i> Criar Login
                    </button>
                `}
            </td>
            <td class="actions-cell" style="padding: var(--spacing-sm, 8px); text-align: center;">
                <button class="btn btn-small btn-danger"
                        onclick="deleteEmpresa(${index}, '${sigla}')"
                        title="Excluir empresa"
                        style="padding: var(--spacing-xs, 4px) var(--spacing-sm, 10px); background: var(--danger-gradient); color: var(--text-primary, white); border: none; border-radius: var(--border-radius, 4px); cursor: pointer; transition: opacity 0.2s ease;"
                        onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                    <i class="icon-delete"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    const emptyRow = document.createElement('tr');
    emptyRow.innerHTML = `
        <td colspan="5" style="text-align: center; padding: var(--spacing-lg, 20px); background: var(--color-gray-50, #F8FAFC);">
            <button class="btn btn-success" onclick="addEmpresa()" style="padding: var(--spacing-sm, 8px) var(--spacing-lg, 20px); background: var(--success-gradient); color: var(--text-primary, white); border: none; border-radius: var(--border-radius, 4px); font-weight: 500; cursor: pointer; transition: opacity 0.2s ease;">
                <i class="icon-add"></i> Adicionar Nova Empresa
            </button>
        </td>
    `;
    tbody.appendChild(emptyRow);
}

export function addEmpresa() {
    const newSigla = `NOV${Date.now().toString().slice(-3)}`;
    systemData.empresas.push({ 
        codigo: newSigla, 
        nome: `Nova Empresa ${newSigla}`, 
        numeroClienteAtual: 0,
        credenciais: null 
    });
    loadEmpresas();
    addPendingChange('empresas');
    showInfo('Nova empresa adicionada. Edite os detalhes.');
    
    setTimeout(() => {
        const lastRow = document.querySelector('#empresasTableBody tr:nth-last-child(2)');
        if (lastRow) {
            lastRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const input = lastRow.querySelector('input[type="text"]');
            if (input) input.focus();
        }
    }, 100);
}

export function updateEmpresaSigla(index, newSigla) {
    try {
        if (!systemData.empresas || !systemData.empresas[index]) {
            showError('Empresa não encontrada');
            return;
        }
        
        const empresa = normalizeEmpresa(systemData.empresas[index]);
        const oldSigla = empresa?.codigo;
        
        if (newSigla && newSigla.trim() !== '' && newSigla !== oldSigla) {
            const siglaExists = systemData.empresas.some((emp, idx) => {
                if (idx === index) return false;
                const empSigla = normalizeEmpresa(emp)?.codigo;
                return empSigla === newSigla;
            });
            
            if (siglaExists) {
                showError(`A sigla "${newSigla}" já existe!`);
                return;
            }
            
            systemData.empresas[index] = {
                ...empresa,
                codigo: newSigla
            };
            loadEmpresas();
            addPendingChange('empresas');
            showInfo(`Sigla alterada: "${oldSigla}" → "${newSigla}"`);
        }
    } catch (error) {
        console.error('Erro ao atualizar sigla:', error);
        showError('Erro ao atualizar sigla');
    }
}

export function updateEmpresaNome(index, newNome) {
    try {
        if (!systemData.empresas || !systemData.empresas[index]) {
            showError('Empresa não encontrada');
            return;
        }
        
        const empresa = normalizeEmpresa(systemData.empresas[index]);
        
        if (newNome && newNome.trim() !== '' && newNome !== empresa?.nome) {
            systemData.empresas[index] = {
                ...empresa,
                nome: newNome
            };
            addPendingChange('empresas');
        }
    } catch (error) {
        console.error('Erro ao atualizar nome:', error);
        showError('Erro ao atualizar nome');
    }
}

export function updateEmpresaNumeroClienteAtual(index, newNumeroClienteAtual) {
    try {
        if (!systemData.empresas || !systemData.empresas[index]) {
            showError('Empresa não encontrada');
            return;
        }

        const empresa = normalizeEmpresa(systemData.empresas[index]);
        const numeroClienteAtual = Math.max(parseInt(newNumeroClienteAtual, 10) || 0, 0);

        if (numeroClienteAtual === getEmpresaNumeroClienteAtual(empresa)) {
            return;
        }

        systemData.empresas[index] = {
            ...empresa,
            numeroClienteAtual
        };
        addPendingChange('empresas');
        showInfo(`Nº Cliente atualizado para ${numeroClienteAtual}.`);
    } catch (error) {
        console.error('Erro ao atualizar número do cliente:', error);
        showError('Erro ao atualizar número do cliente');
    }
}

export async function deleteEmpresa(index, sigla) {
    try {
        if (!systemData.empresas || !systemData.empresas[index]) {
            showError('Empresa não encontrada');
            return;
        }
        
        const empresa = normalizeEmpresa(systemData.empresas[index]);
        const nome = empresa?.nome || '';
        
        showConfirmation(`Deseja excluir a empresa "${sigla} - ${nome}"?`, async () => {
            try {
                // Remover localmente
                systemData.empresas.splice(index, 1);
                loadEmpresas();
                
                // Sinalizar que houve mudança para o sistema geral de salvamento
                addPendingChange('empresas');
                
                showWarning(`Empresa "${sigla}" excluída.`);
                
            } catch (error) {
                console.error('Erro ao excluir empresa:', error);
                showError(`Erro ao excluir empresa: ${error.message}`);
            }
        });
    } catch (error) {
        console.error('Erro ao processar exclusão:', error);
        showError('Erro ao processar exclusão da empresa');
    }
}

// Exportar funções globalmente
window.loadEmpresas = loadEmpresas;
window.addEmpresa = addEmpresa;
window.updateEmpresaSigla = updateEmpresaSigla;
window.updateEmpresaNome = updateEmpresaNome;
window.updateEmpresaNumeroClienteAtual = updateEmpresaNumeroClienteAtual;
window.deleteEmpresa = deleteEmpresa;
window.showCredentialsModal = showCredentialsModal;
window.removeCredentials = removeCredentials;
window.generateToken = generateToken;
