// Unit tests for the pure helpers in lib/auth.js — no server, no db.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    hashPassword,
    verifyPassword,
    isHashed,
    generateToken,
    generatePassword,
    createRateLimiter,
    SESSION_TTL_MS,
} = require('../lib/auth');

test('hashPassword/verifyPassword roundtrip', () => {
    const hash = hashPassword('S3cret! pass');
    assert.ok(isHashed(hash));
    assert.ok(verifyPassword('S3cret! pass', hash));
});

test('hashPassword uses a random salt (same input, different hashes)', () => {
    assert.notEqual(hashPassword('same'), hashPassword('same'));
});

test('verifyPassword rejects wrong passwords and malformed input', () => {
    const hash = hashPassword('correct horse');
    assert.equal(verifyPassword('wrong horse', hash), false);
    assert.equal(verifyPassword('correct horse', ''), false);
    assert.equal(verifyPassword('correct horse', null), false);
    assert.equal(verifyPassword('correct horse', 'scrypt:bad:format'), false);
});

test('verifyPassword supports legacy plaintext values (lazy migration path)', () => {
    // CONTRACT-PIN: 现状行为，后续阶段可能调整 — plaintext stored passwords
    // are still accepted so old databases keep working.
    assert.equal(verifyPassword('admin123', 'admin123'), true);
    assert.equal(verifyPassword('admin124', 'admin123'), false);
});

test('isHashed recognises the scrypt: prefix only', () => {
    assert.equal(isHashed(hashPassword('x')), true);
    assert.equal(isHashed('admin123'), false);
    assert.equal(isHashed(''), false);
    assert.equal(isHashed(undefined), false);
});

test('generateToken returns unique base64url tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    assert.equal(tokens.size, 200);
    for (const t of tokens) {
        assert.match(t, /^[A-Za-z0-9_-]{43}$/); // 32 bytes as base64url
    }
});

test('generatePassword honours length and unambiguous alphabet', () => {
    const pw = generatePassword(16);
    assert.equal(pw.length, 16);
    assert.match(pw, /^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
});

test('SESSION_TTL_MS is 7 days', () => {
    assert.equal(SESSION_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

test('createRateLimiter locks after maxAttempts failures', () => {
    const limiter = createRateLimiter({ maxAttempts: 3, lockMs: 60 * 1000 });
    assert.equal(limiter.check('k'), 0);
    limiter.fail('k');
    limiter.fail('k');
    assert.equal(limiter.check('k'), 0, 'not locked before threshold');
    limiter.fail('k');
    const wait = limiter.check('k');
    assert.ok(wait > 0 && wait <= 60, `locked, got ${wait}s`);
    // Other keys are unaffected
    assert.equal(limiter.check('other'), 0);
});

test('createRateLimiter reset() clears failures and the lock', () => {
    const limiter = createRateLimiter({ maxAttempts: 2, lockMs: 60 * 1000 });
    limiter.fail('k');
    limiter.fail('k');
    assert.ok(limiter.check('k') > 0);
    limiter.reset('k');
    assert.equal(limiter.check('k'), 0);
});

test('createRateLimiter lock expires after lockMs', async () => {
    const limiter = createRateLimiter({ maxAttempts: 1, lockMs: 30 });
    limiter.fail('k');
    assert.ok(limiter.check('k') > 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(limiter.check('k'), 0);
});
