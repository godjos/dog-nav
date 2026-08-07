// ═══════════════════════════════════════════
// AUTH HELPERS — password hashing, tokens, rate limiting
// Pure functions over Node's built-in crypto, unit-testable.
// ═══════════════════════════════════════════
const crypto = require('crypto');

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1;
const KEY_LEN = 64;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Hash a password as "scrypt:N:r:p:salt:hash" (hex encoded)
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString('hex');
    return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt}:${hash}`;
}

function isHashed(stored) {
    return typeof stored === 'string'
        && (stored.startsWith('scrypt:') || stored.startsWith('pbkdf2:'));
}

// Verify a "pbkdf2:iterations:salt:hash" value (hex encoded, SHA-256, 32-byte
// key) — the format the Cloudflare Worker (cloudflare/src/auth.mjs) produces,
// so Worker-generated hashes stay verifiable on the Node side. scrypt remains
// the default for newly hashed passwords here.
function verifyPbkdf2(password, stored) {
    const parts = stored.split(':');
    if (parts.length !== 4) return false;
    const [, iter, saltHex, hashHex] = parts;
    let derived;
    try {
        derived = crypto.pbkdf2Sync(String(password), Buffer.from(saltHex, 'hex'), +iter, 32, 'sha256');
    } catch {
        return false;
    }
    const expected = Buffer.from(hashHex, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

// Verify a password against a stored value. Legacy plaintext values are
// compared directly so existing databases keep working; callers should
// re-hash and persist on successful legacy login (lazy migration).
function verifyPassword(password, stored) {
    if (typeof stored !== 'string' || stored.length === 0) return false;
    if (!isHashed(stored)) return stored === String(password);
    if (stored.startsWith('pbkdf2:')) return verifyPbkdf2(password, stored);
    const parts = stored.split(':');
    if (parts.length !== 6) return false;
    const [, N, r, p, salt, hash] = parts;
    let derived;
    try {
        derived = crypto.scryptSync(String(password), salt, KEY_LEN, { N: +N, r: +r, p: +p });
    } catch {
        return false;
    }
    const expected = Buffer.from(hash, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function generateToken() {
    return crypto.randomBytes(32).toString('base64url');
}

// Random initial password from an unambiguous alphabet
function generatePassword(length = 12) {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
    return out;
}

// In-memory login rate limiter: after maxAttempts failures the key is
// locked for lockMs. check() returns remaining lock seconds (0 = allowed).
function createRateLimiter({ maxAttempts = 5, lockMs = 15 * 60 * 1000 } = {}) {
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

module.exports = {
    hashPassword,
    verifyPassword,
    isHashed,
    generateToken,
    generatePassword,
    createRateLimiter,
    SESSION_TTL_MS,
};
