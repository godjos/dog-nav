// ═══════════════════════════════════════════
// NET HELPERS (Worker) — sync-only SSRF guards and URL normalization.
// Workers cannot do arbitrary DNS lookups, so unlike lib/netutils.js
// (Express) these checks only cover localhost-style hostnames and IP
// literals; a public hostname that resolves to a private address cannot be
// caught here.
// ═══════════════════════════════════════════

// Hostnames that always resolve locally — rejected outright.
export function isPrivateHostname(hostname) {
    const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
    return h === 'localhost'
        || h.endsWith('.localhost')
        || h.endsWith('.local')
        || h.endsWith('.internal');
}

const IPV4_LITERAL_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

// Private / reserved IPv4 ranges (fail closed on malformed input):
// 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.x (covers the
// special-purpose 192.0.0/24 & 192.0.2/24), 192.168/16, 198.51.100/24,
// 203.0.113/24, 224/4 and above.
function isPrivateIpv4(ip) {
    const parts = String(ip).split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;
    return false;
}

// Private / reserved IPv6: ::, ::1, fc00::/7, fe80::/10, and IPv4-mapped
// ::ffff:a.b.c.d (delegated to the IPv4 rules). Unknown forms fail closed.
function isPrivateIpv6(ip) {
    const h = String(ip).toLowerCase();
    if (h === '::' || h === '::1') return true;
    if (h.startsWith('::ffff:')) {
        const v4 = h.slice(7);
        return IPV4_LITERAL_RE.test(v4) ? isPrivateIpv4(v4) : true;
    }
    const first = h.split(':')[0];
    const v = parseInt(first || '0', 16);
    if (!Number.isFinite(v)) return true;
    if ((v & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((v & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    return false;
}

// True when the host is an IP literal (v4 or v6, with or without brackets)
// in a private/reserved range. Non-literal hostnames → false.
export function isPrivateIpLiteral(host) {
    const h = String(host || '').replace(/^\[|\]$/g, '');
    if (IPV4_LITERAL_RE.test(h)) return isPrivateIpv4(h);
    if (h.includes(':')) return isPrivateIpv6(h);
    return false;
}

// Sync host check: blocks localhost-style hostnames and private IP literals.
export function isPrivateHostSync(hostname) {
    if (isPrivateHostname(hostname)) return true;
    return isPrivateIpLiteral(hostname);
}

// Normalize a URL for duplicate detection: protocol/host lowercased (done by
// the URL parser), hash removed, trailing slashes stripped; the root path is
// normalized to '' so http://a.com and http://a.com/ compare equal.
// Returns null for unparseable input.
export function normalizeUrl(raw) {
    try {
        const u = new URL(String(raw).trim());
        u.hash = '';
        let p = u.pathname;
        if (p === '/') p = '';
        else p = p.replace(/\/+$/, '');
        return `${u.protocol}//${u.host}${p}${u.search}`;
    } catch {
        return null;
    }
}
