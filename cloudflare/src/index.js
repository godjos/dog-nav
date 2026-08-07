import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
    hashPassword,
    verifyPassword,
    isHashed,
    generateToken,
    createRateLimiter,
    SESSION_TTL_MS,
} from './auth.mjs';
import { isPrivateHostSync, normalizeUrl } from './netutils.mjs';

const app = new Hono();

// ═══════════════════════════════════════════
// AUTO-INIT: Create tables + seed data on first deploy
// ═══════════════════════════════════════════
// All concurrent requests await the same shared init Promise. On failure the
// Promise is reset to null so the next request retries (instead of the old
// boolean latch which left the isolate permanently uninitialized).
let dbReadyPromise = null;

function ensureDB(db, env = {}) {
    if (!dbReadyPromise) {
        dbReadyPromise = initDB(db, env).catch((err) => {
            dbReadyPromise = null; // allow retry on a later request
            throw err;
        });
    }
    return dbReadyPromise;
}

async function initDB(db, env) {

    // ── Create all tables ──
    await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS sites (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL, description TEXT, icon TEXT, screenshot TEXT, category TEXT NOT NULL, sort_order INTEGER DEFAULT 0, is_featured INTEGER DEFAULT 0, click_count INTEGER DEFAULT 0, nofollow INTEGER DEFAULT 0, seo_title TEXT, seo_description TEXT, status TEXT DEFAULT 'active', last_status TEXT, last_check_at TEXT, consecutive_failures INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, color TEXT DEFAULT '#667eea')`),
        db.prepare(`CREATE TABLE IF NOT EXISTS site_tags (site_id INTEGER, tag_id INTEGER, PRIMARY KEY (site_id, tag_id))`),
        db.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'editor', is_active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT, expires_at TEXT)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, title TEXT, content TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL, description TEXT, icon TEXT, sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL, description TEXT, category TEXT, submitter_email TEXT, status TEXT DEFAULT 'pending', tracking_token TEXT, review_note TEXT, normalized_url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME, reviewed_by INTEGER)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, reason TEXT, reporter_email TEXT, detail TEXT, reporter_ip TEXT, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, resolved_at DATETIME, resolved_by INTEGER)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, detail TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS stats (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, ip_address TEXT, user_agent TEXT, referrer TEXT, clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP)`),
    ]);

    // ── Idempotent migrations for databases created by older versions ──
    for (const ddl of [
        'ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0',
        'ALTER TABLE sites ADD COLUMN last_status TEXT',
        'ALTER TABLE sites ADD COLUMN last_check_at TEXT',
        'ALTER TABLE sites ADD COLUMN consecutive_failures INTEGER DEFAULT 0',
        'ALTER TABLE submissions ADD COLUMN tracking_token TEXT',
        'ALTER TABLE submissions ADD COLUMN review_note TEXT',
        'ALTER TABLE submissions ADD COLUMN normalized_url TEXT',
        'ALTER TABLE reports ADD COLUMN detail TEXT',
        'ALTER TABLE reports ADD COLUMN reporter_ip TEXT',
        "ALTER TABLE pages ADD COLUMN status TEXT DEFAULT 'published'",
    ]) {
        try { await db.prepare(ddl).run(); } catch { /* column already exists */ }
    }
    // Anyone still on the well-known default password must change it
    await db.prepare("UPDATE users SET must_change_password=1 WHERE password='admin123'").run();

    // ── Check if already seeded ──
    const admin = await db.prepare('SELECT id FROM users WHERE username=?').bind('admin').first();
    if (admin) return; // Already initialized

    // ── Seed default data ──
    // Initial admin is created only when INITIAL_ADMIN_PASSWORD is provided;
    // the password is never generated or logged. The account is forced to
    // change its password on first login.
    if (env.INITIAL_ADMIN_PASSWORD) {
        await db.prepare("INSERT OR IGNORE INTO users (username, password, role, must_change_password) VALUES ('admin', ?, 'admin', 1)")
            .bind(await hashPassword(String(env.INITIAL_ADMIN_PASSWORD))).run();
        console.log('DogNav: default admin created (username: admin, must change password on first login).');
    } else {
        console.warn('DogNav: INITIAL_ADMIN_PASSWORD not set — no admin user created. Set it to bootstrap an admin account.');
    }

    await db.batch([
        db.prepare("INSERT OR IGNORE INTO categories (id, name, icon, sort_order, is_active) VALUES ('recommend', '常用推荐', '⭐', 1, 1)"),
        db.prepare("INSERT OR IGNORE INTO categories (id, name, icon, sort_order, is_active) VALUES ('video', '影视资源', '🎬', 2, 1)"),
        db.prepare("INSERT OR IGNORE INTO categories (id, name, icon, sort_order, is_active) VALUES ('anime', '动漫', '🌸', 3, 1)"),
        db.prepare("INSERT OR IGNORE INTO categories (id, name, icon, sort_order, is_active) VALUES ('software', '软件博客', '💿', 4, 1)"),
        db.prepare("INSERT OR IGNORE INTO categories (id, name, icon, sort_order, is_active) VALUES ('tools', '在线工具', '🔧', 5, 1)"),
        db.prepare("INSERT OR IGNORE INTO categories (id, name, icon, sort_order, is_active) VALUES ('news', '资讯', '📰', 6, 1)"),
        db.prepare("INSERT OR IGNORE INTO categories (id, name, icon, sort_order, is_active) VALUES ('community', '社区', '💬', 7, 1)"),
        db.prepare("INSERT OR IGNORE INTO categories (id, name, icon, sort_order, is_active) VALUES ('ai', 'AI 工具', '🤖', 8, 1)"),
        db.prepare("INSERT OR IGNORE INTO categories (id, name, icon, sort_order, is_active) VALUES ('dev', '开发编程', '💻', 9, 1)"),
        db.prepare("INSERT OR IGNORE INTO categories (id, name, icon, sort_order, is_active) VALUES ('design', '设计素材', '🎨', 10, 1)"),
    ]);

    // Default settings — kept in sync with the Express backend (server.js).
    // weather_api_key stays in the table (legacy, always empty) but is never
    // exposed publicly; the live weather key comes from the WEATHER_API_KEY
    // environment variable.
    await db.batch([
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('site_name', 'DogNav')"),
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('site_description', '发现互联网的无限精彩')"),
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('site_icon', '')"),
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('weather_api_key', '')"),
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('weather_enabled', 'false')"),
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('footer_text', 'DogNav © 2026 — Design by CangDog')"),
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('footer_blog_url', 'https://www.cangdog.com')"),
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('footer_github_url', 'https://github.com/BYGD')"),
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('theme_primary_color', '#667eea')"),
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('theme_secondary_color', '#764ba2')"),
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('submission_enabled', 'true')"),
    ]);

    await db.batch([
        db.prepare("INSERT OR IGNORE INTO pages (id, title, content) VALUES ('about', '关于 DogNav', 'DogNav 是一个精选网址导航，致力于帮助用户发现和探索互联网上优质的网站和工具。')"),
        db.prepare("INSERT OR IGNORE INTO pages (id, title, content) VALUES ('contribute', '提交站点', '如果你发现了好网站，欢迎提交给我们。我们会审核后将其添加到导航中。')"),
        db.prepare("INSERT OR IGNORE INTO pages (id, title, content) VALUES ('links', '友情链接', '以下是与本站有友好往来的网站，欢迎交换友情链接。')"),
        db.prepare("INSERT OR IGNORE INTO pages (id, title, content) VALUES ('guide', '使用指南', '<p>欢迎使用 DogNav 导航站！</p>')"),
    ]);

    console.log('DogNav: Database initialized with default data.');
}

// ── Init middleware: ensure DB is ready on every request ──
app.use('*', async (c, next) => {
    if (c.env.DB) await ensureDB(c.env.DB, c.env);
    await next();
});

// ── Security headers on every response ──
const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.quilljs.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
};

app.use('*', async (c, next) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
    await next();
});

// Wrap an ASSETS response so the security headers are set on it directly
// (asset responses are returned raw, bypassing header merging in some paths).
async function fetchAsset(c, input) {
    const res = await c.env.ASSETS.fetch(input);
    const wrapped = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) wrapped.headers.set(k, v);
    return wrapped;
}

// CORS: same-origin by default (no CORS headers sent). Set the CORS_ORIGIN
// env var (comma-separated) to explicitly allow cross-origin callers.
app.use('*', cors({
    origin: (origin, c) => {
        const allow = ((c.env && c.env.CORS_ORIGIN) || '').split(',').map(s => s.trim()).filter(Boolean);
        return allow.includes(origin) ? origin : undefined;
    },
}));

// ─── Auth middleware: random session tokens stored in D1 ───
async function getSession(db, token) {
    if (!token) return null;
    const row = await db.prepare(
        `SELECT s.token, s.user_id, s.expires_at, u.role, u.is_active, u.must_change_password
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    ).bind(token).first();
    if (!row || !row.is_active) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
        await db.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
        return null;
    }
    return { token: row.token, userId: row.user_id, role: row.role, mustChange: !!row.must_change_password };
}

async function requireAuth(c, next) {
    const token = c.req.header('Authorization')?.replace('Bearer ', '');
    const session = await getSession(c.env.DB, token);
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    // Force password change before any other API use; /api/auth/me stays
    // reachable so the frontend can learn the mustChangePassword state.
    if (session.mustChange && c.req.path !== '/api/auth/password' && c.req.path !== '/api/auth/me') {
        return c.json({ error: 'password_change_required' }, 403);
    }
    c.set('userId', session.userId);
    c.set('userRole', session.role);
    c.set('sessionToken', session.token);
    return next();
}

async function requireAdmin(c, next) {
    return requireAuth(c, () => {
        if (c.get('userRole') !== 'admin') return c.json({ error: 'Admin role required' }, 403);
        return next();
    });
}

// ─── Helper: log action ───
async function logAction(db, userId, action, detail) {
    await db.prepare('INSERT INTO logs (user_id, action, detail, created_at) VALUES (?, ?, ?, datetime(\'now\'))')
        .bind(userId, action, detail).run();
}

// ═══════════════════════════════════════════
// AUTH API
// ═══════════════════════════════════════════

const loginLimiter = createRateLimiter({ maxAttempts: 5, lockMs: 15 * 60 * 1000 });

app.post('/api/auth/login', async (c) => {
    const { username, password } = await c.req.json().catch(() => ({}));
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const waitSeconds = loginLimiter.check(ip);
    if (waitSeconds > 0) {
        c.header('Retry-After', String(waitSeconds));
        return c.json({ error: `Too many login attempts, try again in ${waitSeconds}s` }, 429);
    }

    const user = await c.env.DB.prepare('SELECT * FROM users WHERE username=? AND is_active=1')
        .bind(String(username || '')).first();
    const ok = user && await verifyPassword(String(password || ''), user.password);
    if (!ok) {
        loginLimiter.fail(ip);
        return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Lazy migration: rewrite legacy plaintext password as a hash
    if (!isHashed(user.password)) {
        await c.env.DB.prepare('UPDATE users SET password=? WHERE id=?')
            .bind(await hashPassword(String(password)), user.id).run();
    }

    loginLimiter.reset(ip);
    const token = generateToken();
    const now = Date.now();
    await c.env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .bind(token, user.id, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString()).run();
    // Opportunistic cleanup of expired sessions
    await c.env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date(now).toISOString()).run();
    await logAction(c.env.DB, user.id, 'login', `User ${username} logged in`);
    return c.json({
        success: true,
        token,
        mustChangePassword: !!user.must_change_password,
        user: { id: user.id, username: user.username, role: user.role }
    });
});

app.post('/api/auth/logout', requireAuth, async (c) => {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(c.get('sessionToken')).run();
    return c.json({ message: 'Logged out' });
});

// Current session info; reachable even when a password change is pending.
app.get('/api/auth/me', requireAuth, async (c) => {
    const user = await c.env.DB.prepare('SELECT id, username, role, must_change_password FROM users WHERE id=?')
        .bind(c.get('userId')).first();
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    return c.json({
        id: user.id,
        username: user.username,
        role: user.role,
        mustChangePassword: !!user.must_change_password,
    });
});

app.put('/api/auth/password', requireAuth, async (c) => {
    const { oldPassword, newPassword } = await c.req.json().catch(() => ({}));
    if (!newPassword || String(newPassword).length < 8) {
        return c.json({ error: 'New password must be at least 8 characters' }, 400);
    }
    const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(c.get('userId')).first();
    if (!user || !(await verifyPassword(String(oldPassword || ''), user.password))) {
        return c.json({ error: 'Old password incorrect' }, 401);
    }
    await c.env.DB.prepare('UPDATE users SET password=?, must_change_password=0 WHERE id=?')
        .bind(await hashPassword(String(newPassword)), c.get('userId')).run();
    // Invalidate all other sessions of this user; keep the current one
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND token != ?')
        .bind(c.get('userId'), c.get('sessionToken')).run();
    await logAction(c.env.DB, c.get('userId'), 'change_password', 'Password changed');
    return c.json({ message: 'Password changed' });
});

// ═══════════════════════════════════════════
// SITES API
// ═══════════════════════════════════════════

app.get('/api/sites', async (c) => {
    const sort = c.req.query('sort');
    const orderBy = sort === 'created' ? 'created_at DESC, id DESC' : 'sort_order, category, name';
    const { results } = await c.env.DB.prepare(`SELECT * FROM sites ORDER BY ${orderBy}`).all();
    const { results: tagRows } = await c.env.DB.prepare(
        `SELECT st.site_id, t.id, t.name, t.color FROM site_tags st JOIN tags t ON t.id = st.tag_id ORDER BY t.name`
    ).all();
    const tagsBySite = {};
    for (const row of tagRows) {
        (tagsBySite[row.site_id] = tagsBySite[row.site_id] || []).push({ id: row.id, name: row.name, color: row.color });
    }
    return c.json(results.map(site => ({ ...site, tags: tagsBySite[site.id] || [] })));
});

app.post('/api/sites', requireAuth, async (c) => {
    const b = await c.req.json();
    if (!b.name || !b.url || !b.category) return c.json({ error: 'Missing required fields' }, 400);
    const result = await c.env.DB.prepare(
        `INSERT INTO sites (name,url,description,icon,screenshot,category,sort_order,is_featured,nofollow,seo_title,seo_description,status,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
    ).bind(b.name, b.url, b.description||'', b.icon||'', b.screenshot||'', b.category, b.sort_order||0, b.is_featured||0, b.nofollow||0, b.seo_title||'', b.seo_description||'', b.status||'active').run();
    await logAction(c.env.DB, c.get('userId'), 'create_site', `Created site: ${b.name}`);
    return c.json({ id: result.meta.last_row_id, message: 'Site added' });
});

app.put('/api/sites/:id', requireAuth, async (c) => {
    const b = await c.req.json();
    await c.env.DB.prepare(
        `UPDATE sites SET name=?,url=?,description=?,icon=?,screenshot=?,category=?,sort_order=?,is_featured=?,nofollow=?,seo_title=?,seo_description=?,status=?,updated_at=datetime('now') WHERE id=?`
    ).bind(b.name, b.url, b.description||'', b.icon||'', b.screenshot||'', b.category, b.sort_order||0, b.is_featured||0, b.nofollow||0, b.seo_title||'', b.seo_description||'', b.status||'active', c.req.param('id')).run();
    await logAction(c.env.DB, c.get('userId'), 'update_site', `Updated site ID: ${c.req.param('id')}`);
    return c.json({ message: 'Site updated' });
});

app.delete('/api/sites/:id', requireAuth, async (c) => {
    await c.env.DB.prepare('DELETE FROM sites WHERE id=?').bind(c.req.param('id')).run();
    await logAction(c.env.DB, c.get('userId'), 'delete_site', `Deleted site ID: ${c.req.param('id')}`);
    return c.json({ message: 'Site deleted' });
});

// Batch operations
const BATCH_UPDATE_FIELDS = new Set([
    'name', 'url', 'description', 'icon', 'screenshot', 'category',
    'sort_order', 'is_featured', 'nofollow', 'seo_title', 'seo_description', 'status',
]);

app.post('/api/sites/batch', requireAuth, async (c) => {
    const { ids, action, data } = await c.req.json();
    if (!ids || !Array.isArray(ids) || ids.length === 0) return c.json({ error: 'No IDs provided' }, 400);
    if (action === 'delete') {
        for (const id of ids) {
            await c.env.DB.prepare('DELETE FROM sites WHERE id=?').bind(id).run();
        }
        await logAction(c.env.DB, c.get('userId'), 'batch_delete', `Deleted ${ids.length} sites`);
    } else if (action === 'update') {
        const fields = Object.keys(data || {});
        for (const f of fields) {
            if (!BATCH_UPDATE_FIELDS.has(f)) return c.json({ error: `Invalid field: ${f}` }, 400);
        }
        if (fields.length > 0) {
            const setClause = fields.map(f => `${f}=?`).join(',');
            const values = fields.map(f => data[f]);
            for (const id of ids) {
                await c.env.DB.prepare(`UPDATE sites SET ${setClause} WHERE id=?`).bind(...values, id).run();
            }
        }
        await logAction(c.env.DB, c.get('userId'), 'batch_update', `Updated ${ids.length} sites`);
    } else {
        return c.json({ error: 'Invalid action' }, 400);
    }
    return c.json({ message: `Batch ${action} completed`, count: ids.length });
});

// Click tracking
app.post('/api/sites/:id/click', async (c) => {
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
    const ua = c.req.header('user-agent') || '';
    const ref = c.req.header('referer') || '';
    await c.env.DB.prepare('UPDATE sites SET click_count = click_count + 1 WHERE id=?').bind(c.req.param('id')).run();
    await c.env.DB.prepare('INSERT INTO stats (site_id, ip_address, user_agent, referrer) VALUES (?,?,?,?)')
        .bind(c.req.param('id'), ip, ua, ref).run();
    return c.json({ success: true });
});

// ═══════════════════════════════════════════
// CATEGORIES API
// ═══════════════════════════════════════════

app.get('/api/categories', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY sort_order').all();
    return c.json(results);
});

app.post('/api/categories', requireAuth, async (c) => {
    const { id, name, icon, sort_order } = await c.req.json();
    if (!id || !name) return c.json({ error: 'Missing required fields' }, 400);
    await c.env.DB.prepare('INSERT INTO categories (id,name,icon,sort_order) VALUES (?,?,?,?)')
        .bind(id, name, icon||'', sort_order||0).run();
    await logAction(c.env.DB, c.get('userId'), 'create_category', `Created category: ${name}`);
    return c.json({ message: 'Category created' });
});

app.put('/api/categories/:id', requireAuth, async (c) => {
    const b = await c.req.json();
    await c.env.DB.prepare('UPDATE categories SET name=?,icon=?,sort_order=?,is_active=? WHERE id=?')
        .bind(b.name, b.icon||'', b.sort_order||0, b.is_active !== undefined ? b.is_active : 1, c.req.param('id')).run();
    await logAction(c.env.DB, c.get('userId'), 'update_category', `Updated category: ${c.req.param('id')}`);
    return c.json({ message: 'Category updated' });
});

app.delete('/api/categories/all', requireAdmin, async (c) => {
    await c.env.DB.prepare('DELETE FROM sites').run();
    await c.env.DB.prepare('DELETE FROM categories').run();
    await logAction(c.env.DB, c.get('userId'), 'delete_all_categories', 'Deleted all categories and sites');
    return c.json({ message: 'All categories and sites deleted' });
});

app.delete('/api/categories/:id', requireAuth, async (c) => {
    await c.env.DB.prepare('DELETE FROM categories WHERE id=?').bind(c.req.param('id')).run();
    await logAction(c.env.DB, c.get('userId'), 'delete_category', `Deleted category: ${c.req.param('id')}`);
    return c.json({ message: 'Category deleted' });
});

// ═══════════════════════════════════════════
// TAGS API
// ═══════════════════════════════════════════

app.get('/api/tags', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM tags ORDER BY name').all();
    return c.json(results);
});

app.post('/api/tags', requireAuth, async (c) => {
    const { name, color } = await c.req.json();
    if (!name) return c.json({ error: 'Name required' }, 400);
    const dup = await c.env.DB.prepare('SELECT id FROM tags WHERE name=?').bind(name).first();
    if (dup) return c.json({ error: 'Tag name exists' }, 409);
    await c.env.DB.prepare('INSERT INTO tags (name,color) VALUES (?,?)').bind(name, color||'#667eea').run();
    await logAction(c.env.DB, c.get('userId'), 'create_tag', `Created tag: ${name}`);
    return c.json({ message: 'Tag created' });
});

app.put('/api/tags/:id', requireAuth, async (c) => {
    const body = await c.req.json();
    const id = c.req.param('id');
    const tag = await c.env.DB.prepare('SELECT id, name, color FROM tags WHERE id=?').bind(id).first();
    if (!tag) return c.json({ error: 'Tag not found' }, 404);
    const name = body.name !== undefined ? body.name : tag.name;
    const color = body.color !== undefined ? body.color : tag.color;
    if (name !== tag.name) {
        const dup = await c.env.DB.prepare('SELECT id FROM tags WHERE name=? AND id != ?').bind(name, id).first();
        if (dup) return c.json({ error: 'Tag name exists' }, 409);
    }
    await c.env.DB.prepare('UPDATE tags SET name=?, color=? WHERE id=?').bind(name, color, id).run();
    await logAction(c.env.DB, c.get('userId'), 'update_tag', `Updated tag ID: ${id}`);
    return c.json({ message: 'Tag updated' });
});

app.delete('/api/tags/:id', requireAuth, async (c) => {
    const id = c.req.param('id');
    const tag = await c.env.DB.prepare('SELECT id FROM tags WHERE id=?').bind(id).first();
    if (!tag) return c.json({ error: 'Tag not found' }, 404);
    await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM site_tags WHERE tag_id=?').bind(id),
        c.env.DB.prepare('DELETE FROM tags WHERE id=?').bind(id),
    ]);
    await logAction(c.env.DB, c.get('userId'), 'delete_tag', `Deleted tag ID: ${id}`);
    return c.json({ message: 'Tag deleted' });
});

app.post('/api/sites/:id/tags', requireAuth, async (c) => {
    const { tag_ids } = await c.req.json();
    await c.env.DB.prepare('DELETE FROM site_tags WHERE site_id=?').bind(c.req.param('id')).run();
    if (tag_ids && Array.isArray(tag_ids)) {
        for (const tagId of tag_ids) {
            await c.env.DB.prepare('INSERT INTO site_tags (site_id,tag_id) VALUES (?,?)').bind(c.req.param('id'), tagId).run();
        }
    }
    return c.json({ message: 'Tags updated' });
});

// ═══════════════════════════════════════════
// SUBMISSIONS API
// ═══════════════════════════════════════════

// Simple fixed-window rate limiter: max `max` requests per key per hour.
// NOTE: per-isolate in-memory state — not shared across Worker instances, so
// under multiple isolates the effective limit is weaker (same caveat as the
// login limiter, see docs/API_CONTRACT.md S9).
function createHourlyLimiter(max) {
    const hits = new Map(); // key -> [timestamps]
    return function allow(key) {
        const now = Date.now();
        const cutoff = now - 60 * 60 * 1000;
        const arr = (hits.get(key) || []).filter(t => t > cutoff);
        if (arr.length >= max) { hits.set(key, arr); return false; }
        arr.push(now);
        hits.set(key, arr);
        if (hits.size > 10000) {
            for (const [k, v] of hits) {
                if (!v.length || v[v.length - 1] <= cutoff) hits.delete(k);
            }
        }
        return true;
    };
}

const submissionLimiter = createHourlyLimiter(5);
const reportLimiter = createHourlyLimiter(10);
const REPORT_REASONS = new Set(['link_dead', 'wrong_info', 'spam', 'inappropriate', 'other']);
const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getClientIp(c) {
    return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
}

function randomHexToken(bytes = 16) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

async function categoryExists(db, id) {
    return !!(await db.prepare('SELECT id FROM categories WHERE id=?').bind(id).first());
}

// Validate a submission/site URL: http(s) only, host must not be a private
// hostname or private/reserved IP literal (sync check, no DNS — Workers can't
// resolve hostnames, see netutils.mjs header).
function isAllowedPublicUrl(raw) {
    let parsed;
    try { parsed = new URL(String(raw)); } catch { return false; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return !isPrivateHostSync(parsed.hostname);
}

app.get('/api/submissions', requireAuth, async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM submissions ORDER BY created_at DESC').all();
    return c.json(results);
});

app.post('/api/submissions', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    // Honeypot: real users never fill the hidden "website" field. Bots get a
    // convincing fake success and nothing is persisted (token included).
    if (body.website) {
        return c.json({ message: 'Submission received', trackingToken: randomHexToken() });
    }
    const ip = getClientIp(c);
    if (!submissionLimiter(ip)) {
        return c.json({ error: 'Too many submissions' }, 429);
    }
    const { name, url, description, category, submitter_email } = body;
    if (!name || !url) return c.json({ error: 'Missing required fields' }, 400);
    if (String(name).length > 50) return c.json({ error: 'Invalid name' }, 400);
    if (!isAllowedPublicUrl(url)) return c.json({ error: 'Invalid URL' }, 400);
    if (description && String(description).length > 200) return c.json({ error: 'Invalid description' }, 400);
    if (submitter_email && (String(submitter_email).length > 100 || !SIMPLE_EMAIL_RE.test(String(submitter_email)))) {
        return c.json({ error: 'Invalid email' }, 400);
    }
    if (category && !(await categoryExists(c.env.DB, category))) {
        return c.json({ error: 'Invalid category' }, 400);
    }
    const normalized = normalizeUrl(url);
    const dup = await c.env.DB.prepare("SELECT id FROM submissions WHERE normalized_url=? AND status IN ('pending','approved')")
        .bind(normalized).first();
    if (dup) return c.json({ error: 'Duplicate submission' }, 409);
    const trackingToken = randomHexToken();
    await c.env.DB.prepare('INSERT INTO submissions (name,url,description,category,submitter_email,tracking_token,normalized_url) VALUES (?,?,?,?,?,?,?)')
        .bind(name, url, description||'', category||'', submitter_email||'', trackingToken, normalized).run();
    return c.json({ message: 'Submission received', trackingToken });
});

// Public status lookup by tracking token — never leaks submitter_email.
app.get('/api/submissions/status/:token', async (c) => {
    const sub = await c.env.DB.prepare(
        'SELECT name, url, status, review_note, created_at, reviewed_at FROM submissions WHERE tracking_token=?'
    ).bind(c.req.param('token')).first();
    if (!sub) return c.json({ error: 'Not found' }, 404);
    return c.json(sub);
});

app.put('/api/submissions/:id', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { status } = body;
    const sub = await c.env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(c.req.param('id')).first();

    // Editable fields: fall back to the stored values when not provided
    const finalName = body.name !== undefined ? body.name : (sub ? sub.name : '');
    const finalDescription = body.description !== undefined ? body.description : (sub ? sub.description : '');
    const finalCategory = body.category !== undefined ? body.category : (sub ? sub.category : '');
    const finalReviewNote = body.review_note !== undefined ? body.review_note : (sub ? sub.review_note : '');

    if (status === 'approved' && sub) {
        // Re-validate the final data before turning it into a site
        if (!isAllowedPublicUrl(sub.url)) {
            return c.json({ error: 'Invalid URL' }, 400);
        }
        if (!finalCategory || !(await categoryExists(c.env.DB, finalCategory))) {
            return c.json({ error: 'Invalid category' }, 400);
        }
    }

    await c.env.DB.prepare("UPDATE submissions SET status=?,review_note=?,name=?,description=?,category=?,reviewed_at=datetime('now'),reviewed_by=? WHERE id=?")
        .bind(status, finalReviewNote || '', finalName, finalDescription || '', finalCategory || '', c.get('userId'), c.req.param('id')).run();
    if (status === 'approved' && sub) {
        await c.env.DB.prepare('INSERT INTO sites (name,url,description,icon,category) VALUES (?,?,?,?,?)')
            .bind(finalName, sub.url, finalDescription || '', body.icon || '', finalCategory).run();
    }
    await logAction(c.env.DB, c.get('userId'), 'review_submission', `Submission ${c.req.param('id')}: ${status}`);
    return c.json({ message: 'Submission updated' });
});

// ═══════════════════════════════════════════
// REPORTS API
// ═══════════════════════════════════════════

app.get('/api/reports', requireAuth, async (c) => {
    const { results } = await c.env.DB.prepare(
        'SELECT r.*, s.name as site_name, s.url as site_url FROM reports r LEFT JOIN sites s ON r.site_id = s.id ORDER BY r.created_at DESC'
    ).all();
    return c.json(results);
});

app.post('/api/reports', async (c) => {
    const { site_id, reason, reporter_email, detail } = await c.req.json().catch(() => ({}));
    if (!site_id || !reason) return c.json({ error: 'Missing required fields' }, 400);
    if (!REPORT_REASONS.has(reason)) return c.json({ error: 'Invalid reason' }, 400);
    if (detail && String(detail).length > 200) return c.json({ error: 'Invalid detail' }, 400);
    const ip = getClientIp(c);
    if (!reportLimiter(ip)) return c.json({ error: 'Too many reports' }, 429);
    // Duplicate suppression: same site + same IP within 24h → pretend success
    // without inserting another row.
    const dup = await c.env.DB.prepare(
        "SELECT id FROM reports WHERE site_id=? AND reporter_ip=? AND created_at >= datetime('now', '-24 hours')"
    ).bind(site_id, ip).first();
    if (dup) return c.json({ message: 'Report received' });
    await c.env.DB.prepare('INSERT INTO reports (site_id,reason,reporter_email,detail,reporter_ip) VALUES (?,?,?,?,?)')
        .bind(site_id, reason, reporter_email||'', detail||'', ip).run();
    return c.json({ message: 'Report received' });
});

app.put('/api/reports/:id', requireAuth, async (c) => {
    const body = await c.req.json();
    const { status } = body;
    await c.env.DB.prepare("UPDATE reports SET status=?,resolved_at=datetime('now'),resolved_by=? WHERE id=?")
        .bind(status, c.get('userId'), c.req.param('id')).run();
    if (status === 'resolved' && body.remove_site) {
        const report = await c.env.DB.prepare('SELECT site_id FROM reports WHERE id=?').bind(c.req.param('id')).first();
        if (report) {
            await c.env.DB.prepare("UPDATE sites SET status='inactive' WHERE id=?").bind(report.site_id).run();
        }
    }
    await logAction(c.env.DB, c.get('userId'), 'resolve_report', `Report ${c.req.param('id')}: ${status}`);
    return c.json({ message: 'Report updated' });
});

// ═══════════════════════════════════════════
// STATS API
// ═══════════════════════════════════════════

app.get('/api/stats/overview', requireAuth, async (c) => {
    const db = c.env.DB;
    const totalSites = (await db.prepare('SELECT COUNT(*) as cnt FROM sites').first()).cnt;
    const totalClicks = (await db.prepare('SELECT COALESCE(SUM(click_count),0) as cnt FROM sites').first()).cnt;
    const pendingSubmissions = (await db.prepare("SELECT COUNT(*) as cnt FROM submissions WHERE status='pending'").first()).cnt;
    const pendingReports = (await db.prepare("SELECT COUNT(*) as cnt FROM reports WHERE status='pending'").first()).cnt;
    const activeSites = (await db.prepare("SELECT COUNT(*) as cnt FROM sites WHERE status='active'").first()).cnt;
    return c.json({ totalSites, totalClicks, pendingSubmissions, pendingReports, activeSites, pending_submissions: pendingSubmissions, pending_reports: pendingReports });
});

app.get('/api/stats/popular', requireAuth, async (c) => {
    const { results } = await c.env.DB.prepare('SELECT id,name,url,click_count FROM sites ORDER BY click_count DESC LIMIT 10').all();
    return c.json(results);
});

app.get('/api/stats/category-distribution', requireAuth, async (c) => {
    const { results } = await c.env.DB.prepare(
        'SELECT c.name, COUNT(s.id) as count FROM categories c LEFT JOIN sites s ON c.id = s.category GROUP BY c.id ORDER BY count DESC'
    ).all();
    return c.json(results);
});

// ═══════════════════════════════════════════
// LOGS API
// ═══════════════════════════════════════════

app.get('/api/logs', requireAdmin, async (c) => {
    const { results } = await c.env.DB.prepare(
        'SELECT l.*, u.username FROM logs l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC LIMIT 100'
    ).all();
    return c.json(results);
});

// ═══════════════════════════════════════════
// SETTINGS API
// ═══════════════════════════════════════════

// Settings keys safe to expose publicly. Anything else (e.g. weather_api_key)
// is only available through the authenticated /api/admin/settings endpoint.
const PUBLIC_SETTING_KEYS = new Set([
    'site_name', 'site_description', 'site_icon',
    'footer_text', 'footer_blog_url', 'footer_github_url',
    'theme_primary_color', 'theme_secondary_color',
    'submission_enabled', 'weather_enabled',
]);

// Keys writable through PUT /api/admin/settings (and the deprecated
// PUT /api/settings). weather_api_key is intentionally absent — the
// weather API key comes from the WEATHER_API_KEY environment variable.
const WRITABLE_SETTING_KEYS = new Set([
    'site_name', 'site_description', 'site_icon',
    'footer_text', 'footer_blog_url', 'footer_github_url',
    'theme_primary_color', 'theme_secondary_color',
    'weather_enabled', 'submission_enabled',
]);

// Boolean-valued settings: accept 'true'/'false' or real booleans,
// always stored as the strings 'true'/'false'.
const BOOL_SETTING_KEYS = new Set(['weather_enabled', 'submission_enabled']);

function normalizeSettingValue(key, value) {
    if (BOOL_SETTING_KEYS.has(key)) {
        return (value === true || value === 'true') ? 'true' : 'false';
    }
    return String(value);
}

// Shared handler for PUT /api/admin/settings and deprecated PUT /api/settings.
// Returns an error message on the first non-whitelisted key, or null.
async function applySettingsUpdate(db, body, userId) {
    const entries = Object.entries(body || {});
    for (const [key] of entries) {
        if (!WRITABLE_SETTING_KEYS.has(key)) {
            return `Invalid setting key: ${key}`;
        }
    }
    for (const [key, value] of entries) {
        await db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))")
            .bind(key, normalizeSettingValue(key, value)).run();
    }
    await logAction(db, userId, 'update_settings', 'Settings updated');
    return null;
}

app.get('/api/settings', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of results) {
        if (PUBLIC_SETTING_KEYS.has(row.key)) settings[row.key] = row.value;
    }
    return c.json(settings);
});

// Full settings (including secrets) for the admin panel
app.get('/api/admin/settings', requireAdmin, async (c) => {
    const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of results) settings[row.key] = row.value;
    return c.json(settings);
});

app.put('/api/admin/settings', requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const err = await applySettingsUpdate(c.env.DB, body, c.get('userId'));
    if (err) return c.json({ error: err }, 400);
    return c.json({ message: 'Settings updated' });
});

// Deprecated alias kept for backward compatibility. Use PUT /api/admin/settings.
app.put('/api/settings', requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const err = await applySettingsUpdate(c.env.DB, body, c.get('userId'));
    if (err) return c.json({ error: err }, 400);
    c.header('Deprecation', 'true');
    c.header('Sunset', 'Sat, 01 Jan 2028 00:00:00 GMT');
    return c.json({ message: 'Settings updated', deprecated: true });
});

// ═══════════════════════════════════════════
// WEATHER PROXY API
// ═══════════════════════════════════════════

// In-memory cache of successful weather responses, keyed by coordinates
// rounded to 0.1°, with a 10 minute TTL. Failures are never cached.
const weatherCache = new Map(); // key -> { data, expires }
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;

// Fetch current weather from QWeather; throws on any upstream failure.
async function fetchQWeather(lat, lon, apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const resp = await fetch(
            `https://devapi.qweather.com/v7/weather/now?location=${lon},${lat}&key=${apiKey}`,
            { signal: controller.signal });
        if (!resp.ok) throw new Error(`upstream status ${resp.status}`);
        const data = await resp.json();
        if (data.code !== '200') throw new Error(`upstream code ${data.code}`);
        const now = data.now;

        // Best-effort city name lookup; failure leaves city as null.
        let city = null;
        try {
            const cResp = await fetch(
                `https://geoapi.qweather.com/v2/city/lookup?location=${lon},${lat}&key=${apiKey}&number=1`,
                { signal: controller.signal });
            if (cResp.ok) {
                const cData = await cResp.json();
                if (cData.code === '200' && cData.location && cData.location[0]) {
                    city = cData.location[0].name;
                }
            }
        } catch { /* city stays null */ }

        return {
            temp: Number(now.temp),
            feelsLike: Number(now.feelsLike),
            text: now.text,
            icon: now.icon,
            humidity: Number(now.humidity),
            windDir: now.windDir,
            windScale: Number(now.windScale),
            updateTime: now.updateTime,
            city,
        };
    } finally {
        clearTimeout(timer);
    }
}

app.post('/api/weather', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const nLat = Number(body.lat);
    const nLon = Number(body.lon);
    if (!Number.isFinite(nLat) || !Number.isFinite(nLon) ||
        nLat < -90 || nLat > 90 || nLon < -180 || nLon > 180) {
        return c.json({ error: 'Invalid coordinates' }, 400);
    }
    const enabled = await c.env.DB.prepare('SELECT value FROM settings WHERE key=?')
        .bind('weather_enabled').first();
    if (!enabled || enabled.value !== 'true') {
        return c.json({ error: 'Weather disabled' }, 404);
    }
    const apiKey = c.env.WEATHER_API_KEY;
    if (!apiKey) {
        return c.json({ error: 'Weather not configured' }, 503);
    }

    const cacheKey = `${nLat.toFixed(1)},${nLon.toFixed(1)}`;
    const nowTs = Date.now();
    const cached = weatherCache.get(cacheKey);
    if (cached && cached.expires > nowTs) return c.json(cached.data);

    let data;
    try {
        data = await fetchQWeather(nLat, nLon, apiKey);
    } catch {
        return c.json({ error: 'Weather upstream error' }, 502);
    }
    weatherCache.set(cacheKey, { data, expires: nowTs + WEATHER_CACHE_TTL_MS });
    // Opportunistic cleanup of expired entries
    for (const [k, v] of weatherCache) {
        if (v.expires <= nowTs) weatherCache.delete(k);
    }
    return c.json(data);
});

// ═══════════════════════════════════════════
// PAGES API
// ═══════════════════════════════════════════

// Public: only published pages are visible
app.get('/api/pages', async (c) => {
    const { results } = await c.env.DB.prepare("SELECT * FROM pages WHERE status='published' ORDER BY id").all();
    return c.json(results);
});

// Admin: all pages including drafts
app.get('/api/admin/pages', requireAuth, async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM pages ORDER BY id').all();
    return c.json(results);
});

app.get('/api/pages/:id', async (c) => {
    const page = await c.env.DB.prepare("SELECT * FROM pages WHERE id=? AND status='published'").bind(c.req.param('id')).first();
    if (!page) return c.json({ error: 'Page not found' }, 404);
    return c.json(page);
});

app.put('/api/pages/:id', requireAuth, async (c) => {
    const { title, content, status } = await c.req.json();
    if (status !== undefined && status !== 'draft' && status !== 'published') {
        return c.json({ error: 'Invalid status' }, 400);
    }
    await c.env.DB.prepare("UPDATE pages SET title=COALESCE(?,title),content=COALESCE(?,content),status=COALESCE(?,status),updated_at=datetime('now') WHERE id=?")
        .bind(title ?? null, content ?? null, status ?? null, c.req.param('id')).run();
    await logAction(c.env.DB, c.get('userId'), 'update_page', `Updated page: ${c.req.param('id')}`);
    return c.json({ message: 'Page updated' });
});

app.post('/api/pages', requireAuth, async (c) => {
    const { id, title, content, status } = await c.req.json();
    if (!id || !title) return c.json({ error: 'Missing required fields (id, title)' }, 400);
    if (!/^[a-z0-9-]+$/.test(id)) return c.json({ error: 'Invalid page ID (a-z, 0-9, hyphens only)' }, 400);
    if (status !== undefined && status !== 'draft' && status !== 'published') {
        return c.json({ error: 'Invalid status' }, 400);
    }
    // Check if page with this id already exists
    const existing = await c.env.DB.prepare('SELECT id FROM pages WHERE id=?').bind(id).first();
    if (existing) return c.json({ error: 'Page ID exists' }, 409);
    await c.env.DB.prepare('INSERT INTO pages (id, title, content, status) VALUES (?, ?, ?, ?)')
        .bind(id, title, content || '', status || 'published').run();
    await logAction(c.env.DB, c.get('userId'), 'create_page', `Created page: ${id}`);
    return c.json({ message: 'Page created', id }, 201);
});

app.delete('/api/pages/:id', requireAuth, async (c) => {
    const existing = await c.env.DB.prepare('SELECT id FROM pages WHERE id=?').bind(c.req.param('id')).first();
    if (!existing) return c.json({ error: 'Page not found' }, 404);
    await c.env.DB.prepare('DELETE FROM pages WHERE id=?').bind(c.req.param('id')).run();
    await logAction(c.env.DB, c.get('userId'), 'delete_page', `Deleted page: ${c.req.param('id')}`);
    return c.json({ message: 'Page deleted' });
});

// ═══════════════════════════════════════════
// LINKS API
// ═══════════════════════════════════════════

app.get('/api/links', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM links ORDER BY sort_order, name').all();
    return c.json(results);
});

app.post('/api/links', requireAuth, async (c) => {
    const { name, url, description, icon, sort_order } = await c.req.json();
    if (!name || !url) return c.json({ error: 'Missing required fields' }, 400);
    await c.env.DB.prepare('INSERT INTO links (name,url,description,icon,sort_order) VALUES (?,?,?,?,?)')
        .bind(name, url, description||'', icon||'', sort_order||0).run();
    await logAction(c.env.DB, c.get('userId'), 'create_link', `Created link: ${name}`);
    return c.json({ message: 'Link added' });
});

app.put('/api/links/:id', requireAuth, async (c) => {
    const b = await c.req.json();
    await c.env.DB.prepare('UPDATE links SET name=?,url=?,description=?,icon=?,sort_order=? WHERE id=?')
        .bind(b.name, b.url, b.description||'', b.icon||'', b.sort_order||0, c.req.param('id')).run();
    await logAction(c.env.DB, c.get('userId'), 'update_link', `Updated link ID: ${c.req.param('id')}`);
    return c.json({ message: 'Link updated' });
});

app.delete('/api/links/:id', requireAuth, async (c) => {
    await c.env.DB.prepare('DELETE FROM links WHERE id=?').bind(c.req.param('id')).run();
    await logAction(c.env.DB, c.get('userId'), 'delete_link', `Deleted link ID: ${c.req.param('id')}`);
    return c.json({ message: 'Link deleted' });
});

// ═══════════════════════════════════════════
// FETCH ICON API
// ═══════════════════════════════════════════

const FETCH_ICON_TIMEOUT_MS = 8000;
const FETCH_ICON_MAX_REDIRECTS = 3;
// Cap the downloaded HTML at 50KB, same as the Express backend (server.js).
const FETCH_ICON_MAX_HTML_BYTES = 50000;

// Read a response body up to maxBytes, then cancel the rest.
async function readBodyCapped(resp, maxBytes) {
    if (!resp.body) return '';
    const reader = resp.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
    }
    try { await reader.cancel(); } catch { /* best effort */ }
    const buf = new Uint8Array(Math.min(total, maxBytes));
    let offset = 0;
    for (const chunk of chunks) {
        const slice = chunk.subarray(0, buf.length - offset);
        buf.set(slice, offset);
        offset += slice.length;
    }
    return new TextDecoder().decode(buf);
}

// Only the admin UI calls this endpoint (public/admin/js/*), so it requires
// auth like the other admin routes. Follows redirects manually and re-runs
// the SSRF check (http/https only, no private hosts) on every hop.
app.get('/api/fetch-icon', requireAuth, async (c) => {
    const url = c.req.query('url');
    if (!url) return c.json({ error: 'Missing url parameter' }, 400);

    try {
        let currentUrl = url;
        let parsed = null;
        let html = null;
        for (let hop = 0; hop <= FETCH_ICON_MAX_REDIRECTS; hop++) {
            try { parsed = new URL(currentUrl); } catch {
                return c.json({ icon: '', title: '', description: '' });
            }
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return c.json({ icon: '', title: '', description: '' });
            }
            if (isPrivateHostSync(parsed.hostname)) {
                return c.json({ icon: '', title: '', description: '' });
            }
            const resp = await fetch(parsed.href, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                redirect: 'manual',
                signal: AbortSignal.timeout(FETCH_ICON_TIMEOUT_MS),
            });
            const location = resp.headers.get('location');
            if (resp.status >= 300 && resp.status < 400 && location && hop < FETCH_ICON_MAX_REDIRECTS) {
                try { resp.body && resp.body.cancel(); } catch { /* best effort */ }
                try { currentUrl = new URL(location, parsed.href).href; } catch {
                    return c.json({ icon: '', title: '', description: '' });
                }
                continue;
            }
            html = await readBodyCapped(resp, FETCH_ICON_MAX_HTML_BYTES);
            break;
        }
        if (html === null) return c.json({ icon: '', title: '', description: '' });
        const origin = parsed.origin;

        // Extract icon
        const iconPatterns = [
            /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i,
            /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i,
            /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i,
            /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon["']/i,
        ];
        let icon = origin + '/favicon.ico';
        for (const pat of iconPatterns) {
            const m = html.match(pat);
            if (m && m[1]) {
                let ico = m[1].trim();
                if (ico.startsWith('data:')) { icon = ico; break; }
                if (ico.startsWith('//')) { icon = 'https:' + ico; break; }
                if (ico.startsWith('/')) { icon = origin + ico; break; }
                if (ico.startsWith('http')) { icon = ico; break; }
                icon = origin + '/' + ico;
                break;
            }
        }

        // Extract title
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';

        // Extract description
        const descPatterns = [
            /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
            /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
            /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
            /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i,
        ];
        let description = '';
        for (const pat of descPatterns) {
            const m = html.match(pat);
            if (m && m[1]) { description = m[1].trim(); break; }
        }

        // Localize the icon as a data URI so the frontend doesn't depend on third-party servers.
        // If the remote icon can't be fetched (404, timeout, etc.), drop it —
        // storing a dead URL would leave the frontend on its fallback forever.
        if (icon.startsWith('http')) {
            const dataUri = await fetchIconAsDataUri(icon);
            icon = dataUri || '';
        }

        return c.json({ icon, title, description });
    } catch (err) {
        return c.json({ icon: '', title: '', description: '' });
    }
});

// ═══════════════════════════════════════════
// ICON LOCALIZATION
// ═══════════════════════════════════════════

function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}

// Download a remote icon and return it as a data URI (or null on failure)
async function fetchIconAsDataUri(iconUrl) {
    try {
        if (!iconUrl.startsWith('http')) return null;
        const resp = await fetch(iconUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': new URL(iconUrl).origin + '/' },
            redirect: 'follow',
        });
        if (!resp.ok) return null;
        let mime = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!mime.startsWith('image/')) {
            const p = new URL(iconUrl).pathname.toLowerCase();
            if (p.endsWith('.ico')) mime = 'image/x-icon';
            else if (p.endsWith('.svg')) mime = 'image/svg+xml';
            else if (p.endsWith('.png')) mime = 'image/png';
            else if (p.endsWith('.jpg') || p.endsWith('.jpeg')) mime = 'image/jpeg';
            else if (p.endsWith('.webp')) mime = 'image/webp';
            else if (p.endsWith('.gif')) mime = 'image/gif';
            else return null;
        }
        const buf = await resp.arrayBuffer();
        if (!buf.byteLength || buf.byteLength > 32 * 1024) return null;
        return `data:${mime};base64,${bufToBase64(buf)}`;
    } catch { return null; }
}

// One-off repair: localize all externally hosted icons in sites/links
app.post('/api/admin/localize-icons', requireAdmin, async (c) => {
    try {
        const stats = { sites: { ok: 0, fail: 0 }, links: { ok: 0, fail: 0 } };
        for (const table of ['sites', 'links']) {
            const { results } = await c.env.DB.prepare(`SELECT id, icon FROM ${table} WHERE icon LIKE 'http%'`).all();
            for (const row of results) {
                const dataUri = await fetchIconAsDataUri(row.icon);
                if (dataUri) {
                    await c.env.DB.prepare(`UPDATE ${table} SET icon=? WHERE id=?`).bind(dataUri, row.id).run();
                    stats[table].ok++;
                } else {
                    stats[table].fail++;
                }
            }
        }
        await logAction(c.env.DB, c.get('userId'), 'localize_icons', `sites ${stats.sites.ok} ok/${stats.sites.fail} fail, links ${stats.links.ok} ok/${stats.links.fail} fail`);
        return c.json({ message: 'Done', ...stats });
    } catch (err) {
        return c.json({ error: err.message }, 500);
    }
});

// ═══════════════════════════════════════════
// USERS API
// ═══════════════════════════════════════════

app.get('/api/users', requireAdmin, async (c) => {
    const { results } = await c.env.DB.prepare('SELECT id,username,role,is_active,created_at FROM users ORDER BY id').all();
    return c.json(results);
});

app.post('/api/users', requireAdmin, async (c) => {
    const { username, password, role } = await c.req.json();
    if (!username || !password) return c.json({ error: 'Missing required fields' }, 400);
    if (String(password).length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);
    await c.env.DB.prepare('INSERT INTO users (username,password,role) VALUES (?,?,?)')
        .bind(username, await hashPassword(String(password)), role||'editor').run();
    await logAction(c.env.DB, c.get('userId'), 'create_user', `Created user: ${username}`);
    return c.json({ message: 'User created' });
});

app.put('/api/users/:id', requireAdmin, async (c) => {
    const { role, is_active } = await c.req.json();
    const id = parseInt(c.req.param('id'), 10);
    const user = await c.env.DB.prepare('SELECT id, role, is_active FROM users WHERE id=?').bind(id).first();
    if (!user) return c.json({ error: 'User not found' }, 404);
    const newRole = role !== undefined ? role : user.role;
    const newActive = is_active !== undefined ? is_active : user.is_active;
    // Prevent disabling/demoting the last active admin to avoid lockout
    if (user.role === 'admin' && user.is_active === 1 && (newRole !== 'admin' || Number(newActive) === 0)) {
        const { count } = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE role='admin' AND is_active=1 AND id != ?")
            .bind(id).first();
        if (count === 0) {
            return c.json({ error: 'Cannot disable the last active admin' }, 403);
        }
    }
    await c.env.DB.prepare('UPDATE users SET role=?,is_active=? WHERE id=?')
        .bind(newRole, newActive, id).run();
    await logAction(c.env.DB, c.get('userId'), 'update_user', `Updated user ID: ${c.req.param('id')}`);
    return c.json({ message: 'User updated' });
});

app.post('/api/users/:id/reset-password', requireAdmin, async (c) => {
    const { newPassword } = await c.req.json().catch(() => ({}));
    if (!newPassword || String(newPassword).length < 8) {
        return c.json({ error: 'New password must be at least 8 characters' }, 400);
    }
    const id = parseInt(c.req.param('id'), 10);
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE id=?').bind(id).first();
    if (!user) return c.json({ error: 'User not found' }, 404);
    await c.env.DB.prepare('UPDATE users SET password=?, must_change_password=1 WHERE id=?')
        .bind(await hashPassword(String(newPassword)), id).run();
    // Invalidate every session of the reset user
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
    await logAction(c.env.DB, c.get('userId'), 'reset_password', `Reset password for user ID: ${id}`);
    return c.json({ message: 'Password reset' });
});

app.delete('/api/users/:id', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    // Prevent deleting the last active admin to avoid lockout
    const { count } = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE role='admin' AND is_active=1 AND id != ?")
        .bind(id).first();
    if (count === 0) {
        return c.json({ error: 'Cannot delete the last active admin' }, 403);
    }
    await c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(id).run();
    await logAction(c.env.DB, c.get('userId'), 'delete_user', `Deleted user ID: ${id}`);
    return c.json({ message: 'User deleted' });
});

// ═══════════════════════════════════════════
// IMPORT / EXPORT API
// ═══════════════════════════════════════════

app.get('/api/export', requireAdmin, async (c) => {
    const db = c.env.DB;
    const sites = (await db.prepare('SELECT * FROM sites').all()).results;
    const siteTags = (await db.prepare('SELECT site_id, tag_id FROM site_tags').all()).results;
    const tagsBySite = {};
    for (const st of siteTags) {
        (tagsBySite[st.site_id] = tagsBySite[st.site_id] || []).push(st.tag_id);
    }
    for (const s of sites) s.tags = tagsBySite[s.id] || [];
    const categories = (await db.prepare('SELECT * FROM categories').all()).results;
    const tags = (await db.prepare('SELECT * FROM tags').all()).results;
    const links = (await db.prepare('SELECT * FROM links').all()).results;
    const pages = (await db.prepare('SELECT * FROM pages').all()).results;
    // Only publicly safe setting keys are exported — never secrets like
    // weather_api_key. users/sessions/logs/stats details (IPs) are excluded.
    const settingsRows = (await db.prepare('SELECT key,value FROM settings').all()).results;
    const settings = {};
    for (const row of settingsRows) {
        if (PUBLIC_SETTING_KEYS.has(row.key)) settings[row.key] = row.value;
    }
    const clickStats = (await db.prepare('SELECT site_id, COUNT(*) as clicks FROM stats GROUP BY site_id').all()).results;
    await logAction(c.env.DB, c.get('userId'), 'export', 'Database exported');
    return c.json({ schemaVersion: 2, exportDate: new Date().toISOString(), sites, categories, tags, site_tags: siteTags, links, pages, settings, clickStats });
});

const IMPORT_PAGE_ID_RE = /^[a-z0-9-]+$/;

// Full backup validation — runs before any write. Returns an error string
// describing the first problem, or null when the backup is valid.
function validateBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'top-level must be an object';
    if (data.schemaVersion !== undefined && data.schemaVersion !== 2) return `unsupported schemaVersion: ${data.schemaVersion}`;
    for (const k of ['sites', 'categories', 'tags', 'site_tags', 'links', 'pages', 'clickStats']) {
        if (data[k] !== undefined && !Array.isArray(data[k])) return `${k} must be an array`;
    }
    if (data.settings !== undefined && (typeof data.settings !== 'object' || data.settings === null || Array.isArray(data.settings))) {
        return 'settings must be an object';
    }
    const sites = data.sites || [];
    for (const s of sites) {
        if (!s || typeof s !== 'object' || !s.name || !s.url || !s.category) {
            return `site missing required fields (name, url, category)`;
        }
    }
    const siteIds = new Set(sites.map(s => s.id));
    const tagIds = new Set((data.tags || []).map(t => t && t.id));
    for (const st of (data.site_tags || [])) {
        if (!st || typeof st !== 'object') return 'invalid site_tags entry';
        if (!siteIds.has(st.site_id)) return `site_tags references unknown site_id: ${st.site_id}`;
        if (!tagIds.has(st.tag_id)) return `site_tags references unknown tag_id: ${st.tag_id}`;
    }
    for (const p of (data.pages || [])) {
        if (!p || typeof p !== 'object' || !p.id || !IMPORT_PAGE_ID_RE.test(p.id)) {
            return `invalid page id: ${p && p.id}`;
        }
    }
    return null;
}

app.post('/api/import', requireAdmin, async (c) => {
    const data = await c.req.json().catch(() => null);
    const invalid = validateBackup(data);
    if (invalid) return c.json({ error: `Invalid backup: ${invalid}` }, 400);
    const db = c.env.DB;

    // Only the 10 publicly safe setting keys are imported; the rest are
    // ignored and counted.
    const settingsEntries = data.settings ? Object.entries(data.settings) : [];
    const keptSettings = settingsEntries.filter(([k]) => PUBLIC_SETTING_KEYS.has(k));
    const skippedSettings = settingsEntries.length - keptSettings.length;

    const counts = { sites: 0, categories: 0, tags: 0, links: 0, pages: 0 };
    // db.batch is atomic on D1 — any failing statement rolls back the rest.
    const stmts = [];
    if (data.sites) {
        stmts.push(db.prepare('DELETE FROM sites'));
        for (const s of data.sites) {
            stmts.push(db.prepare(`INSERT INTO sites (id,name,url,description,icon,screenshot,category,sort_order,is_featured,click_count,nofollow,seo_title,seo_description,status,last_status,last_check_at,consecutive_failures)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
                .bind(s.id, s.name, s.url, s.description||'', s.icon||'', s.screenshot||'', s.category,
                    s.sort_order||0, s.is_featured||0, s.click_count||0, s.nofollow||0, s.seo_title||'', s.seo_description||'',
                    s.status||'active', s.last_status||null, s.last_check_at||null, s.consecutive_failures||0));
        }
        counts.sites = data.sites.length;
    }
    if (data.categories) {
        stmts.push(db.prepare('DELETE FROM categories'));
        for (const cat of data.categories) {
            stmts.push(db.prepare('INSERT INTO categories (id,name,icon,sort_order,is_active) VALUES (?,?,?,?,?)')
                .bind(cat.id, cat.name, cat.icon||'', cat.sort_order||0, cat.is_active !== undefined ? cat.is_active : 1));
        }
        counts.categories = data.categories.length;
    }
    if (data.tags) {
        stmts.push(db.prepare('DELETE FROM tags'));
        for (const t of data.tags) {
            stmts.push(db.prepare('INSERT INTO tags (id,name,color) VALUES (?,?,?)').bind(t.id, t.name, t.color||'#667eea'));
        }
        counts.tags = data.tags.length;
    }
    if (data.site_tags) {
        stmts.push(db.prepare('DELETE FROM site_tags'));
        for (const st of data.site_tags) {
            stmts.push(db.prepare('INSERT INTO site_tags (site_id,tag_id) VALUES (?,?)').bind(st.site_id, st.tag_id));
        }
    }
    if (data.links) {
        stmts.push(db.prepare('DELETE FROM links'));
        for (const l of data.links) {
            stmts.push(db.prepare('INSERT INTO links (id,name,url,description,icon,sort_order) VALUES (?,?,?,?,?,?)')
                .bind(l.id, l.name, l.url, l.description||'', l.icon||'', l.sort_order||0));
        }
        counts.links = data.links.length;
    }
    if (data.pages) {
        stmts.push(db.prepare('DELETE FROM pages'));
        for (const p of data.pages) {
            const status = (p.status === 'draft' || p.status === 'published') ? p.status : 'published';
            stmts.push(db.prepare('INSERT INTO pages (id,title,content,status) VALUES (?,?,?,?)')
                .bind(p.id, p.title||'', p.content||'', status));
        }
        counts.pages = data.pages.length;
    }
    for (const [key, value] of keptSettings) {
        stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))").bind(key, value));
    }

    try {
        await db.batch(stmts);
    } catch (err) {
        return c.json({ error: 'Import failed, rolled back' }, 500);
    }
    await logAction(db, c.get('userId'), 'import', 'Database imported');
    return c.json({ message: 'Import completed', counts, skippedSettings });
});

app.post('/api/import/bookmarks', requireAdmin, async (c) => {
    const data = await c.req.json();
    const categories = [];
    const sites = [];
    const seenCatIds = new Set();
    const seenSiteKeys = new Set();
    let catOrder = -1000;

    function ensureCatId(title) {
        let id = String(title || '未分类').trim();
        if (!id) id = '未分类';
        if (!seenCatIds.has(id)) {
            seenCatIds.add(id);
            categories.push({ id, name: id, icon: '', sort_order: catOrder++ });
        }
        return id;
    }

    function addSite(site) {
        const key = `${site.url}|${site.category}`;
        if (seenSiteKeys.has(key)) return;
        seenSiteKeys.add(key);
        sites.push(site);
    }

    function collect(node, parentCatId) {
        if (!node) return;
        if (Array.isArray(node)) {
            node.forEach(n => collect(n, parentCatId));
            return;
        }
        if (node.roots) {
            Object.values(node.roots).forEach(n => collect(n, parentCatId));
            return;
        }
        if (node.children || (!node.url && node.title !== undefined)) {
            const catId = ensureCatId(node.title);
            if (node.children) {
                node.children.forEach(child => collect(child, catId));
            }
        } else if (node.url) {
            addSite({
                name: String(node.title || '未命名').trim(),
                url: String(node.url).trim(),
                description: '',
                icon: node.icon || '',
                category: parentCatId || ensureCatId('未分类'),
                sort_order: 0
            });
        }
    }

    if (Array.isArray(data)) {
        data.forEach(n => collect(n));
    } else if (data.roots) {
        Object.values(data.roots).forEach(n => collect(n));
    } else {
        collect(data);
    }

    if (sites.length === 0) {
        return c.json({ error: 'No bookmarks found' }, 400);
    }

    // 缺失图标留空：前端会显示首字母占位，真实图标由下方后台任务抓取。
    // 不填第三方 favicon 服务（如 google s2，国内不可达），避免引入外链依赖。

    // Avoid creating duplicates against existing sites
    const existingRows = await c.env.DB.prepare('SELECT url, category FROM sites').all();
    const existingKeys = new Set((existingRows.results || []).map(r => `${r.url}|${r.category}`));

    for (const cat of categories) {
        await c.env.DB.prepare('INSERT OR IGNORE INTO categories (id,name,icon,sort_order) VALUES (?,?,?,?)')
            .bind(cat.id, cat.name, cat.icon || '', cat.sort_order || 0).run();
    }
    let inserted = 0;
    const insertedSites = [];
    for (const site of sites) {
        if (existingKeys.has(`${site.url}|${site.category}`)) continue;
        await c.env.DB.prepare('INSERT INTO sites (name,url,description,icon,category,sort_order,updated_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))')
            .bind(site.name, site.url, site.description || '', site.icon || '', site.category, site.sort_order || 0).run();
        inserted++;
        insertedSites.push(site);
    }

    // Fetch real favicons for imported sites in the background
    async function fetchRealIcon(pageUrl) {
        try {
            const origin = new URL(pageUrl).origin;
            const resp = await fetch(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
            const html = await resp.text();
            const patterns = [
                /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i,
                /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i,
                /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i,
                /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon["']/i,
            ];
            let icon = origin + '/favicon.ico';
            for (const pat of patterns) {
                const m = html.match(pat);
                if (m && m[1]) {
                    let ico = m[1].trim();
                    if (ico.startsWith('data:')) { icon = ico; break; }
                    if (ico.startsWith('//')) { icon = 'https:' + ico; break; }
                    if (ico.startsWith('/')) { icon = origin + ico; break; }
                    if (ico.startsWith('http')) { icon = ico; break; }
                    icon = origin + '/' + ico;
                    break;
                }
            }
            return icon;
        } catch (e) { return ''; }
    }

    async function updateIcons() {
        const limit = 5;
        for (let i = 0; i < insertedSites.length; i += limit) {
            const batch = insertedSites.slice(i, i + limit);
            await Promise.all(batch.map(async (site) => {
                let icon = await fetchRealIcon(site.url);
                if (icon.startsWith('http')) {
                    const dataUri = await fetchIconAsDataUri(icon);
                    // 抓取失败说明远程图标不可用，置空而不是留死链
                    icon = dataUri || '';
                }
                if (icon) {
                    await c.env.DB.prepare('UPDATE sites SET icon=? WHERE url=? AND category=?').bind(icon, site.url, site.category).run();
                }
            }));
        }
    }

    if (c.executionCtx && c.executionCtx.waitUntil) {
        c.executionCtx.waitUntil(updateIcons());
    } else {
        await updateIcons();
    }

    await logAction(c.env.DB, c.get('userId'), 'import_bookmarks', `Imported ${inserted} new bookmarks into ${categories.length} categories`);
    return c.json({ message: `Imported ${inserted} bookmarks`, categories: categories.length, sites: inserted });
});

// ═══════════════════════════════════════════
// FILE UPLOAD (base64 → R2 or skip)
// ═══════════════════════════════════════════

app.post('/api/upload', requireAuth, async (c) => {
    // Simplified: in CF Workers, file uploads would go to R2
    // For now, return a placeholder
    return c.json({ url: '', filename: '', message: 'Upload not available on CF. Use external image hosting.' });
});

// ═══════════════════════════════════════════
// HEALTH CHECK API
// ═══════════════════════════════════════════

// Run async workers over items with a fixed concurrency limit.
async function runPool(items, limit, worker) {
    const results = new Array(items.length);
    let idx = 0;
    async function runner() {
        while (idx < items.length) {
            const i = idx++;
            results[i] = await worker(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
    return results;
}

const HEALTH_CHECK_TIMEOUT_MS = 8000;
const HEALTH_CHECK_MAX_REDIRECTS = 3;
const HEALTH_CHECK_CONCURRENCY = 5;

// Probe one site URL. Follows redirects manually (max 3 hops) and re-runs the
// private-host check on every hop. Never throws — failures become offline
// results. Worker variant: sync hostname/IP-literal checks only (no DNS).
async function probeSiteUrl(siteUrl) {
    const startTime = Date.now();
    let currentUrl = siteUrl;
    for (let hop = 0; hop <= HEALTH_CHECK_MAX_REDIRECTS; hop++) {
        let parsed;
        try { parsed = new URL(currentUrl); } catch {
            return { status: 'offline', latency: '-', error: 'Invalid URL' };
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { status: 'offline', latency: '-', error: 'Invalid protocol' };
        }
        if (isPrivateHostSync(parsed.hostname)) {
            return { status: 'offline', latency: '-', error: 'Blocked private host' };
        }
        let resp;
        try {
            resp = await fetch(currentUrl, {
                redirect: 'manual',
                signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
                headers: { 'User-Agent': 'DogNav-HealthCheck/1.0' },
            });
        } catch (err) {
            const msg = (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) ? 'Timeout' : 'Connection failed';
            return { status: 'offline', latency: '-', error: msg };
        }
        const location = resp.headers.get('location');
        if (resp.status >= 300 && resp.status < 400 && location && hop < HEALTH_CHECK_MAX_REDIRECTS) {
            let next;
            try { next = new URL(location, currentUrl).href; } catch {
                try { resp.body && resp.body.cancel(); } catch { /* best effort */ }
                return { status: 'offline', latency: '-', error: 'Invalid redirect' };
            }
            try { resp.body && resp.body.cancel(); } catch { /* best effort */ }
            currentUrl = next;
            continue;
        }
        const latency = Date.now() - startTime;
        try { resp.body && resp.body.cancel(); } catch { /* best effort */ }
        if (resp.status >= 400) {
            return { status: 'offline', latency, statusCode: resp.status };
        }
        // 2xx/3xx → online (slow when the whole chain took > 3s)
        return { status: latency > 3000 ? 'slow' : 'online', latency, statusCode: resp.status };
    }
    // Unreachable: the loop always returns
    return { status: 'offline', latency: '-', error: 'Too many redirects' };
}

app.post('/api/health-check', requireAuth, async (c) => {
    const { siteIds } = await c.req.json().catch(() => ({}));
    // Missing/empty (including the legacy {urls:[...]} shape) → no-op
    if (!Array.isArray(siteIds) || siteIds.length === 0) {
        return c.json({ results: [] });
    }
    if (siteIds.length > 50) {
        return c.json({ error: 'Too many site IDs' }, 400);
    }
    const ids = [...new Set(siteIds.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n)))];
    if (ids.length === 0) return c.json({ results: [] });

    const placeholders = ids.map(() => '?').join(',');
    const { results: sites } = await c.env.DB.prepare(`SELECT * FROM sites WHERE id IN (${placeholders})`)
        .bind(...ids).all();

    const results = await runPool(sites, HEALTH_CHECK_CONCURRENCY, async (site) => {
        const probe = await probeSiteUrl(site.url);
        const result = {
            id: site.id,
            url: site.url,
            status: probe.status,
            latency: probe.latency,
            time: new Date().toLocaleString('zh-CN'),
        };
        if (probe.statusCode !== undefined) result.statusCode = probe.statusCode;
        if (probe.error) result.error = probe.error;

        if (probe.status === 'online' || probe.status === 'slow') {
            await c.env.DB.prepare("UPDATE sites SET last_status=?, last_check_at=datetime('now'), consecutive_failures=0 WHERE id=?")
                .bind(probe.status, site.id).run();
            result.consecutive_failures = 0;
        } else {
            const failures = (site.consecutive_failures || 0) + 1;
            // Only flip last_status to offline after 3 consecutive failures;
            // before that the previous last_status is kept.
            if (failures >= 3) {
                await c.env.DB.prepare("UPDATE sites SET last_status='offline', last_check_at=datetime('now'), consecutive_failures=? WHERE id=?")
                    .bind(failures, site.id).run();
            } else {
                await c.env.DB.prepare("UPDATE sites SET last_check_at=datetime('now'), consecutive_failures=? WHERE id=?")
                    .bind(failures, site.id).run();
            }
            result.consecutive_failures = failures;
        }
        return result;
    });

    return c.json({ results });
});

// ═══════════════════════════════════════════
// ADMIN ROUTING
// ═══════════════════════════════════════════

app.get('/admin', async (c) => {
    return fetchAsset(c, new URL('/admin/index.html', c.req.url));
});

app.get('/admin/:page', async (c) => {
    const page = c.req.param('page').replace(/[^a-z0-9-]/gi, '');
    if (!page) return c.notFound();
    return fetchAsset(c, new URL(`/admin/${page}.html`, c.req.url));
});

// ═══════════════════════════════════════════
// DYNAMIC PAGE ROUTING
// ═══════════════════════════════════════════

app.get('/p/:slug', async (c) => {
    const slug = c.req.param('slug');
    const page = await c.env.DB.prepare('SELECT id FROM pages WHERE id=?').bind(slug).first();
    if (!page) return c.notFound();
    return c.redirect(`/page.html?slug=${encodeURIComponent(slug)}`);
});

// ═══════════════════════════════════════════
// FALLBACK TO STATIC ASSETS
// ═══════════════════════════════════════════

app.notFound(async (c) => {
    if (c.req.path.startsWith('/api/')) {
        return c.json({ error: 'Not found' }, 404);
    }
    return fetchAsset(c, c.req.raw);
});

export default app;
