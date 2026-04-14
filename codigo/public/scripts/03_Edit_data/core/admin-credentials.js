import { systemData, addPendingChange } from '../config/state.js';
import { showConfirmation, showError, showSuccess, showInfo } from '../config/ui.js';

const adminState = {
    search: '',
    initialized: false,
    modalListenerBound: false,
    emailConfig: null,
    emailConfigLoaded: false,
    emailConfigLoading: false,
    emailConfigSaving: false,
    emailConfigPromise: null
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(date) {
    if (!date) return 'Sem registro';

    const rawDate = String(date).trim();
    const normalizedDate =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(rawDate)
            ? `${rawDate}Z`
            : rawDate;

    const parsedDate = new Date(normalizedDate);
    if (Number.isNaN(parsedDate.getTime())) return 'Sem registro';

    return parsedDate.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo'
    });
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function generateToken() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let token = '';

    for (let index = 0; index < 12; index += 1) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return token;
}

function maskToken(token) {
    if (!token || token.length < 6) return '******';
    return `${token.slice(0, 3)}****${token.slice(-3)}`;
}

function normalizeAdmin(admin, index = 0) {
    const usuario = String(admin?.usuario || '').trim() || `ADM${index + 1}`;
    const token = String(admin?.token || '').trim() || generateToken();
    const email = String(admin?.email || '').trim();

    return {
        id: String(admin?.id || `adm_${index}_${usuario.toLowerCase()}`),
        usuario,
        token,
        email,
        criadoEm: admin?.criadoEm || admin?.createdAt || null,
        ultimoAcesso: admin?.ultimoAcesso || admin?.lastLogin || null
    };
}

function getAdmins() {
    if (Array.isArray(systemData.ADM)) {
        return systemData.ADM
            .filter((admin) => admin && typeof admin === 'object')
            .map((admin, index) => normalizeAdmin(admin, index));
    }

    if (systemData.ADM && typeof systemData.ADM === 'object') {
        return [normalizeAdmin(systemData.ADM, 0)];
    }

    return [];
}

function getPrimaryAdminEmailSuggestion() {
    const admins = getAdmins();
    const matchedAdmin = admins.find((admin) => isValidEmail(admin.email));
    return String(matchedAdmin?.email || '').trim();
}

function normalizeEmailConfigPayload(payload = {}) {
    const config = payload?.config && typeof payload.config === 'object' ? payload.config : {};
    const email = String(config.email || '').trim();
    const nome = String(config.nome || 'ESI Energia').trim() || 'ESI Energia';
    const deliveryMode = String(payload?.deliveryMode || 'unconfigured').trim() || 'unconfigured';

    return {
        configured: Boolean(payload?.configured),
        resendConfigured: Boolean(payload?.resendConfigured),
        deliveryMode,
        config: {
            email,
            nome
        }
    };
}

async function loadAdminEmailConfig({ force = false, rerender = true } = {}) {
    if (force) {
        adminState.emailConfigPromise = null;
        adminState.emailConfigLoading = false;
    }

    if (adminState.emailConfigPromise) {
        return adminState.emailConfigPromise;
    }

    adminState.emailConfigLoading = true;
    if (rerender) {
        renderAdminCredentials();
    }

    adminState.emailConfigPromise = fetch('/api/admin/email-config', {
        cache: 'no-store',
        headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache'
        }
    })
        .then(async (response) => {
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Nao foi possivel carregar o email de envio.');
            }

            adminState.emailConfig = normalizeEmailConfigPayload(result);
            adminState.emailConfigLoaded = true;
            return adminState.emailConfig;
        })
        .catch((error) => {
            adminState.emailConfig = normalizeEmailConfigPayload({});
            adminState.emailConfigLoaded = true;
            throw error;
        })
        .finally(() => {
            adminState.emailConfigLoading = false;
            adminState.emailConfigPromise = null;
            if (rerender) {
                renderAdminCredentials();
            }
        });

    return adminState.emailConfigPromise;
}

function renderAdminEmailConfigPanel() {
    const emailConfig = adminState.emailConfig || normalizeEmailConfigPayload({});
    const senderEmail = escapeHtml(emailConfig.config.email || '');
    const senderName = escapeHtml(emailConfig.config.nome || 'ESI Energia');
    const suggestionEmail = getPrimaryAdminEmailSuggestion();
    const saveDisabled = adminState.emailConfigSaving ? 'disabled' : '';
    const useSuggestionDisabled = !suggestionEmail || adminState.emailConfigSaving ? 'disabled' : '';

    return `
        <section class="admin-email-config-panel">
            <div class="admin-email-config-header">
                <div class="admin-section-copy">
                    <span class="dashboard-eyebrow">Envio</span>
                    <h3>Email de envio</h3>
                    <p>Esse remetente sera usado nas exportacoes por email e na recuperacao de senha.</p>
                </div>
            </div>

            <div class="admin-email-config-grid">
                <label class="admin-email-field">
                    <span>Email remetente</span>
                    <input id="adminSenderEmailInput" type="email" value="${senderEmail}" placeholder="matheus@esi.energia.com" ${saveDisabled}>
                </label>

                <label class="admin-email-field">
                    <span>Nome do remetente</span>
                    <input id="adminSenderNameInput" type="text" value="${senderName}" placeholder="ESI Energia" ${saveDisabled}>
                </label>
            </div>

            <div class="admin-email-config-actions">
                <button class="btn-icon" id="adminUsePrimaryEmailBtn" type="button" ${useSuggestionDisabled}>Usar email do ADM</button>
                <button class="btn-add-admin" id="adminSaveEmailConfigBtn" type="button" ${saveDisabled}>
                    ${adminState.emailConfigSaving ? 'Salvando...' : 'Salvar email de envio'}
                </button>
            </div>
        </section>
    `;
}

async function saveAdminEmailConfigFromPanel() {
    const emailInput = document.getElementById('adminSenderEmailInput');
    const nomeInput = document.getElementById('adminSenderNameInput');
    const email = String(emailInput?.value || '').trim();
    const nome = String(nomeInput?.value || '').trim() || 'ESI Energia';

    if (!email || !isValidEmail(email)) {
        showError('Informe um email valido para o envio.');
        return;
    }

    adminState.emailConfigSaving = true;
    renderAdminCredentials();

    try {
        const response = await fetch('/api/admin/email-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                nome
            })
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Nao foi possivel salvar o email de envio.');
        }

        adminState.emailConfig = normalizeEmailConfigPayload(result);
        adminState.emailConfigLoaded = true;
        showSuccess('Email de envio salvo com sucesso.');
    } catch (error) {
        showError(error.message || 'Falha ao salvar o email de envio.');
    } finally {
        adminState.emailConfigSaving = false;
        renderAdminCredentials();
    }
}

function saveAdmins(admins) {
    systemData.ADM = admins.map((admin) => {
        const savedAdmin = {
            usuario: admin.usuario,
            token: admin.token
        };

        if (admin.email) {
            savedAdmin.email = admin.email;
        }

        if (admin.criadoEm) {
            savedAdmin.criadoEm = admin.criadoEm;
        }

        if (admin.ultimoAcesso) {
            savedAdmin.ultimoAcesso = admin.ultimoAcesso;
        }

        return savedAdmin;
    });

    addPendingChange('ADM');
}

function updateAdminModalStatus(message, tone = 'muted') {
    const statusElement = document.getElementById('adminCredentialStatus');
    if (!statusElement) {
        return;
    }

    const palette = {
        muted: '#64748b',
        success: '#2f855a',
        warning: '#c05621',
        error: '#c53030'
    };

    statusElement.textContent = message || 'Pré-salvamento automático ao sair do campo.';
    statusElement.style.color = palette[tone] || palette.muted;
}

function persistAdminModalDraft({ quiet = true, closeOnSuccess = false } = {}) {
    const id = document.getElementById('adminRecordId')?.value;
    const usuario = document.getElementById('adminUsernameInput')?.value.trim();
    const token = document.getElementById('adminTokenInput')?.value.trim();
    const email = document.getElementById('adminEmailInput')?.value.trim() || '';

    if (!id) {
        updateAdminModalStatus('Registro inválido.', 'error');
        return false;
    }

    if (email && !isValidEmail(email)) {
        if (!quiet) {
            showError('Informe um email válido para recuperação do ADM.');
        }
        updateAdminModalStatus('Rascunho retido. Corrija o email para aplicar.', 'warning');
        return false;
    }

    if (!usuario || !token) {
        updateAdminModalStatus('Rascunho retido. Usuário e senha são obrigatórios.', 'warning');
        return false;
    }

    const admins = getAdmins();
    const duplicateAdmin = admins.find(
        (admin) => admin.usuario.toLowerCase() === usuario.toLowerCase() && admin.id !== id
    );

    if (duplicateAdmin) {
        if (!quiet) {
            showError('Ja existe um ADM com este usuario.');
        }
        updateAdminModalStatus('Usuário já existe. Ajuste para aplicar.', 'warning');
        return false;
    }

    const existingAdmin = admins.find((admin) => admin.id === id);
    let nextAdmins;

    if (existingAdmin) {
        nextAdmins = admins.map((admin) => (
            admin.id === id
                ? {
                    ...admin,
                    usuario,
                    token,
                    email
                }
                : admin
        ));
    } else {
        nextAdmins = [
            ...admins,
            {
                id,
                usuario,
                token,
                email,
                criadoEm: new Date().toISOString()
            }
        ];
    }

    saveAdmins(nextAdmins);
    renderAdminCredentials();
    updateAdminModalStatus('Pré-salvo automaticamente.', 'success');

    if (closeOnSuccess) {
        showSuccess('Credencial ADM salva em pré-salvamento.');
    }

    return true;
}

function filterAdmins(admins) {
    const search = adminState.search.trim().toLowerCase();

    if (!search) {
        return admins;
    }

    return admins.filter((admin) => admin.usuario.toLowerCase().includes(search));
}

function renderAdminCard(admin, index) {
    return `
        <article class="admin-card" data-admin-id="${escapeHtml(admin.id)}">
            <div class="admin-card-header">
                <div class="admin-card-info">
                    <span class="admin-index-badge">ADM ${index + 1}</span>
                    <strong>@${escapeHtml(admin.usuario)}</strong>
                </div>
            </div>

            <div class="admin-card-body">
                <div class="admin-card-detail">
                    <span class="detail-label">Usuário</span>
                    <span class="detail-value">@${escapeHtml(admin.usuario)}</span>
                </div>
                <div class="admin-card-detail">
                    <span class="detail-label">Email de recuperação</span>
                    <span class="detail-value">${escapeHtml(admin.email || 'Não cadastrado')}</span>
                </div>
                <div class="admin-card-detail">
                    <span class="detail-label">Senha atual</span>
                    <span class="detail-value admin-token-value">${escapeHtml(admin.token)}</span>
                </div>
                <div class="admin-card-detail">
                    <span class="detail-label">Criado em</span>
                    <span class="detail-value">${escapeHtml(formatDate(admin.criadoEm))}</span>
                </div>
                <div class="admin-card-detail">
                    <span class="detail-label">Último acesso</span>
                    <span class="detail-value">${escapeHtml(formatDate(admin.ultimoAcesso))}</span>
                </div>
            </div>

            <div class="admin-card-footer">
                <button class="btn-icon edit-admin" type="button" title="Editar administrador">Editar</button>
                <button class="btn-icon reset-password" type="button" title="Gerar nova senha">Nova senha</button>
                <button class="btn-icon delete-admin" type="button" title="Remover administrador">Remover</button>
            </div>
        </article>
    `;
}

export function renderAdminCredentials() {
    const container = document.getElementById('adminCredentialsContent');
    if (!container) return;

    const admins = getAdmins();
    const filteredAdmins = filterAdmins(admins);

    container.innerHTML = `
        ${renderAdminEmailConfigPanel()}

        <div class="admin-section-header admin-section-header-panel">
            <div class="admin-section-copy">
                <span class="dashboard-eyebrow">ADM</span>
                <h3>Credenciais administrativas</h3>
            </div>
            <button class="btn-add-admin" id="btnAddAdmin" type="button">
                <span>+</span> Novo ADM
            </button>
        </div>

        <div class="admin-grid">
            ${filteredAdmins.length > 0
                ? filteredAdmins.map((admin, index) => renderAdminCard(admin, index)).join('')
                : '<div class="empty-state">Nenhum ADM encontrado.</div>'}
        </div>
    `;

    bindAdminEvents();
}

function openAdminModal(admin = null) {
    const modal = document.getElementById('adminCredentialModal');
    const title = document.getElementById('adminCredentialModalTitle');
    const idInput = document.getElementById('adminRecordId');
    const usuarioInput = document.getElementById('adminUsernameInput');
    const tokenInput = document.getElementById('adminTokenInput');
    const emailInput = document.getElementById('adminEmailInput');

    if (!modal || !title || !idInput || !usuarioInput || !tokenInput || !emailInput) {
        return;
    }

    if (admin) {
        title.textContent = 'Editar ADM';
        idInput.value = admin.id;
        usuarioInput.value = admin.usuario;
        tokenInput.value = admin.token;
        emailInput.value = admin.email || '';
    } else {
        title.textContent = 'Novo ADM';
        idInput.value = `new_${Date.now()}`;
        usuarioInput.value = '';
        tokenInput.value = generateToken();
        emailInput.value = '';
    }

    modal.style.display = 'flex';
    updateAdminModalStatus();
}

function closeAdminModal() {
    persistAdminModalDraft({ quiet: true });
    const modal = document.getElementById('adminCredentialModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function saveAdminFromForm(event) {
    event.preventDefault();

    const id = document.getElementById('adminRecordId')?.value;
    const usuario = document.getElementById('adminUsernameInput')?.value.trim();
    const token = document.getElementById('adminTokenInput')?.value.trim();
    const email = document.getElementById('adminEmailInput')?.value.trim() || '';

    if (!id || !usuario || !token) {
        showError('Preencha usuario e senha do ADM.');
        return;
    }

    if (email && !isValidEmail(email)) {
        showError('Informe um email válido para recuperação do ADM.');
        return;
    }

    const admins = getAdmins();
    const duplicateAdmin = admins.find(
        (admin) => admin.usuario.toLowerCase() === usuario.toLowerCase() && admin.id !== id
    );

    if (duplicateAdmin) {
        showError('Ja existe um ADM com este usuario.');
        return;
    }

    const existingAdmin = admins.find((admin) => admin.id === id);
    let nextAdmins;

    if (existingAdmin) {
        nextAdmins = admins.map((admin) => (
            admin.id === id
                ? {
                    ...admin,
                    usuario,
                    token,
                    email
                }
                : admin
        ));
    } else {
        nextAdmins = [
            ...admins,
            {
                id,
                usuario,
                token,
                email,
                criadoEm: new Date().toISOString()
            }
        ];
    }

    saveAdmins(nextAdmins);
    closeAdminModal();
    renderAdminCredentials();
    showSuccess('Credencial ADM salva com sucesso.');
}

function saveAdminFromFormLegacy(event) {
    event.preventDefault();

    if (persistAdminModalDraft({ quiet: false, closeOnSuccess: true })) {
        closeAdminModal();
    }
}

function handleAdminAction(event) {
    const card = event.target.closest('[data-admin-id]');
    if (!card) return;

    const adminId = card.dataset.adminId;
    const admins = getAdmins();
    const admin = admins.find((item) => item.id === adminId);

    if (!admin) return;

    if (event.target.closest('.edit-admin')) {
        openAdminModal(admin);
        return;
    }

    if (event.target.closest('.reset-password')) {
        showConfirmation(`Gerar nova senha para @${admin.usuario}?`, () => {
            const newToken = generateToken();
            const nextAdmins = admins.map((item) => (
                item.id === adminId
                    ? { ...item, token: newToken }
                    : item
            ));

            saveAdmins(nextAdmins);
            renderAdminCredentials();
            showInfo(`Nova senha de @${admin.usuario}: ${newToken}`);
        });
        return;
    }

    if (event.target.closest('.delete-admin')) {
        if (admins.length <= 1) {
            showError('O sistema precisa manter pelo menos um ADM.');
            return;
        }

        showConfirmation(`Remover @${admin.usuario} da lista de ADM?`, () => {
            const nextAdmins = admins.filter((item) => item.id !== adminId);
            saveAdmins(nextAdmins);
            renderAdminCredentials();
            showSuccess('ADM removido com sucesso.');
        });
    }
}

function bindAdminEvents() {
    const addBtn = document.getElementById('btnAddAdmin');
    const adminGrid = document.querySelector('.admin-grid');
    const modalForm = document.getElementById('adminCredentialForm');
    const closeModalBtn = document.getElementById('closeAdminModalBtn');
    const cancelBtn = document.getElementById('cancelAdminCredentialBtn');
    const generateBtn = document.getElementById('generateAdminTokenBtn');
    const saveEmailConfigBtn = document.getElementById('adminSaveEmailConfigBtn');
    const usePrimaryEmailBtn = document.getElementById('adminUsePrimaryEmailBtn');

    if (addBtn) {
        addBtn.onclick = () => openAdminModal();
    }

    if (saveEmailConfigBtn) {
        saveEmailConfigBtn.onclick = saveAdminEmailConfigFromPanel;
    }

    if (usePrimaryEmailBtn) {
        usePrimaryEmailBtn.onclick = () => {
            const emailInput = document.getElementById('adminSenderEmailInput');
            if (!emailInput) {
                return;
            }

            const suggestionEmail = getPrimaryAdminEmailSuggestion();
            if (!suggestionEmail) {
                showInfo('Nenhum email de ADM disponivel para reaproveitar.');
                return;
            }

            emailInput.value = suggestionEmail;
        };
    }

    if (adminGrid) {
        adminGrid.onclick = handleAdminAction;
    }

    if (modalForm) {
        modalForm.onsubmit = saveAdminFromForm;
        if (!modalForm.dataset.autosaveBound) {
            modalForm.addEventListener('focusout', (event) => {
                if (event.target instanceof HTMLInputElement) {
                    persistAdminModalDraft({ quiet: true });
                }
            });
            modalForm.addEventListener('change', () => {
                persistAdminModalDraft({ quiet: true });
            });
            modalForm.dataset.autosaveBound = 'true';
        }
    }

    if (closeModalBtn) {
        closeModalBtn.onclick = closeAdminModal;
    }

    if (cancelBtn) {
        cancelBtn.onclick = closeAdminModal;
    }

    if (generateBtn) {
        generateBtn.onclick = () => {
            const tokenInput = document.getElementById('adminTokenInput');
            if (tokenInput) {
                tokenInput.value = generateToken();
                persistAdminModalDraft({ quiet: true });
            }
        };
    }

    if (!adminState.modalListenerBound) {
        window.addEventListener('click', (event) => {
            const modal = document.getElementById('adminCredentialModal');
            if (event.target === modal) {
                closeAdminModal();
            }
        });

        adminState.modalListenerBound = true;
    }
}

export function initializeAdminCredentials() {
    renderAdminCredentials();

    if (!adminState.emailConfigLoaded && !adminState.emailConfigLoading) {
        loadAdminEmailConfig().catch((error) => {
            showError(error.message || 'Falha ao carregar o email de envio.');
        });
    }

    if (adminState.initialized) {
        return;
    }

    window.addEventListener('dataLoaded', renderAdminCredentials);
    window.addEventListener('dataImported', renderAdminCredentials);
    window.addEventListener('dataApplied', renderAdminCredentials);

    adminState.initialized = true;
}
