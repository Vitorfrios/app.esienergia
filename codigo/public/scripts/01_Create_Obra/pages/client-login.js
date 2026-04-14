import { APP_CONFIG } from '../core/config.js';
import { createSmartLogger } from '../core/logger.js';
import {
    clearClientSession,
    loginAdmin,
    loginClient,
    redirectToAdminApp,
    redirectToClientApp
} from '../core/auth.js';

const RECOVERY_ENDPOINT = '/api/auth/recover-token';

function setFeedback(message, type = 'info') {
    const feedback = document.getElementById('loginFeedback');
    if (!feedback) return;

    feedback.textContent = message;
    feedback.dataset.type = type;
    feedback.style.color = type === 'error' ? '#c62828' : '#0d5d24';
}

function setRecoveryFeedback(message, type = 'info') {
    const feedback = document.getElementById('recoverTokenFeedback');
    if (!feedback) return;

    feedback.textContent = message;
    feedback.dataset.type = type;
    feedback.style.color = type === 'error' ? '#c62828' : '#0d5d24';
}

function setLoadingState(isLoading) {
    const loginButton = document.getElementById('loginBtn');
    if (!loginButton) return;

    loginButton.disabled = isLoading;
    loginButton.classList.toggle('loading', isLoading);

    const buttonText = loginButton.querySelector('.btn-text');
    if (buttonText) {
        buttonText.textContent = isLoading ? 'Validando...' : 'Entrar';
    }
}

function bindPasswordToggle() {
    const toggleButton = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('password');

    if (!toggleButton || !passwordInput) {
        return;
    }

    toggleButton.addEventListener('click', () => {
        const showPassword = passwordInput.type === 'password';
        passwordInput.type = showPassword ? 'text' : 'password';

        const icon = toggleButton.querySelector('i');
        if (icon) {
            icon.className = showPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
        }
    });
}

function toggleRecoveryLoading(isLoading) {
    const sendButton = document.getElementById('sendRecoveryBtn');
    if (!sendButton) return;

    sendButton.disabled = isLoading;
    sendButton.classList.toggle('loading', isLoading);

    const buttonText = sendButton.querySelector('.btn-text');
    if (buttonText) {
        buttonText.textContent = isLoading ? 'Enviando...' : 'Enviar senha';
    }
}

function openRecoveryModal() {
    const modal = document.getElementById('recoverTokenModal');
    if (!modal) return;

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeRecoveryModal() {
    const modal = document.getElementById('recoverTokenModal');
    if (!modal) return;

    setRecoveryFeedback('');
    modal.classList.add('hidden');
    document.body.style.overflow = '';
}

function bindRecoveryModal() {
    const openButton = document.getElementById('openRecoveryModalBtn');
    const closeButton = document.getElementById('closeRecoveryModalBtn');
    const cancelButton = document.getElementById('cancelRecoveryBtn');
    const modal = document.getElementById('recoverTokenModal');
    const form = document.getElementById('recoverTokenForm');
    const usernameInput = document.getElementById('recoveryUsername');
    const emailInput = document.getElementById('recoveryEmail');

    openButton?.addEventListener('click', () => {
        setRecoveryFeedback('');
        if (usernameInput) {
            usernameInput.value = document.getElementById('username')?.value.trim() || '';
        }
        openRecoveryModal();
    });

    closeButton?.addEventListener('click', closeRecoveryModal);
    cancelButton?.addEventListener('click', closeRecoveryModal);

    modal?.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeRecoveryModal();
        }
    });

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setRecoveryFeedback('');
        toggleRecoveryLoading(true);

        try {
            const response = await fetch(RECOVERY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    usuario: usernameInput?.value || '',
                    email: emailInput?.value || ''
                })
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Nao foi possivel enviar a senha.');
            }

            setRecoveryFeedback(result.message || 'Senha enviada para o email cadastrado.', 'success');
            window.setTimeout(() => {
                closeRecoveryModal();
            }, 1200);
        } catch (error) {
            console.error('[CLIENT-LOGIN] Erro na recuperação:', error);
            setRecoveryFeedback(error.message || 'Nao foi possivel recuperar a senha.', 'error');
        } finally {
            toggleRecoveryLoading(false);
        }
    });
}

function bindLoginForm() {
    const loginForm = document.getElementById('loginForm');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');

    if (!loginForm || !usernameInput || !passwordInput) {
        return;
    }

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFeedback('');
        setLoadingState(true);

        try {
            const credentials = {
                usuario: usernameInput.value,
                token: passwordInput.value
            };
            const [adminResult, clientResult] = await Promise.all([
                loginAdmin(credentials),
                loginClient(credentials)
            ]);

            if (adminResult?.success) {
                redirectToAdminApp(adminResult.redirectTo);
                return;
            }

            if (!clientResult?.success) {
                setFeedback(clientResult?.message || 'Falha ao autenticar.', 'error');
                return;
            }

            redirectToClientApp();
        } catch (error) {
            console.error('[CLIENT-LOGIN] Erro no login:', error);
            setFeedback('Não foi possível validar o acesso.', 'error');
        } finally {
            setLoadingState(false);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (APP_CONFIG.mode !== 'client') {
        return;
    }

    if (!window.logger) {
        Object.defineProperty(window, 'logger', {
            value: createSmartLogger(APP_CONFIG),
            configurable: true,
            writable: true,
            enumerable: false
        });
    }

    // A tela de login sempre inicia sem reaproveitar sessão anterior.
    // Isso evita redirecionamento automático e permite autenticar outra empresa.
    clearClientSession();

    bindPasswordToggle();
    bindLoginForm();
    bindRecoveryModal();
});
