import {
    APP_CONFIG,
    CLIENT_SESSION_STORAGE_KEY,
    refreshAppConfigFromSession
} from './config.js';

const CLIENT_AUTH_ENDPOINT = '/api/client/login';
const ADMIN_AUTH_ENDPOINT = '/api/admin/login';
const ADMIN_REDIRECT_PATH = '/admin/obras/create';

function buildClientSession(empresaRecord = {}) {
    return {
        empresaCodigo: empresaRecord.empresaCodigo || empresaRecord.codigo || '',
        empresaNome: empresaRecord.empresaNome || empresaRecord.nome || '',
        empresaEmail: empresaRecord.empresaEmail || empresaRecord.email || '',
        usuario: empresaRecord.usuario,
        expiraEm: empresaRecord.expiraEm || empresaRecord.expiracao || null
    };
}

function getAuthStorageKey() {
    return APP_CONFIG.auth?.storageKey || CLIENT_SESSION_STORAGE_KEY;
}

function getAuthStorage() {
    if (typeof window === 'undefined') {
        return null;
    }

    return APP_CONFIG.auth?.storageType === 'session'
        ? window.sessionStorage
        : window.localStorage;
}

function persistClientSession(session) {
    const storage = getAuthStorage();
    storage?.setItem(getAuthStorageKey(), JSON.stringify(session));
    refreshAppConfigFromSession();
    return session;
}

function getClientSession() {
    try {
        const rawSession = getAuthStorage()?.getItem(getAuthStorageKey());
        if (!rawSession) {
            return null;
        }

        const parsedSession = JSON.parse(rawSession);
        if (!parsedSession) {
            return null;
        }

        if (parsedSession.empresaCodigo) {
            return parsedSession;
        }

        if (parsedSession.empresa) {
            return {
                empresaCodigo: parsedSession.empresa.codigo || parsedSession.empresa.sigla || '',
                empresaNome: parsedSession.empresa.nome || '',
                empresaEmail: parsedSession.empresaEmail || parsedSession.empresa.email || '',
                usuario: parsedSession.usuario || '',
                token: parsedSession.token || '',
                expiraEm: parsedSession.expiraEm || parsedSession.empresa.expiraEm || parsedSession.empresa.expiracao || null
            };
        }

        return parsedSession;
    } catch (error) {
        console.warn('[AUTH] Falha ao ler sessão do client:', error);
        return null;
    }
}

function clearClientSession() {
    getAuthStorage()?.removeItem(getAuthStorageKey());
    refreshAppConfigFromSession();
}

function validateToken(record) {
    const expiracao = record?.expiraEm || record?.expiracao || record?.empresa?.expiraEm || record?.empresa?.expiracao || null;

    if (!expiracao) {
        return {
            valid: true,
            reason: null,
            expiracao: null
        };
    }

    const expirationDate = new Date(expiracao);
    if (Number.isNaN(expirationDate.getTime())) {
        return {
            valid: false,
            reason: 'invalid_expiration',
            expiracao
        };
    }

    const valid = expirationDate.getTime() > Date.now();

    return {
        valid,
        reason: valid ? null : 'expired',
        expiracao: expirationDate.toISOString()
    };
}

async function loginClient({ usuario, token }) {
    const normalizedUser = (usuario || '').trim().toLowerCase();
    const normalizedToken = (token || '').trim();

    if (!normalizedUser || !normalizedToken) {
        return {
            success: false,
            reason: 'missing_credentials',
            message: 'Usuario e senha sao obrigatorios.'
        };
    }

    let response;
    let payload = null;

    try {
        response = await fetch(CLIENT_AUTH_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuario: normalizedUser,
                token: normalizedToken
            })
        });
    } catch (error) {
        return {
            success: false,
            reason: 'network_error',
            message: 'Não foi possível validar o acesso.'
        };
    }

    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok || !payload?.success) {
        return {
            success: false,
            reason: payload?.reason || 'auth_error',
            message: payload?.message || payload?.error || 'Falha ao autenticar.'
        };
    }

    const session = persistClientSession(buildClientSession(payload.session));

    return {
        success: true,
        session
    };
}

async function loginAdmin({ usuario, token }) {
    const normalizedUser = (usuario || '').trim();
    const normalizedToken = (token || '').trim();

    if (!normalizedUser || !normalizedToken) {
        return {
            success: false,
            reason: 'missing_credentials',
            message: 'Usuário e senha são obrigatórios.'
        };
    }

    let response;
    let payload = null;

    try {
        response = await fetch(ADMIN_AUTH_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuario: normalizedUser,
                token: normalizedToken
            })
        });
    } catch (error) {
        return {
            success: false,
            reason: 'network_error',
            message: 'Não foi possível validar o acesso administrativo.'
        };
    }

    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok || !payload?.success) {
        return {
            success: false,
            reason: payload?.reason || 'invalid_credentials',
            message: payload?.error || 'Usuário ou senha de administrador inválidos.'
        };
    }

    return {
        success: true,
        session: payload.session || {
            usuario: normalizedUser,
            perfil: 'ADM'
        },
        redirectTo: payload.redirectTo || ADMIN_REDIRECT_PATH
    };
}

function hasValidClientSession() {
    const session = getClientSession();
    if (!session) {
        return false;
    }

    return validateToken(session).valid;
}

function redirectToLogin() {
    const loginPage = APP_CONFIG.auth?.loginPage;
    if (loginPage) {
        window.location.replace(loginPage);
    }
}

function redirectToClientApp() {
    const redirectTarget = APP_CONFIG.auth?.redirectAfterLogin;
    if (redirectTarget) {
        window.location.replace(redirectTarget);
    }
}

function redirectToAdminApp(redirectTo = ADMIN_REDIRECT_PATH) {
    window.location.replace(redirectTo || ADMIN_REDIRECT_PATH);
}

function ensureClientAccess({ redirectToLoginPage = true } = {}) {
    if (APP_CONFIG.mode !== 'client' || !APP_CONFIG.auth?.required) {
        return {
            allowed: true,
            session: null
        };
    }

    const session = getClientSession();
    if (!session) {
        if (redirectToLoginPage) {
            redirectToLogin();
        }

        return {
            allowed: false,
            reason: 'missing_session'
        };
    }

    const validation = validateToken(session);
    if (!validation.valid) {
        clearClientSession();

        if (redirectToLoginPage) {
            redirectToLogin();
        }

        return {
            allowed: false,
            reason: validation.reason
        };
    }

    refreshAppConfigFromSession();

    return {
        allowed: true,
        session
    };
}

function logoutClient({ redirect = true } = {}) {
    clearClientSession();

    if (redirect) {
        redirectToLogin();
    }
}

if (typeof window !== 'undefined') {
    window.validateToken = validateToken;
    window.logoutClient = logoutClient;
}

export {
    getClientSession,
    persistClientSession,
    clearClientSession,
    validateToken,
    loginClient,
    loginAdmin,
    hasValidClientSession,
    ensureClientAccess,
    redirectToClientApp,
    redirectToAdminApp,
    logoutClient
};
