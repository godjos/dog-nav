// Shared widget contract and public-data adapters for Express and Workers.
const TYPES = new Set(['github', 'uptimekuma', 'custom_json', 'weather']);
const CACHE_TTL_MS = 5 * 60 * 1000;
const secretKey = /(?:key|token|secret|password|credential|auth)/i;

function publicUrl(raw, { base = false } = {}) {
    if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Invalid public HTTPS URL');
    let url;
    try { url = new URL(raw); } catch { throw new Error('Invalid public HTTPS URL'); }
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    // Arbitrary IP targets, single-label names, and nonstandard ports have no
    // useful role in public integrations and broaden the SSRF surface.
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.') ||
        host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
        host.endsWith('.internal') || host.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(host)) {
        throw new Error('Invalid public HTTPS URL');
    }
    if (url.hash || (base && (url.search || url.pathname !== '/'))) throw new Error('Invalid public HTTPS URL');
    for (const key of url.searchParams.keys()) if (secretKey.test(key)) throw new Error('API credentials are not supported');
    return url.href;
}

function validateWidget(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid widget');
    const { site_id, type, visibility, enabled, sort_order, config } = body;
    if (site_id !== null && (!Number.isSafeInteger(site_id) || site_id < 1)) throw new Error('Invalid site_id');
    if (!TYPES.has(type)) throw new Error('Invalid type');
    if (!['public', 'private'].includes(visibility)) throw new Error('Invalid visibility');
    if (typeof enabled !== 'boolean') throw new Error('Invalid enabled');
    if (!Number.isSafeInteger(sort_order) || sort_order < 0 || sort_order > 100000) throw new Error('Invalid sort_order');
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid config');
    let clean;
    if (type === 'github') {
        if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(config.owner || '') ||
            !/^[A-Za-z0-9_.-]{1,100}$/.test(config.repo || '') || config.repo === '.' || config.repo === '..') throw new Error('Invalid GitHub repository');
        clean = { owner: config.owner, repo: config.repo };
    } else if (type === 'uptimekuma') {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(config.slug || '')) throw new Error('Invalid status page slug');
        clean = { url: publicUrl(config.url, { base: true }).replace(/\/$/, ''), slug: config.slug };
    } else if (type === 'custom_json') {
        if (!Array.isArray(config.mappings) || config.mappings.length < 1 || config.mappings.length > 4) throw new Error('Mappings must contain 1-4 fields');
        clean = { url: publicUrl(config.url), mappings: config.mappings.map((m) => {
            if (!m || typeof m.label !== 'string' || !m.label.trim() || m.label.length > 40 ||
                typeof m.path !== 'string' || !/^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/.test(m.path) ||
                (m.unit !== undefined && (typeof m.unit !== 'string' || m.unit.length > 15))) throw new Error('Invalid metric mapping');
            return { label: m.label.trim(), path: m.path, ...(m.unit ? { unit: m.unit } : {}) };
        }) };
    } else {
        const lat = Number(config.latitude), lon = Number(config.longitude);
        if (config.latitude === '' || config.longitude === '' || !Number.isFinite(lat) || !Number.isFinite(lon) ||
            lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error('Invalid weather coordinates');
        clean = { latitude: lat, longitude: lon };
    }
    return { site_id, type, visibility, enabled: enabled ? 1 : 0, sort_order, config_json: JSON.stringify(clean) };
}

function adminWidget(row) {
    return { id: row.id, site_id: row.site_id, type: row.type, visibility: row.visibility,
        enabled: !!row.enabled, sort_order: row.sort_order, config: JSON.parse(row.config_json) };
}
function publicWidget(row) {
    return { id: row.id, site_id: row.site_id, type: row.type, visibility: row.visibility,
        enabled: !!row.enabled, sort_order: row.sort_order };
}
function metric(label, value, unit) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Upstream metric unavailable');
    return { label, value, ...(unit ? { unit } : {}) };
}
async function fetchJson(url, fetchImpl = fetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller.signal,
            headers: { Accept: 'application/json', 'User-Agent': 'Mirza-Widgets/1.0' } });
        if (!response.ok || response.status >= 300) throw new Error(`Upstream HTTP ${response.status}`);
        const length = Number(response.headers.get('content-length'));
        if (length > 256 * 1024) throw new Error('Upstream response too large');
        const reader = response.body.getReader();
        const chunks = []; let size = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 256 * 1024) { await reader.cancel(); throw new Error('Upstream response too large'); }
            chunks.push(value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder().decode(bytes));
    } finally { clearTimeout(timer); }
}
function atPath(data, path) {
    return path.split('.').reduce((value, key) => value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined, data);
}
async function loadWidget(row, fetchImpl) {
    const config = JSON.parse(row.config_json);
    let fields, state = 'ok';
    if (row.type === 'github') {
        const data = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`, fetchImpl);
        if (data.private === true) throw new Error('Repository is private');
        fields = [metric('Stars', data.stargazers_count), metric('Forks', data.forks_count), metric('Open issues', data.open_issues_count)];
    } else if (row.type === 'uptimekuma') {
        const data = await fetchJson(`${config.url}/api/status-page/heartbeat/${encodeURIComponent(config.slug)}`, fetchImpl);
        const heartbeats = Object.values(data.heartbeatList || {}).filter(Array.isArray);
        // Kuma selects DESC in SQL then reverses each list before returning;
        // the final element is the newest heartbeat.
        const latest = heartbeats.map(list => list.at(-1)).filter(Boolean);
        if (!latest.length) throw new Error('No status data');
        const up = latest.filter(item => item.status === 1).length;
        state = up === latest.length ? 'ok' : 'degraded';
        fields = [metric('Up', up), metric('Total', latest.length)];
    } else if (row.type === 'custom_json') {
        const data = await fetchJson(config.url, fetchImpl);
        fields = config.mappings.map(m => {
            const value = atPath(data, m.path);
            if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error('Upstream metric unavailable');
            if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Upstream metric unavailable');
            return { label: m.label, value, ...(m.unit ? { unit: m.unit } : {}) };
        });
    } else {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${config.latitude}&longitude=${config.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`;
        const data = await fetchJson(url, fetchImpl);
        fields = [metric('Temperature', data.current?.temperature_2m, '°C'), metric('Humidity', data.current?.relative_humidity_2m, '%'), metric('Wind', data.current?.wind_speed_10m, 'km/h')];
    }
    return { id: row.id, state, fields, updated_at: new Date().toISOString() };
}
async function widgetData(row, fetchImpl, cacheStore) {
    const stored = await cacheStore.read(row.id);
    let cached = null;
    if (stored?.config_json === row.config_json) {
        try { cached = { data: JSON.parse(stored.data_json), time: Number(stored.fetched_at) }; } catch { /* refresh invalid cache */ }
    }
    if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.data;
    try {
        const data = await loadWidget(row, fetchImpl);
        await cacheStore.write(row.id, row.config_json, JSON.stringify(data), Date.now());
        return data;
    } catch {
        if (cached) return { ...cached.data, state: 'stale' };
        return { id: row.id, state: 'error', fields: [], updated_at: null };
    }
}
module.exports = { validateWidget, adminWidget, publicWidget, widgetData };
