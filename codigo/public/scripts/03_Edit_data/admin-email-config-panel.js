(function () {
    const state = {
        loaded: false,
        loading: false,
        saving: false,
        error: '',
        config: {
            email: '',
            nome: 'ESI Energia'
        },
        configured: false,
        deliveryMode: 'unconfigured',
        resendConfigured: false,
        request: null
    };

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
    }

    function escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value ?? '';
        return div.innerHTML;
    }

    function notify(kind, message) {
        const text = String(message || '').trim();
        if (!text) {
            return;
        }

        const map = {
            success: window.showSuccess,
            error: window.showError,
            info: window.showInfo
        };

        const handler = map[kind];
        if (typeof handler === 'function') {
            handler(text);
            return;
        }

        console[kind === 'error' ? 'error' : 'log'](text);
    }

    function getAdminRecords() {
        const admins = window.systemData?.ADM;
        if (Array.isArray(admins)) {
            return admins.filter((admin) => admin && typeof admin === 'object');
        }
        if (admins && typeof admins === 'object') {
            return [admins];
        }
        return [];
    }

    function getPrimaryAdminEmail() {
        const admin = getAdminRecords().find((item) => isValidEmail(item?.email));
        return String(admin?.email || '').trim();
    }

    function normalizeResponse(payload) {
        const config = payload?.config && typeof payload.config === 'object' ? payload.config : {};
        state.loaded = true;
        state.loading = false;
        state.error = '';
        state.configured = Boolean(payload?.configured);
        state.deliveryMode = String(payload?.deliveryMode || 'unconfigured').trim() || 'unconfigured';
        state.resendConfigured = Boolean(payload?.resendConfigured);
        state.config = {
            email: String(config.email || '').trim(),
            nome: String(config.nome || 'ESI Energia').trim() || 'ESI Energia'
        };
    }

    function getModeLabel() {
        if (!state.loaded || state.loading) {
            return 'Carregando';
        }
        if (state.deliveryMode === 'resend') {
            return 'Resend ativo';
        }
        return 'Nao configurado';
    }

    function getModeTone() {
        if (!state.loaded || state.loading) {
            return 'muted';
        }
        return state.configured ? 'success' : 'warning';
    }

    function getStatusText() {
        if (state.error) {
            return state.error;
        }
        if (!state.loaded || state.loading) {
            return 'Carregando configuracao atual do email de envio...';
        }
        if (state.configured && state.deliveryMode === 'resend') {
            return 'Com RESEND_API no .env, este email sera usado como remetente das exportacoes.';
        }
        return 'Preencha o email remetente e mantenha RESEND_API configurado no .env.';
    }

    function getContainer() {
        return document.getElementById('adminCredentialsContent');
    }

    function renderPanel() {
        const container = getContainer();
        if (!container) {
            return;
        }

        container.querySelector('.admin-email-config-panel-bridge')?.remove();

        const suggestionEmail = getPrimaryAdminEmail();
        const disabled = state.saving ? 'disabled' : '';
        const useAdminDisabled = !suggestionEmail || state.saving ? 'disabled' : '';

        const html = `
            <section class="admin-email-config-panel admin-email-config-panel-bridge">
                <div class="admin-email-config-header">
                    <div class="admin-section-copy">
                        <span class="dashboard-eyebrow">Envio</span>
                        <h3>Email de envio</h3>
                        <p>Esse remetente sera usado nas exportacoes por email e na recuperacao de senha.</p>
                    </div>
                    <div class="admin-email-config-badge tone-${escapeHtml(getModeTone())}">
                        ${escapeHtml(getModeLabel())}
                    </div>
                </div>

                <div class="admin-email-config-grid">
                    <label class="admin-email-field">
                        <span>Email remetente</span>
                        <input id="adminSenderEmailInput" type="email" value="${escapeHtml(state.config.email)}" placeholder="matheus@esi.energia.com" ${disabled}>
                    </label>

                    <label class="admin-email-field">
                        <span>Nome do remetente</span>
                        <input id="adminSenderNameInput" type="text" value="${escapeHtml(state.config.nome)}" placeholder="ESI Energia" ${disabled}>
                    </label>

                </div>

                <div class="admin-email-config-actions">
                    <button class="btn-icon" id="adminUsePrimaryEmailBtn" type="button" ${useAdminDisabled}>Usar email do ADM</button>
                    <button class="btn-add-admin" id="adminSaveEmailConfigBtn" type="button" ${disabled}>
                        ${state.saving ? 'Salvando...' : 'Salvar email de envio'}
                    </button>
                </div>

                <div class="admin-email-config-status">${escapeHtml(getStatusText())}</div>
            </section>
        `;

        container.insertAdjacentHTML('afterbegin', html);
        bindPanelEvents();
    }

    function bindPanelEvents() {
        const saveButton = document.getElementById('adminSaveEmailConfigBtn');
        const useAdminButton = document.getElementById('adminUsePrimaryEmailBtn');

        if (saveButton) {
            saveButton.onclick = saveConfig;
        }

        if (useAdminButton) {
            useAdminButton.onclick = () => {
                const emailInput = document.getElementById('adminSenderEmailInput');
                if (!emailInput) {
                    return;
                }

                const adminEmail = getPrimaryAdminEmail();
                if (!adminEmail) {
                    notify('info', 'Nenhum email de ADM disponivel para reaproveitar.');
                    return;
                }

                emailInput.value = adminEmail;
            };
        }
    }

    async function loadConfig(force) {
        if (force) {
            state.request = null;
            state.loading = false;
        }

        if (state.request) {
            return state.request;
        }

        state.loading = true;
        state.error = '';
        renderPanel();

        state.request = fetch('/api/admin/email-config', {
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
                normalizeResponse(result);
            })
            .catch((error) => {
                state.loaded = true;
                state.loading = false;
                state.error = error.message || 'Falha ao carregar o email de envio.';
            })
            .finally(() => {
                state.request = null;
                renderPanel();
            });

        return state.request;
    }

    async function saveConfig() {
        const email = String(document.getElementById('adminSenderEmailInput')?.value || '').trim();
        const nome = String(document.getElementById('adminSenderNameInput')?.value || '').trim() || 'ESI Energia';
        if (!isValidEmail(email)) {
            notify('error', 'Informe um email valido para o envio.');
            return;
        }

        state.saving = true;
        state.error = '';
        renderPanel();

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

            normalizeResponse(result);
            notify('success', 'Email de envio salvo com sucesso.');
        } catch (error) {
            state.error = error.message || 'Falha ao salvar o email de envio.';
            notify('error', state.error);
        } finally {
            state.saving = false;
            renderPanel();
        }
    }

    function ensurePanel() {
        if (!state.loaded && !state.loading) {
            loadConfig(false);
            return;
        }

        renderPanel();
    }

    function boot() {
        ensurePanel();

        window.addEventListener('dataLoaded', ensurePanel);
        window.addEventListener('dataImported', ensurePanel);
        window.addEventListener('dataApplied', ensurePanel);

        document.addEventListener('click', (event) => {
            const clickedTab = event.target.closest('.tab');
            if (!clickedTab) {
                return;
            }

            const onclick = String(clickedTab.getAttribute('onclick') || '');
            if (!onclick.includes('adminCredentials')) {
                return;
            }

            window.setTimeout(ensurePanel, 180);
        });

        const container = getContainer();
        if (!container) {
            return;
        }

        const observer = new MutationObserver(() => {
            if (!container.querySelector('.admin-email-config-panel-bridge')) {
                ensurePanel();
            }
        });

        observer.observe(container, {
            childList: true
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
