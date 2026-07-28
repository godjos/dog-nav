// ═══════════════════════════════════════════
// AUTH HELPERS (Cloudflare Worker) — PBKDF2 via Web Crypto,
// random session tokens, in-memory login rate limiting.
// Web Crypto is available in Workers and Node 18+, so this
// module is unit-testable with node:test. (.mjs so Node treats
// it as ESM regardless of the package.json type field.)
// ═══════════════════════════════════════════

const PBKDF2_ITERATIONS = 100000;
const KEY_LEN_BITS = 256;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function bufToHex(buf) {
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
}

async function deriveBits(password, salt, iterations) {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_LEN_BITS);
}

// Hash a password as "pbkdf2:iterations:salt:hash" (hex encoded)
export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const bits = await deriveBits(password, salt, PBKDF2_ITERATIONS);
    return `pbkdf2:${PBKDF2_ITERATIONS}:${bufToHex(salt)}:${bufToHex(bits)}`;
}

export function isHashed(stored) {
    return typeof stored === 'string' && stored.startsWith('pbkdf2:');
}

// Verify a password against a stored value. Legacy plaintext values are
// compared directly so existing databases keep working; callers should
// re-hash and persist on successful legacy login (lazy migration).
export async function verifyPassword(password, stored) {
    if (typeof stored !== 'string' || stored.length === 0) return false;
    if (!isHashed(stored)) return stored === String(password);
    const parts = stored.split(':');
    if (parts.length !== 4) return false;
    const [, iter, saltHex, hashHex] = parts;
    try {
        const bits = await deriveBits(password, hexToBuf(saltHex), +iter);
        const a = new Uint8Array(bits);
        const b = hexToBuf(hashHex);
        if (a.length !== b.length) return false;
        // Constant-time comparison
        let diff = 0;
        for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
        return diff === 0;
    } catch {
        return false;
    }
}

export function generateToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

// Random initial password from an unambiguous alphabet
export function generatePassword(length = 12) {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let out = '';
    for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
    return out;
}

// In-memory login rate limiter: after maxAttempts failures the key is
// locked for lockMs. check() returns remaining lock seconds (0 = allowed).
// NOTE: on Workers this is per-isolate, so it throttles but cannot fully
// stop a distributed brute-force attack.
export function createRateLimiter({ maxAttempts = 5, lockMs = 15 * 60 * 1000 } = {}) {
    const attempts = new Map(); // key -> { count, lockedUntil }
    return {
        check(key) {
            const rec = attempts.get(key);
            if (rec && rec.lockedUntil > Date.now()) {
                return Math.ceil((rec.lockedUntil - Date.now()) / 1000);
            }
            return 0;
        },
        fail(key) {
            const now = Date.now();
            let rec = attempts.get(key);
            if (!rec || (rec.lockedUntil && rec.lockedUntil <= now)) rec = { count: 0, lockedUntil: 0 };
            rec.count++;
            if (rec.count >= maxAttempts) {
                rec.count = 0;
                rec.lockedUntil = now + lockMs;
            }
            attempts.set(key, rec);
            if (attempts.size > 10000) {
                for (const [k, v] of attempts) {
                    if (!v.lockedUntil || v.lockedUntil <= now) attempts.delete(k);
                }
            }
        },
        reset(key) {
            attempts.delete(key);
        }
    };
}
