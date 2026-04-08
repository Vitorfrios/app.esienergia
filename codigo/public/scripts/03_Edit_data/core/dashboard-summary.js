import { showInfo, showWarning } from '../config/ui.js';

const ADMIN_OBRAS_FILTER_URL = '/admin/obras/create?filtro=1';
const STORAGE_STATUS_ENDPOINT = '/api/system/storage-status';

const dashboardState = {
    initialized: false,
    dataReady: false,
    renderQueued: false,
    rendering: false,
    needsRender: false
};

function isDashboardTabActive() {
    const dashboardTab = document.getElementById('dashboardTab');
    return Boolean(dashboardTab?.classList.contains('active'));
}

function hasDashboardReadyData() {
    return dashboardState.dataReady || hasLoadedSystemData(window.systemData);
}

function canRenderDashboard(force = false) {
    if (force) {
        return true;
    }

    return hasDashboardReadyData() && isDashboardTabActive();
}

function queueDashboardRender({ force = false } = {}) {
    dashboardState.needsRender = true;

    if (dashboardState.renderQueued || dashboardState.rendering) {
        return;
    }

    dashboardState.renderQueued = true;

    window.requestAnimationFrame(() => {
        dashboardState.renderQueued = false;

        if (!dashboardState.needsRender) {
            return;
        }

        dashboardState.needsRender = false;
        renderDashboard({ force });
    });
}

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeDutos(dutos) {
    if (Array.isArray(dutos)) {
        return dutos;
    }

    if (dutos && typeof dutos === 'object' && Array.isArray(dutos.tipos)) {
        return dutos.tipos;
    }

    return [];
}

function normalizeAdmins(admins, legacyAdmins = []) {
    if (Array.isArray(admins)) {
        return admins.filter((admin) => admin && typeof admin === 'object');
    }

    if (admins && typeof admins === 'object') {
        return [admins];
    }

    if (Array.isArray(legacyAdmins)) {
        return legacyAdmins.filter((admin) => admin && typeof admin === 'object');
    }

    if (legacyAdmins && typeof legacyAdmins === 'object') {
        return [legacyAdmins];
    }

    return [];
}

function hasEmpresaLogin(empresa) {
    const credenciais = safeObject(empresa?.credenciais);
    const usuario = String(credenciais.usuario || '').trim();
    const token = String(credenciais.token || '').trim();

    return Boolean(usuario && token);
}

function hasEmpresaRecoveryEmail(empresa) {
    const credenciais = safeObject(empresa?.credenciais);
    const email = String(credenciais.email || credenciais.recoveryEmail || '').trim();
    return Boolean(email);
}

function hasAdminRecoveryEmail(admin) {
    const email = String(admin?.email || '').trim();
    return Boolean(email);
}

function parseDate(value) {
    if (!value) return null;

    if (typeof value === 'string') {
        const normalizedValue = value.trim();
        const brazilianDateMatch = normalizedValue.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

        if (brazilianDateMatch) {
            const [, day, month, year] = brazilianDateMatch;
            const parsedBrazilianDate = new Date(`${year}-${month}-${day}T00:00:00`);
            return Number.isNaN(parsedBrazilianDate.getTime()) ? null : parsedBrazilianDate;
        }
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
    const date = parseDate(value);
    if (!date) return 'Data indisponivel';

    return new Intl.DateTimeFormat('pt-BR').format(date);
}

function getDaysUntil(date) {
    const millisecondsPerDay = 1000 * 60 * 60 * 24;
    return Math.ceil((date.getTime() - Date.now()) / millisecondsPerDay);
}

function getCredenciaisExpirationDate(credenciais) {
    const expirationDate = parseDate(
        credenciais.data_expiracao ||
        credenciais.expiracao ||
        credenciais.expiraEm ||
        credenciais.expiresAt ||
        credenciais.expiration
    );

    if (expirationDate) {
        return expirationDate;
    }

    const createdAt = parseDate(credenciais.data_criacao || credenciais.createdAt);
    const usageDays = Number(
        credenciais.tempoUso ||
        credenciais.validadeDias ||
        credenciais.validade ||
        0
    );

    if (!createdAt || !Number.isFinite(usageDays) || usageDays <= 0) {
        return null;
    }

    const calculatedExpiration = new Date(createdAt);
    calculatedExpiration.setDate(calculatedExpiration.getDate() + usageDays);
    return calculatedExpiration;
}

function hasEmpresaActiveLogin(empresa) {
    if (!hasEmpresaLogin(empresa)) {
        return false;
    }

    const credenciais = safeObject(empresa?.credenciais);
    const expirationDate = getCredenciaisExpirationDate(credenciais);

    if (!expirationDate) {
        return true;
    }

    return expirationDate.getTime() > Date.now();
}

function getEmpresaLabel(empresa) {
    return String(
        empresa?.codigo ||
        empresa?.sigla ||
        empresa?.nome ||
        'Empresa sem identificacao'
    ).trim();
}

function getObraEmpresaLabel(obra) {
    return String(
        obra?.empresaSigla ||
        obra?.empresaCodigo ||
        obra?.empresaNome ||
        obra?.empresa ||
        'Sem empresa'
    ).trim();
}

function getObraDateValue(obra) {
    return (
        obra?.dataCadastro ||
        obra?.criadoEm ||
        obra?.createdAt ||
        obra?.dataCriacao ||
        obra?.updatedAt ||
        null
    );
}

function getObraProjectCount(obra) {
    if (Number.isFinite(Number(obra?.totalProjetos))) {
        return Number(obra.totalProjetos);
    }

    return safeArray(obra?.projetos).length;
}

function normalizeDatabaseUsage(payload) {
    const usedMb = Number(payload?.used_mb || 0);
    const limitMb = Number(payload?.limit_mb || 500);
    const percentUsed = Number(payload?.percent_used || 0);
    const publicSchemaMb = Number(payload?.public_schema_mb || 0);
    const activeAppMb = Number(payload?.active_app_mb || 0);
    const activeAppPercentOfLimit = Number(payload?.active_app_percent_of_limit || 0);
    const otherSchemasMb = Number(payload?.other_schemas_mb || 0);
    const normalizedStatus = String(payload?.status || 'normal').trim().toLowerCase();

    return {
        used_mb: Number.isFinite(usedMb) ? usedMb : 0,
        limit_mb: Number.isFinite(limitMb) && limitMb > 0 ? limitMb : 500,
        percent_used: Number.isFinite(percentUsed) ? percentUsed : 0,
        public_schema_mb: Number.isFinite(publicSchemaMb) ? publicSchemaMb : 0,
        active_app_mb: Number.isFinite(activeAppMb) ? activeAppMb : 0,
        active_app_percent_of_limit: Number.isFinite(activeAppPercentOfLimit) ? activeAppPercentOfLimit : 0,
        other_schemas_mb: Number.isFinite(otherSchemasMb) ? otherSchemasMb : 0,
        status: ['normal', 'warning', 'high'].includes(normalizedStatus) ? normalizedStatus : 'normal',
        status_label: String(payload?.status_label || '').trim(),
        message: String(payload?.message || 'Armazenamento funcionando normalmente.').trim(),
        explanation: String(payload?.explanation || '').trim(),
        update_note: String(payload?.update_note || '').trim(),
        data_source_mode: String(payload?.data_source_mode || 'offline').trim().toLowerCase(),
        data_source_label: String(payload?.data_source_label || '').trim(),
        data_source_summary: String(payload?.data_source_summary || '').trim(),
        database_label: String(payload?.database_label || '').trim(),
        pending_sync_message: String(payload?.pending_sync_message || '').trim(),
        maintenance_available: payload?.maintenance_available !== false,
        maintenance_action_label: String(payload?.maintenance_action_label || 'Reorganizar espaco do banco').trim(),
        maintenance_message: String(payload?.maintenance_message || '').trim()
    };
}

function normalizeDatabaseTables(payload) {
    return safeArray(payload?.tables).map((table) => ({
        table_name: String(table?.table_name || '').trim(),
        size_bytes: Number(table?.size_bytes || 0),
        size_mb: Number(table?.size_mb || 0),
        percent_of_limit: Number(table?.percent_of_limit || 0)
    }));
}

function formatStorageMb(value) {
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: value < 100 ? 2 : 1,
        maximumFractionDigits: value < 100 ? 2 : 1
    }).format(Number(value || 0));
}

function getDatabaseUsageStatus(databaseUsage) {
    if (databaseUsage?.status === 'high') {
        return {
            level: 'high',
            label: databaseUsage?.status_label || 'Alto uso',
            message: databaseUsage?.message || 'O armazenamento esta proximo do limite, mas continua reutilizando espaco automaticamente.',
            color: '#b7791f'
        };
    }

    if (databaseUsage?.status === 'warning') {
        return {
            level: 'attention',
            label: databaseUsage?.status_label || 'Atencao',
            message: databaseUsage?.message || 'O sistema segue normal e o banco reutiliza espaco automaticamente apos exclusoes.',
            color: '#2b6cb0'
        };
    }

    return {
        level: 'good',
        label: databaseUsage?.status_label || 'Normal',
        message: databaseUsage?.message || 'Armazenamento funcionando normalmente.',
        color: '#2f855a'
    };
}

function getDuplicateMachineTypes(maquinas) {
    const counter = new Map();

    safeArray(maquinas).forEach((machine) => {
        const type = String(machine?.type || '').trim();
        if (!type) return;

        const key = type.toLowerCase();
        const current = counter.get(key) || { label: type, count: 0 };
        current.count += 1;
        counter.set(key, current);
    });

    return Array.from(counter.values())
        .filter((item) => item.count > 1)
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
}

function buildEmpresaRanking(obras) {
    const counter = new Map();

    safeArray(obras).forEach((obra) => {
        const label = getObraEmpresaLabel(obra);
        const current = counter.get(label) || { label, totalObras: 0, totalProjetos: 0 };
        current.totalObras += 1;
        current.totalProjetos += getObraProjectCount(obra);
        counter.set(label, current);
    });

    return Array.from(counter.values())
        .sort((a, b) => b.totalObras - a.totalObras || b.totalProjetos - a.totalProjetos || a.label.localeCompare(b.label, 'pt-BR'))
        .slice(0, 5);
}

function buildRecentObras(obras) {
    return safeArray(obras)
        .map((obra) => ({
            id: String(obra?.id || '').trim(),
            nome: String(obra?.nome || obra?.id || 'Obra sem nome').trim(),
            empresa: getObraEmpresaLabel(obra),
            totalProjetos: getObraProjectCount(obra),
            rawDate: getObraDateValue(obra),
            parsedDate: parseDate(getObraDateValue(obra))
        }))
        .sort((a, b) => {
            const timeA = a.parsedDate?.getTime() || 0;
            const timeB = b.parsedDate?.getTime() || 0;
            return timeB - timeA;
        });
}

function hasLoadedSystemData(data) {
    const safeData = safeObject(data);

    return (
        safeArray(safeData.empresas).length > 0 ||
        safeArray(safeData.machines).length > 0 ||
        normalizeDutos(safeData.dutos).length > 0 ||
        safeArray(safeData.tubos).length > 0 ||
        Object.keys(safeObject(safeData.banco_acessorios)).length > 0 ||
        Object.keys(safeObject(safeData.constants)).length > 0 ||
        Boolean(window.hasPendingChanges)
    );
}

function getBootstrapStorageStatus() {
    const bootstrapPayload =
        window.__SYSTEM_BOOTSTRAP__ && typeof window.__SYSTEM_BOOTSTRAP__ === 'object'
            ? window.__SYSTEM_BOOTSTRAP__
            : null;
    return bootstrapPayload?.storage_status && typeof bootstrapPayload.storage_status === 'object'
        ? bootstrapPayload.storage_status
        : null;
}

async function fetchJson(url) {
    const response = await fetch(url, {
        cache: 'no-store',
        headers: {
            Accept: 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Falha em ${url}: ${response.status}`);
    }

    return response.json();
}

async function fetchDashboardData() {
    console.log(' Buscando dados para o dashboard...');

    const localSystemData = safeObject(window.systemData);
    let backupData = { obras: [] };
    let systemData = {};
    let databaseUsage = normalizeDatabaseUsage(getBootstrapStorageStatus());

    if (hasLoadedSystemData(localSystemData)) {
        systemData = localSystemData;
    } else {
        try {
            systemData = safeObject(await fetchJson('/api/system-data'));
        } catch (error) {
            console.warn('Erro ao buscar dados do sistema para o dashboard:', error);
            systemData = localSystemData;
        }
    }

    const requests = [fetchJson('/api/obras/catalog')];
    const shouldRefreshStorageStatus = !getBootstrapStorageStatus();
    if (shouldRefreshStorageStatus) {
        requests.push(fetchJson(`${STORAGE_STATUS_ENDPOINT}?t=${Date.now()}`));
    }

    const settledResults = await Promise.allSettled(requests);
    const backupResult = settledResults[0];
    const usageResult = shouldRefreshStorageStatus
        ? settledResults[1]
        : { status: 'fulfilled', value: getBootstrapStorageStatus() };

    if (backupResult.status === 'fulfilled') {
        backupData = safeObject(backupResult.value);
    } else {
        console.warn('Erro ao buscar backup completo para o dashboard:', backupResult.reason);
    }

    if (usageResult.status === 'fulfilled') {
        databaseUsage = normalizeDatabaseUsage(usageResult.value);
    } else {
        console.warn('Erro ao buscar uso de armazenamento do banco:', usageResult.reason);
    }

    const data = {
        empresas: safeArray(systemData.empresas),
        admins: normalizeAdmins(systemData.ADM, systemData.administradores),
        obras: safeArray(backupData.obras),
        maquinas: safeArray(systemData.machines),
        dutos: normalizeDutos(systemData.dutos),
        tubos: safeArray(systemData.tubos),
        acessorios: safeObject(systemData.banco_acessorios),
        constants: safeObject(systemData.constants),
        databaseUsage,
        databaseTables: []
    };

    console.log(' Dados do dashboard carregados:', {
        admins: data.admins.length,
        empresas: data.empresas.length,
        obras: data.obras.length,
        maquinas: data.maquinas.length,
        dutos: data.dutos.length,
        tubos: data.tubos.length,
        acessorios: Object.keys(data.acessorios).length,
        databaseUsedMb: data.databaseUsage.used_mb,
        databasePercentUsed: data.databaseUsage.percent_used
    });

    return data;
}

function buildCadastroAlerts(data, stats) {
    const alerts = [];

    if (stats.empresasSemLogin > 0) {
        alerts.push({
            title: 'Empresas sem acesso configurado',
            meta: `${formatNumber(stats.empresasSemLogin)} empresa(s) ainda não possuem usuário e token para login do cliente.`,
            actionLabel: 'Revisar empresas',
            actionType: 'tab',
            actionValue: 'empresas'
        });
    }

    if (stats.empresasSemEmail > 0) {
        alerts.push({
            title: 'Empresas sem email de recuperação',
            meta: `${formatNumber(stats.empresasSemEmail)} empresa(s) ainda não possuem email para recuperar o acesso.`,
            actionLabel: 'Revisar empresas',
            actionType: 'tab',
            actionValue: 'empresas'
        });
    }

    if (stats.adminsSemEmail > 0) {
        alerts.push({
            title: 'ADMs sem email de recuperação',
            meta: `${formatNumber(stats.adminsSemEmail)} administrador(es) ainda não possuem email cadastrado.`,
            actionLabel: 'Revisar ADMs',
            actionType: 'tab',
            actionValue: 'adminCredentials'
        });
    }

    if (stats.credenciaisExpiradas.length > 0) {
        alerts.push({
            title: 'Credenciais expiradas',
            meta: `${formatNumber(stats.credenciaisExpiradas.length)} empresa(s) com login vencido e bloqueado para acesso.`,
            actionLabel: 'Abrir empresas',
            actionType: 'tab',
            actionValue: 'empresas'
        });
    }

    if (stats.credenciaisExpirando.length > 0) {
        alerts.push({
            title: 'Credenciais vencendo em até 7 dias',
            meta: `${formatNumber(stats.credenciaisExpirando.length)} empresa(s) precisam de renovação em breve.`,
            actionLabel: 'Planejar renovação',
            actionType: 'tab',
            actionValue: 'empresas'
        });
    }

    if (stats.obrasSemProjeto > 0) {
        alerts.push({
            title: 'Obras sem projeto cadastrado',
            meta: `${formatNumber(stats.obrasSemProjeto)} obra(s) existem no backup, mas ainda sem nenhum projeto vinculado.`,
            actionLabel: 'Abrir obras',
            actionType: 'link',
            actionValue: ADMIN_OBRAS_FILTER_URL
        });
    }

    if (stats.duplicateMachineTypes.length > 0) {
        const duplicatePreview = stats.duplicateMachineTypes
            .slice(0, 3)
            .map((item) => `${item.label} (${item.count})`)
            .join(', ');

        alerts.push({
            title: 'Tipos de máquina duplicados',
            meta: `${formatNumber(stats.duplicateMachineTypes.length)} duplicidade(s) detectada(s). Ex.: ${duplicatePreview}.`,
            actionLabel: 'Ver máquinas',
            actionType: 'tab',
            actionValue: 'machines'
        });
    }

    if (alerts.length === 0 && data.empresas.length > 0) {
        alerts.push({
            title: 'Cadastro em ordem',
            meta: 'Nenhum alerta imediato encontrado nas empresas, obras e máquinas cadastradas.',
            variant: 'good'
        });
    }

    return alerts.slice(0, 5);
}

function processDashboardData(data) {
    const empresasComLogin = data.empresas.filter(hasEmpresaActiveLogin);
    const empresasSemLogin = data.empresas.filter((empresa) => !hasEmpresaLogin(empresa));
    const empresasSemEmail = data.empresas.filter((empresa) => !hasEmpresaRecoveryEmail(empresa));
    const adminsSemEmail = safeArray(data.admins).filter((admin) => !hasAdminRecoveryEmail(admin));
    const credenciaisExpiradas = [];
    const credenciaisExpirando = [];

    data.empresas.forEach((empresa) => {
        if (!hasEmpresaLogin(empresa)) {
            return;
        }

        const expirationDate = getCredenciaisExpirationDate(safeObject(empresa?.credenciais));
        if (!expirationDate) {
            return;
        }

        const daysUntilExpiration = getDaysUntil(expirationDate);
        const normalizedEmpresa = {
            label: getEmpresaLabel(empresa),
            expirationDate,
            daysUntilExpiration
        };

        if (daysUntilExpiration < 0) {
            credenciaisExpiradas.push(normalizedEmpresa);
            return;
        }

        if (daysUntilExpiration <= 7) {
            credenciaisExpirando.push(normalizedEmpresa);
        }
    });

    const rankingEmpresas = buildEmpresaRanking(data.obras);
    const obrasRecentes = buildRecentObras(data.obras);
    const duplicateMachineTypes = getDuplicateMachineTypes(data.maquinas);
    const databaseUsage = normalizeDatabaseUsage(data.databaseUsage);
    const databaseTables = normalizeDatabaseTables({ tables: data.databaseTables });
    const databaseUsageStatus = getDatabaseUsageStatus(databaseUsage);

    const stats = {
        totalEmpresas: data.empresas.length,
        totalAdmins: safeArray(data.admins).length,
        empresasComLogin: empresasComLogin.length,
        empresasSemLogin: empresasSemLogin.length,
        empresasSemEmail: empresasSemEmail.length,
        adminsSemEmail: adminsSemEmail.length,
        credenciaisExpiradas,
        credenciaisExpirando,
        totalObras: data.obras.length,
        obrasSemProjeto: data.obras.filter((obra) => getObraProjectCount(obra) === 0).length,
        totalMaquinas: data.maquinas.length,
        duplicateMachineTypes,
        totalDutos: data.dutos.length,
        totalAcessorios: Object.keys(data.acessorios).length,
        totalTubos: data.tubos.length,
        databaseUsage,
        databaseTables,
        databaseUsageStatus,
        rankingEmpresas,
        obrasRecentes,
        distribuicaoTipos: {
            labels: ['Máquinas', 'Acessórios', 'Dutos', 'Tubos'],
            data: [
                data.maquinas.length,
                Object.keys(data.acessorios).length,
                data.dutos.length,
                data.tubos.length
            ]
        },
        distribuicaoObrasPorEmpresa: {
            labels: rankingEmpresas.map((item) => item.label),
            data: rankingEmpresas.map((item) => item.totalObras)
        }
    };

    stats.alerts = buildCadastroAlerts(data, stats);

    return stats;
}

function renderKPIs(stats) {
    const kpis = [
        {
            label: 'Empresas',
            value: stats.totalEmpresas,
            color: '#4A5568',
            secondaryLabel: 'Com login ativo',
            secondaryValue: stats.empresasComLogin
        },
        { label: 'Obras', value: stats.totalObras, color: '#2B6CB0' },
        { label: 'Máquinas', value: stats.totalMaquinas, color: '#D69E2E' },
        { label: 'Dutos', value: stats.totalDutos, color: '#C53030' },
        { label: 'Acessórios', value: stats.totalAcessorios, color: '#805AD5' },
        { label: 'Tubos', value: stats.totalTubos, color: '#0F766E' }
    ];

    return kpis.map((kpi) => `
        <div class="dashboard-card" style="border-top: 4px solid ${kpi.color}">
            <div class="kpi-content">
                ${kpi.secondaryLabel ? `
                    <div class="kpi-split">
                        <div class="kpi-split-item">
                            <div class="kpi-label">${kpi.label}</div>
                            <div class="kpi-value">${formatNumber(kpi.value)}</div>
                        </div>
                        <div class="kpi-split-item kpi-split-item-secondary">
                            <div class="kpi-label">${kpi.secondaryLabel}</div>
                            <div class="kpi-value kpi-value-secondary">${formatNumber(kpi.secondaryValue)}</div>
                        </div>
                    </div>
                ` : `
                    <div class="kpi-label">${kpi.label}</div>
                    <div class="kpi-value">${formatNumber(kpi.value)}</div>
                `}
            </div>
        </div>
    `).join('');
}

function buildPieGradient(data, colors) {
    const total = data.reduce((sum, value) => sum + value, 0);

    if (total === 0) {
        return 'conic-gradient(#E2E8F0 0deg 360deg)';
    }

    let currentAngle = 0;
    const segments = [];

    data.forEach((value, index) => {
        if (value <= 0) {
            return;
        }

        const angle = (value / total) * 360;
        const nextAngle = currentAngle + angle;
        const color = colors[index % colors.length];

        segments.push(`${color} ${currentAngle}deg ${nextAngle}deg`);
        currentAngle = nextAngle;
    });

    if (segments.length === 0) {
        return 'conic-gradient(#E2E8F0 0deg 360deg)';
    }

    return `conic-gradient(${segments.join(', ')})`;
}

function renderPieChart(containerId, data, labels, title, totalSuffix = 'tipos') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const total = data.reduce((sum, value) => sum + value, 0);

    if (total === 0) {
        container.innerHTML = `
            <div class="chart-header">
                <h4>${escapeHtml(title)}</h4>
            </div>
            <div class="empty-state">Sem dados disponíveis.</div>
        `;
        return;
    }

    const colors = ['#D69E2E', '#805AD5', '#C53030', '#0F766E', '#2B6CB0'];
    const gradient = buildPieGradient(data, colors);

    const legend = data.map((value, index) => {
        if (value <= 0) {
            return '';
        }

        const percent = ((value / total) * 100).toFixed(1);

        return `
            <div class="pie-legend-item">
                <span class="pie-legend-color" style="background: ${colors[index % colors.length]}"></span>
                <span class="pie-legend-label">${escapeHtml(labels[index])}</span>
                <span class="pie-legend-value">${formatNumber(value)} (${percent}%)</span>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="chart-header">
            <h4>${escapeHtml(title)}</h4>
            <span class="chart-total">Total: ${formatNumber(total)} ${escapeHtml(totalSuffix)}</span>
        </div>
        <div class="pie-container">
            <div class="pie-chart-visual" style="background: ${gradient}">
                <div class="pie-center">${formatNumber(total)}</div>
            </div>
            <div class="pie-legend">${legend}</div>
        </div>
    `;
}

function renderMetricsStrip(stats) {
    const items = [
        {
            label: 'Cobertura de acesso',
            value: stats.totalEmpresas > 0
                ? `${Math.round((stats.empresasComLogin / stats.totalEmpresas) * 100)}%`
                : '0%',
            note: `${formatNumber(stats.empresasComLogin)} de ${formatNumber(stats.totalEmpresas)} empresas com login ativo`
        },
        {
            label: 'Sem login',
            value: formatNumber(stats.empresasSemLogin),
            note: 'Empresas sem usuário/token configurado'
        },
        {
            label: 'Expiradas',
            value: formatNumber(stats.credenciaisExpiradas.length),
            note: 'Credenciais que já não permitem acesso'
        },
        {
            label: 'Expiram em 7 dias',
            value: formatNumber(stats.credenciaisExpirando.length),
            note: 'Logins que precisam de renovação imediata'
        },
        {
            label: 'Obras sem projeto',
            value: formatNumber(stats.obrasSemProjeto),
            note: 'Obras salvas sem nenhum projeto associado'
        }
    ];

    return `
        <div class="dashboard-metrics-strip">
            ${items.map((item) => `
                <div class="strip-item">
                    <span class="muted-note">${escapeHtml(item.label)}</span>
                    <strong>${escapeHtml(item.value)}</strong>
                    <span class="muted-note">${escapeHtml(item.note)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function renderActionButton(actionLabel, actionType, actionValue) {
    if (!actionLabel || !actionType || !actionValue) {
        return '';
    }

    if (actionType === 'tab') {
        return `
            <button class="btn btn-small btn-primary dashboard-action-btn" type="button" onclick="switchTab('${escapeHtml(actionValue)}')">
                ${escapeHtml(actionLabel)}
            </button>
        `;
    }

    if (actionType === 'link') {
        return `
            <button class="btn btn-small btn-primary dashboard-action-btn" type="button" onclick="window.location.href='${escapeHtml(actionValue)}'">
                ${escapeHtml(actionLabel)}
            </button>
        `;
    }

    return '';
}

function buildObraDashboardModalUrl(obra) {
    const obraUrl = new URL('/admin/obras/create', window.location.origin);
    obraUrl.searchParams.set('embed', '1');
    obraUrl.searchParams.set('v', '20260325-18');

    if (obra?.id) {
        obraUrl.searchParams.set('obraId', obra.id);
    }

    if (obra?.nome) {
        obraUrl.searchParams.set('obra', obra.nome);
    }

    if (obra?.empresa && obra.empresa !== 'Sem empresa') {
        obraUrl.searchParams.set('empresa', obra.empresa);
    }

    return `${obraUrl.pathname}${obraUrl.search}`;
}

function ensureDashboardObraModal() {
    if (document.getElementById('dashboardObraModal')) {
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'dashboardObraModal';
    modal.className = 'dashboard-obra-modal';
    modal.innerHTML = `
        <div class="dashboard-obra-dialog" role="dialog" aria-modal="true" aria-labelledby="dashboardObraModalTitle">
            <div class="dashboard-obra-header">
                <div>
                    <span class="dashboard-eyebrow">Obra Selecionada</span>
                    <h3 id="dashboardObraModalTitle">Visualização da obra</h3>
                </div>
                <div class="dashboard-obra-actions">
                    <button class="btn btn-small btn-primary" type="button" onclick="closeDashboardObraModal()">
                        Fechar
                    </button>
                </div>
            </div>
            <div class="dashboard-obra-body">
                <iframe
                    id="dashboardObraFrame"
                    class="dashboard-obra-frame"
                    title="Visualização detalhada da obra"
                    loading="lazy"
                ></iframe>
            </div>
        </div>
    `;

    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeDashboardObraModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeDashboardObraModal();
        }
    });

    document.body.appendChild(modal);
}

function openDashboardObraModal(modalUrl, obraName) {
    ensureDashboardObraModal();

    const modal = document.getElementById('dashboardObraModal');
    const title = document.getElementById('dashboardObraModalTitle');
    const frame = document.getElementById('dashboardObraFrame');
    if (!modal || !title || !frame) {
        return;
    }

    modal.dataset.url = modalUrl;
    title.textContent = obraName ? `Obra: ${obraName}` : 'Visualização da obra';
    frame.src = modalUrl;

    modal.classList.add('is-open');
    document.body.classList.add('dashboard-modal-open');
}

function closeDashboardObraModal() {
    const modal = document.getElementById('dashboardObraModal');
    const frame = document.getElementById('dashboardObraFrame');
    if (!modal || !frame) {
        return;
    }

    modal.classList.remove('is-open');
    document.body.classList.remove('dashboard-modal-open');

    setTimeout(() => {
        if (!modal.classList.contains('is-open')) {
            frame.src = 'about:blank';
            delete modal.dataset.url;
        }
    }, 120);
}

function renderAlertsWidget(stats) {
    return `
        <section class="widget-card">
            <div class="widget-title-row">
                <div>
                    <span class="dashboard-eyebrow">Saúde do cadastro</span>
                    <h3>Fila de atenção</h3>
                </div>
                <span class="info-badge ${stats.alerts.some((item) => item.variant !== 'good') ? 'alert' : 'good'}">
                    ${formatNumber(stats.alerts.length)} item(ns)
                </span>
            </div>
            <div class="alert-list">
                ${stats.alerts.map((alert) => `
                    <div class="alert-item ${alert.variant === 'good' ? 'alert-item-good' : ''}">
                        <strong>${escapeHtml(alert.title)}</strong>
                        <span class="alert-meta">${escapeHtml(alert.meta)}</span>
                        ${renderActionButton(alert.actionLabel, alert.actionType, alert.actionValue)}
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

function renderDatabaseUsageWidget(stats) {
    const databaseUsage = normalizeDatabaseUsage(stats.databaseUsage);
    const status = stats.databaseUsageStatus || getDatabaseUsageStatus(databaseUsage);
    const progressPercent = Math.max(0, Math.min(databaseUsage.percent_used, 100));
    const sourceEyebrow = databaseUsage.data_source_mode === 'online'
        ? 'Supabase'
        : 'Base local';
    const sourceTitle = databaseUsage.data_source_mode === 'online'
        ? 'Database usage'
        : 'Uso da base local';
    const statusBadgeClass = status.level === 'good'
        ? 'good'
        : status.level === 'attention'
            ? 'neutral'
            : 'alert';

    return `
        <section class="widget-card">
            <div class="widget-title-row">
                <div>
                    <span class="dashboard-eyebrow">${escapeHtml(sourceEyebrow)}</span>
                    <h3>${escapeHtml(sourceTitle)}</h3>
                </div>
                <span class="info-badge ${statusBadgeClass}">
                    ${escapeHtml(status.label)}
                </span>
            </div>
            <div class="muted-note" style="margin-bottom:10px;">
                ${escapeHtml(databaseUsage.data_source_summary || databaseUsage.database_label || '')}
            </div>
            <div style="display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:10px;">
                <div>
                    <div style="font-size:1.45rem; font-weight:700; color:#1a202c;">
                        ${formatStorageMb(databaseUsage.used_mb)} MB / ${formatStorageMb(databaseUsage.limit_mb)} MB
                    </div>
                    <div class="muted-note">${formatStorageMb(databaseUsage.percent_used)}% do limite do plano</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:0.82rem; text-transform:uppercase; letter-spacing:0.08em; color:#718096;">Status atual</div>
                    <div style="font-size:0.95rem; font-weight:600; color:${status.color};">${escapeHtml(status.label)}</div>
                </div>
            </div>
            <div style="position:relative; height:14px; border-radius:999px; background:#e2e8f0; overflow:hidden; margin-bottom:10px;">
                <div style="height:100%; width:${progressPercent}%; background:linear-gradient(90deg, #2b6cb0 0%, ${status.color} 100%); border-radius:999px; transition:width 0.35s ease;"></div>
            </div>
            <div class="muted-note" style="margin-bottom:14px;">
                ${escapeHtml(status.message)}
            </div>
            ${databaseUsage.pending_sync_message ? `
                <div class="muted-note" style="margin-bottom:14px; color:#b45309; font-weight:600;">
                    ${escapeHtml(databaseUsage.pending_sync_message)}
                </div>
            ` : ''}
            <div class="muted-note" style="margin-bottom:8px;">
                ${escapeHtml(databaseUsage.explanation)}
            </div>
            <div class="muted-note" style="margin-bottom:14px;">
                ${escapeHtml(databaseUsage.update_note)}
            </div>
            <div class="muted-note" style="margin-bottom:14px;">
                Tabelas do app em <code>public</code>: ${formatStorageMb(databaseUsage.public_schema_mb)} MB.
                Base do projeto, extensoes e schemas padrao: ${formatStorageMb(databaseUsage.other_schemas_mb)} MB.
            </div>
        </section>
    `;
}

function renderRankingWidget(stats) {
    if (stats.rankingEmpresas.length === 0) {
        return `
            <section class="widget-card">
                <div class="widget-title-row">
                    <div>
                        <span class="dashboard-eyebrow">Obras</span>
                        <h3>Empresas com mais obras</h3>
                    </div>
                </div>
                <div class="empty-state">Ainda não existem obras suficientes para gerar ranking.</div>
            </section>
        `;
    }

    return `
        <section class="widget-card">
            <div class="widget-title-row">
                <div>
                    <span class="dashboard-eyebrow">Obras</span>
                    <h3>Empresas com mais obras</h3>
                </div>
                <span class="info-badge neutral">Top ${formatNumber(stats.rankingEmpresas.length)}</span>
            </div>
            <div class="ranking-list">
                ${stats.rankingEmpresas.map((item, index) => `
                    <div class="ranking-item">
                        <div>
                            <strong>${formatNumber(index + 1)}. ${escapeHtml(item.label)}</strong>
                            <div class="table-meta">${formatNumber(item.totalProjetos)} projeto(s) somados nas obras da empresa</div>
                        </div>
                        <span class="info-badge good">${formatNumber(item.totalObras)} obra(s)</span>
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

function renderTimelineWidget(stats) {
    if (stats.obrasRecentes.length === 0) {
        return `
            <section class="widget-card">
                <div class="widget-title-row">
                    <div>
                        <span class="dashboard-eyebrow">Timeline</span>
                        <h3>Obras cadastradas</h3>
                    </div>
                </div>
                <div class="empty-state">Nenhuma obra cadastrada ainda.</div>
            </section>
        `;
    }

    const timelineClassName = stats.obrasRecentes.length > 5
        ? 'timeline-list timeline-list-scrollable'
        : 'timeline-list';

    return `
        <section class="widget-card">
            <div class="widget-title-row">
                <div>
                    <span class="dashboard-eyebrow">Timeline</span>
                    <h3>Obras cadastradas</h3>
                </div>
                <button class="btn btn-small btn-secondary dashboard-action-btn" type="button" onclick="window.location.href='${ADMIN_OBRAS_FILTER_URL}'">
                    Abrir obras
                </button>
            </div>
            <p class="muted-note">
                Clique em qualquer obra para visualizar detalhes
            </p>
            <div class="${timelineClassName}">
                ${stats.obrasRecentes.map((obra) => `
                    <button
                        class="timeline-item timeline-item-button"
                        type="button"
                        data-obra-name="${escapeHtml(obra.nome)}"
                        data-obra-url="${escapeHtml(buildObraDashboardModalUrl(obra))}"
                        onclick="openDashboardObraModal(this.dataset.obraUrl, this.dataset.obraName)"
                    >
                        <strong>${escapeHtml(obra.nome)}</strong>
                        <span class="timeline-meta">${escapeHtml(obra.empresa)} | ${formatDate(obra.rawDate)} | ${formatNumber(obra.totalProjetos)} projeto(s)</span>
                    </button>
                `).join('')}
            </div>
        </section>
    `;
}

export async function renderDashboard({ force = false } = {}) {
    const container = document.getElementById('dashboardContent');
    if (!container) return;

    if (!canRenderDashboard(force)) {
        return;
    }

    if (dashboardState.rendering) {
        dashboardState.needsRender = true;
        return;
    }

    dashboardState.rendering = true;

    container.innerHTML = '<div class="dashboard-loading">Carregando dados...</div>';

    try {
        const data = await fetchDashboardData();
        const stats = processDashboardData(data);

        container.innerHTML = `
            <div class="dashboard-kpis">
                ${renderKPIs(stats)}
            </div>

            ${renderMetricsStrip(stats)}

            <div class="dashboard-grid charts">
                <section class="chart-card">
                    <div class="chart-title-row"></div>
                    <div id="distribuicaoChart" class="chart-frame chart-frame-pie"></div>
                </section>

                <section class="chart-card">
                    <div class="chart-title-row"></div>
                    <div id="obrasEmpresaChart" class="chart-frame chart-frame-pie"></div>
                </section>
            </div>

            <div class="dashboard-grid support">
                ${renderDatabaseUsageWidget(stats)}
                ${renderAlertsWidget(stats)}
                ${renderRankingWidget(stats)}
                ${renderTimelineWidget(stats)}
            </div>
        `;

        renderPieChart(
            'distribuicaoChart',
            stats.distribuicaoTipos.data,
            stats.distribuicaoTipos.labels,
            'Distribuicao dos Tipos Cadastrados',
            'tipos'
        );

        renderPieChart(
            'obrasEmpresaChart',
            stats.distribuicaoObrasPorEmpresa.data,
            stats.distribuicaoObrasPorEmpresa.labels,
            'Obras por Empresa',
            'obras'
        );
    } catch (error) {
        console.error(' Erro ao renderizar dashboard:', error);
        container.innerHTML = '<div class="empty-state">Não foi possível carregar o dashboard.</div>';
        showWarning('Erro ao carregar dados do dashboard');
    } finally {
        dashboardState.rendering = false;

        if (dashboardState.needsRender) {
            queueDashboardRender({ force });
        }
    }
}

export function initializeDashboard() {
    console.log(' Inicializando dashboard...');

    ensureDashboardObraModal();
    window.openDashboardObraModal = openDashboardObraModal;
    window.closeDashboardObraModal = closeDashboardObraModal;

    if (hasLoadedSystemData(window.systemData)) {
        dashboardState.dataReady = true;
    }

    queueDashboardRender();

    const refreshBtn = document.getElementById('refreshDashboardBtn');
    if (refreshBtn) {
        refreshBtn.onclick = () => {
            queueDashboardRender({ force: true });
            showInfo('Dashboard atualizado');
        };
    }

    if (dashboardState.initialized) {
        return;
    }

    const handleDashboardDataUpdate = () => {
        dashboardState.dataReady = true;
        queueDashboardRender();
    };

    window.addEventListener('dataLoaded', handleDashboardDataUpdate);
    window.addEventListener('dataImported', handleDashboardDataUpdate);
    window.addEventListener('dataApplied', handleDashboardDataUpdate);

    dashboardState.initialized = true;
}
