// ═══════════════════════════════════════════
// NET HELPERS — SSRF guards and URL normalization
// Used by the health-check, submission and site-creation paths to keep the
// server from making requests to loopback/private/reserved addresses.
// ═══════════════════════════════════════════
const dns = require('dns');
const net = require('net');

// Hostnames that always resolve locally — rejected without any DNS lookup.
function isPrivateHostname(hostname) {
    const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
    return h === 'localhost'
        || h.endsWith('.localhost')
        || h.endsWith('.local')
        || h.endsWith('.internal');
}

// Private / reserved IPv4 ranges (fail closed on malformed input).
// Covers: 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0/16's
// special-purpose 192.0.0/24 & 192.0.2/24 (matched as the broader 192.0.x),
// 192.168/16, 198.51.100/24, 203.0.113/24, 224/4 and above.
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
        return net.isIPv4(v4) ? isPrivateIpv4(v4) : true;
    }
    const first = h.split(':')[0];
    const v = parseInt(first || '0', 16);
    if (!Number.isFinite(v)) return true;
    if ((v & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((v & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    return false;
}

// True when the host is an IP literal (v4 or v6, with or without brackets)
// that falls in a private/reserved range. Non-literal hostnames → false.
function isPrivateIpLiteral(host) {
    const h = String(host || '').replace(/^\[|\]$/g, '');
    if (net.isIPv4(h)) return isPrivateIpv4(h);
    if (net.isIPv6(h)) return isPrivateIpv6(h);
    return false;
}

// Synchronous check usable where DNS resolution is not available/allowed:
// blocks localhost-style hostnames and private IP literals; anything else
// passes (a public hostname may still resolve privately — only the async
// variant catches that).
function isPrivateHostSync(hostname) {
    if (isPrivateHostname(hostname)) return true;
    return isPrivateIpLiteral(hostname);
}

// Full check with DNS resolution (fail closed on resolution errors so an
// unresolvable host is treated as blocked rather than silently allowed).
async function isPrivateHost(hostname) {
    if (isPrivateHostSync(hostname)) return true;
    const h = String(hostname || '').replace(/^\[|\]$/g, '');
    if (net.isIP(h)) return false; // public IP literal, no lookup needed
    try {
        const results = await dns.promises.lookup(h, { all: true, verbatim: true });
        if (!results || results.length === 0) return true;
        return results.some(r => isPrivateIpLiteral(r.address));
    } catch {
        return true;
    }
}

// Normalize a URL for duplicate detection: protocol/host lowercased (done by
// the URL parser), hash removed, trailing slashes stripped; the root path is
// normalized to '' so http://a.com and http://a.com/ compare equal.
// Returns null for unparseable input.
function normalizeUrl(raw) {
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

module.exports = {
    isPrivateHostname,
    isPrivateIpLiteral,
    isPrivateHostSync,
    isPrivateHost,
    normalizeUrl,
};
