const express = require('express');
const initSqlJs = require('sql.js');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './dognav.db';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

const {
    hashPassword,
    verifyPassword,
    isHashed,
    generateToken,
    createRateLimiter,
    SESSION_TTL_MS,
} = require('./lib/auth');
const {
    isPrivateHost,
    isPrivateHostSync,
    normalizeUrl,
} = require('./lib/netutils');

let db;

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// File upload config: extension whitelist (checked in fileFilter) plus
// magic-byte verification after the file hits disk (see /api/upload).
const UPLOAD_ALLOWED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ico']);
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = Date.now() + '-' + Math.random().toString(36).substr(2, 9) + ext;
        cb(null, name);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (!ext || !UPLOAD_ALLOWED_EXTS.has(ext)) {
            return cb(new Error('Invalid file type'));
        }
        cb(null, true);
    }
});

// Verify the real file content matches common image magic bytes
function hasValidImageMagic(filePath, ext) {
    let head;
    try {
        const fd = fs.openSync(filePath, 'r');
        head = Buffer.alloc(12);
        const len = fs.readSync(fd, head, 0, 12, 0);
        fs.closeSync(fd);
        if (len < 4) return false;
    } catch {
        return false;
    }
    if (ext === '.png') return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    if (ext === '.jpg' || ext === '.jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    if (ext === '.webp') return head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP';
    if (ext === '.ico') return head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0x00;
    return false;
}

// Middleware
// CORS: same-origin by default (no CORS headers sent). Set CORS_ORIGIN
// (comma-separated) to explicitly allow cross-origin callers.
// Security response headers — applied to every response (API and static files)
app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.quilljs.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
    next();
});

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// Save database to file
function saveDb() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

// Helper: get single setting value
function getSetting(key) {
    const result = db.exec("SELECT value FROM settings WHERE key = ?", [key]);
    return result[0]?.values[0]?.[0] || null;
}

// Helper: set single setting value
function setSetting(key, value) {
    db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))", [key, value]);
}

// Helper: log activity
function logAction(userId, action, detail) {
    db.run("INSERT INTO logs (user_id, action, detail, created_at) VALUES (?, ?, ?, datetime('now'))", [userId, action, detail]);
    saveDb();
}

// Initialize database
async function initDb() {
    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
        console.log('Loaded existing database');
    } else {
        db = new SQL.Database();
        console.log('Created new database');
    }

    // ═══════════════════════════════════════════
    // DATABASE TABLES
    // ═══════════════════════════════════════════

    db.run(`CREATE TABLE IF NOT EXISTS sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        screenshot TEXT,
        category TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        is_featured INTEGER DEFAULT 0,
        click_count INTEGER DEFAULT 0,
        nofollow INTEGER DEFAULT 0,
        seo_title TEXT,
        seo_description TEXT,
        status TEXT DEFAULT 'active',
        last_status TEXT,
        last_check_at TEXT,
        consecutive_failures INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        color TEXT DEFAULT '#667eea'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS site_tags (
        site_id INTEGER,
        tag_id INTEGER,
        PRIMARY KEY (site_id, tag_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'editor',
        is_active INTEGER DEFAULT 1,
        must_change_password INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT,
        expires_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT,
        category TEXT,
        submitter_email TEXT,
        status TEXT DEFAULT 'pending',
        tracking_token TEXT,
        review_note TEXT,
        normalized_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME,
        reviewed_by INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER,
        reason TEXT,
        reporter_email TEXT,
        detail TEXT,
        reporter_ip TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        resolved_by INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        detail TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER,
        ip_address TEXT,
        user_agent TEXT,
        referrer TEXT,
        clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // ═══════════════════════════════════════════
    // IDEMPOTENT MIGRATIONS (for databases created by older versions)
    // ═══════════════════════════════════════════

    function ensureColumn(table, column, ddl) {
        const info = db.exec(`PRAGMA table_info(${table})`);
        const cols = info[0] ? info[0].values.map(r => r[1]) : [];
        if (!cols.includes(column)) {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
            console.log(`Migration: added column ${table}.${column}`);
        }
    }
    ensureColumn('users', 'must_change_password', 'must_change_password INTEGER DEFAULT 0');
    ensureColumn('sites', 'last_status', 'last_status TEXT');
    ensureColumn('sites', 'last_check_at', 'last_check_at TEXT');
    ensureColumn('sites', 'consecutive_failures', 'consecutive_failures INTEGER DEFAULT 0');
    ensureColumn('submissions', 'tracking_token', 'tracking_token TEXT');
    ensureColumn('submissions', 'review_note', 'review_note TEXT');
    ensureColumn('submissions', 'normalized_url', 'normalized_url TEXT');
    ensureColumn('reports', 'detail', 'detail TEXT');
    ensureColumn('reports', 'reporter_ip', 'reporter_ip TEXT');
    ensureColumn('pages', 'status', "status TEXT DEFAULT 'published'");

    // Anyone still on the well-known default password must change it
    db.run("UPDATE users SET must_change_password=1 WHERE password='admin123'");

    // ═══════════════════════════════════════════
    // DEFAULT DATA
    // ═══════════════════════════════════════════

    // Initial admin is created only when INITIAL_ADMIN_PASSWORD is set.
    // The account is flagged must_change_password=1 so the password must be
    // changed on first login. Without the env var no admin is created.
    const userResult = db.exec("SELECT COUNT(*) as count FROM users");
    const userCount = userResult[0]?.values[0][0] || 0;
    if (userCount === 0) {
        const initialPassword = process.env.INITIAL_ADMIN_PASSWORD;
        if (initialPassword) {
            db.run("INSERT INTO users (username, password, role, must_change_password) VALUES ('admin', ?, 'admin', 1)",
                [hashPassword(initialPassword)]);
            console.log('Initial admin created (username: admin) — password change required on first login');
        } else {
            console.warn('未设置 INITIAL_ADMIN_PASSWORD，未创建初始管理员；设置后重启即可创建');
        }
    }

    // Default categories
    const catResult = db.exec("SELECT COUNT(*) as count FROM categories");
    const catCount = catResult[0]?.values[0][0] || 0;
    if (catCount === 0) {
        const cats = [
            ['recommend', '常用推荐', '⭐', 1],
            ['video', '影视资源', '🎬', 2],
            ['anime', '动漫', '🌸', 3],
            ['software', '软件博客', '💿', 4],
            ['tools', '在线工具', '🔧', 5],
            ['news', '资讯', '📰', 6],
            ['community', '社区', '💬', 7],
            ['ai', 'AI 工具', '🤖', 8],
            ['dev', '开发编程', '💻', 9],
            ['design', '设计素材', '🎨', 10],
        ];
        cats.forEach(([id, name, icon, sort]) => {
            db.run("INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)", [id, name, icon, sort]);
        });
        console.log('Default categories created');
    }

    // Default settings
    const settingsResult = db.exec("SELECT COUNT(*) as count FROM settings");
    const settingsCount = settingsResult[0]?.values[0][0] || 0;
    if (settingsCount === 0) {
        const defaults = [
            ['site_name', 'DogNav'],
            ['site_description', '发现互联网的无限精彩'],
            ['site_icon', ''],
            ['weather_api_key', ''],
            ['weather_enabled', 'false'],
            ['footer_text', 'DogNav © 2026 — Design by CangDog'],
            ['footer_blog_url', 'https://www.cangdog.com'],
            ['footer_github_url', 'https://github.com/BYGD'],
            ['theme_primary_color', '#667eea'],
            ['theme_secondary_color', '#764ba2'],
            ['submission_enabled', 'true'],
        ];
        defaults.forEach(([key, value]) => {
            db.run("INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
        });
        console.log('Default settings created');
    }

    // Default pages
    const pagesResult = db.exec("SELECT COUNT(*) as count FROM pages");
    const pagesCount = pagesResult[0]?.values[0][0] || 0;
    if (pagesCount === 0) {
        const pages = [
            ['about', '关于 DogNav', 'DogNav 是一个精选网址导航，收录了互联网上最优质的网站。'],
            ['contribute', '提交站点', '如果你发现了好网站，欢迎提交给我们。'],
            ['links', '友情链接', '以下是与本站有友好往来的网站。'],
        ];
        pages.forEach(([id, title, content]) => {
            db.run("INSERT INTO pages (id, title, content) VALUES (?, ?, ?)", [id, title, content]);
        });
        console.log('Default pages created');
    }

    saveDb();
}

// ═══════════════════════════════════════════
// AUTH MIDDLEWARE — random session tokens stored in the sessions table
// ═══════════════════════════════════════════

function getSession(token) {
    if (!token) return null;
    const result = db.exec(
        `SELECT s.token, s.user_id, s.expires_at, u.role, u.is_active, u.must_change_password
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, [token]);
    if (!result[0] || result[0].values.length === 0) return null;
    const [t, userId, expiresAt, role, isActive, mustChange] = result[0].values[0];
    if (!isActive) return null;
    if (new Date(expiresAt).getTime() < Date.now()) {
        db.run("DELETE FROM sessions WHERE token=?", [token]);
        saveDb();
        return null;
    }
    return { token: t, userId, role, mustChange: !!mustChange };
}

function requireAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    // Force password change before any other API use (login state itself,
    // /api/auth/me, stays reachable so clients can inspect the account)
    if (session.mustChange && req.path !== '/api/auth/password' && req.path !== '/api/auth/me') {
        return res.status(403).json({ error: 'password_change_required' });
    }
    req.userId = session.userId;
    req.userRole = session.role;
    req.sessionToken = session.token;
    next();
}

function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
        if (req.userRole !== 'admin') return res.status(403).json({ error: 'Admin role required' });
        next();
    });
}

// ═══════════════════════════════════════════
// AUTH API
// ═══════════════════════════════════════════

const loginLimiter = createRateLimiter({ maxAttempts: 5, lockMs: 15 * 60 * 1000 });

app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body || {};
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const waitSeconds = loginLimiter.check(ip);
        if (waitSeconds > 0) {
            res.set('Retry-After', String(waitSeconds));
            return res.status(429).json({ error: `Too many login attempts, try again in ${waitSeconds}s` });
        }

        const stmt = db.prepare("SELECT * FROM users WHERE username=? AND is_active=1");
        stmt.bind([String(username || '')]);
        let user = null;
        if (stmt.step()) user = stmt.getAsObject();
        stmt.free();

        if (!user || !verifyPassword(String(password || ''), user.password)) {
            loginLimiter.fail(ip);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Lazy migration: rewrite legacy plaintext password as a hash
        if (!isHashed(user.password)) {
            db.run("UPDATE users SET password=? WHERE id=?", [hashPassword(String(password)), user.id]);
        }

        loginLimiter.reset(ip);
        const token = generateToken();
        const now = Date.now();
        db.run("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            [token, user.id, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString()]);
        // Opportunistic cleanup of expired sessions
        db.run("DELETE FROM sessions WHERE expires_at < ?", [new Date(now).toISOString()]);
        logAction(user.id, 'login', `User ${username} logged in`);
        saveDb();
        res.json({
            success: true,
            token,
            mustChangePassword: !!user.must_change_password,
            user: { id: user.id, username: user.username, role: user.role }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
    try {
        db.run("DELETE FROM sessions WHERE token=?", [req.sessionToken]);
        saveDb();
        res.json({ message: 'Logged out' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Current session's user — reachable even while must_change_password=1 so
// clients can inspect the account before the forced password change
app.get('/api/auth/me', requireAuth, (req, res) => {
    try {
        const result = db.exec("SELECT id, username, role, must_change_password FROM users WHERE id=?", [req.userId]);
        if (!result[0] || result[0].values.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const [id, username, role, mustChange] = result[0].values[0];
        res.json({ id, username, role, mustChangePassword: !!mustChange });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/auth/password', requireAuth, (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body || {};
        if (!newPassword || String(newPassword).length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }
        const stmt = db.prepare("SELECT * FROM users WHERE id=?");
        stmt.bind([req.userId]);
        let user = null;
        if (stmt.step()) user = stmt.getAsObject();
        stmt.free();

        if (!user || !verifyPassword(String(oldPassword || ''), user.password)) {
            return res.status(401).json({ error: 'Old password incorrect' });
        }

        db.run("UPDATE users SET password=?, must_change_password=0 WHERE id=?",
            [hashPassword(String(newPassword)), req.userId]);
        // Invalidate all other sessions of this user; keep the current one
        db.run("DELETE FROM sessions WHERE user_id=? AND token != ?", [req.userId, req.sessionToken]);
        logAction(req.userId, 'change_password', 'Password changed');
        saveDb();
        res.json({ message: 'Password changed' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// SITES API
// ═══════════════════════════════════════════

app.get('/api/sites', (req, res) => {
    try {
        const sort = req.query.sort;
        const orderBy = sort === 'created' ? 'created_at DESC, id DESC' : 'sort_order, category, name';
        const result = db.exec(`SELECT * FROM sites ORDER BY ${orderBy}`);
        const tagsResult = db.exec(`SELECT st.site_id, t.id, t.name, t.color FROM site_tags st JOIN tags t ON t.id = st.tag_id ORDER BY t.name`);
        const tagsBySite = {};
        if (tagsResult[0]) {
            tagsResult[0].values.forEach(([siteId, id, name, color]) => {
                (tagsBySite[siteId] = tagsBySite[siteId] || []).push({ id, name, color });
            });
        }
        res.json(result[0] ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            obj.tags = tagsBySite[obj.id] || [];
            return obj;
        }) : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sites', requireAuth, (req, res) => {
    try {
        const { name, url, description, icon, screenshot, category, sort_order, is_featured, nofollow, seo_title, seo_description } = req.body;
        if (!name || !url || !category) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const stmt = db.prepare(`INSERT INTO sites (name, url, description, icon, screenshot, category, sort_order, is_featured, nofollow, seo_title, seo_description, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
        stmt.run([name, url, description || '', icon || '', screenshot || '', category, sort_order || 0, is_featured || 0, nofollow || 0, seo_title || '', seo_description || '']);
        stmt.free();
        logAction(req.userId, 'create_site', `Created site: ${name}`);
        saveDb();
        const idResult = db.exec("SELECT last_insert_rowid() as id");
        res.json({ id: idResult[0]?.values[0][0] || 0, message: 'Site added' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/sites/:id', requireAuth, (req, res) => {
    try {
        const { name, url, description, icon, screenshot, category, sort_order, is_featured, nofollow, seo_title, seo_description, status } = req.body;
        const stmt = db.prepare(`UPDATE sites SET name=?, url=?, description=?, icon=?, screenshot=?, category=?, sort_order=?, is_featured=?, nofollow=?, seo_title=?, seo_description=?, status=?, updated_at=datetime('now') WHERE id=?`);
        stmt.run([name, url, description || '', icon || '', screenshot || '', category, sort_order || 0, is_featured || 0, nofollow || 0, seo_title || '', seo_description || '', status || 'active', req.params.id]);
        stmt.free();
        logAction(req.userId, 'update_site', `Updated site ID: ${req.params.id}`);
        saveDb();
        res.json({ message: 'Site updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/sites/:id', requireAuth, (req, res) => {
    try {
        db.run("DELETE FROM sites WHERE id=?", [req.params.id]);
        logAction(req.userId, 'delete_site', `Deleted site ID: ${req.params.id}`);
        saveDb();
        res.json({ message: 'Site deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Batch operations
const BATCH_UPDATE_FIELDS = new Set([
    'name', 'url', 'description', 'icon', 'screenshot', 'category',
    'sort_order', 'is_featured', 'nofollow', 'seo_title', 'seo_description', 'status',
]);
app.post('/api/sites/batch', requireAuth, (req, res) => {
    try {
        const { ids, action, data } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'No IDs provided' });
        }

        if (action === 'delete') {
            const placeholders = ids.map(() => '?').join(',');
            db.run(`DELETE FROM sites WHERE id IN (${placeholders})`, ids);
            logAction(req.userId, 'batch_delete', `Deleted ${ids.length} sites`);
        } else if (action === 'update') {
            const fields = Object.keys(data || {});
            for (const f of fields) {
                if (!BATCH_UPDATE_FIELDS.has(f)) {
                    return res.status(400).json({ error: `Invalid field: ${f}` });
                }
            }
            const setClause = fields.map(f => `${f}=?`).join(',');
            const values = fields.map(f => data[f]).concat(ids);
            const placeholders = ids.map(() => '?').join(',');
            db.run(`UPDATE sites SET ${setClause} WHERE id IN (${placeholders})`, values);
            logAction(req.userId, 'batch_update', `Updated ${ids.length} sites`);
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }
        saveDb();
        res.json({ message: `Batch ${action} completed`, count: ids.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Click tracking
app.post('/api/sites/:id/click', (req, res) => {
    try {
        const ip = req.ip || req.connection.remoteAddress;
        const ua = req.headers['user-agent'] || '';
        const ref = req.headers.referer || '';
        
        db.run("UPDATE sites SET click_count = click_count + 1 WHERE id=?", [req.params.id]);
        db.run("INSERT INTO stats (site_id, ip_address, user_agent, referrer) VALUES (?, ?, ?, ?)", [req.params.id, ip, ua, ref]);
        saveDb();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// CATEGORIES API
// ═══════════════════════════════════════════

app.get('/api/categories', (req, res) => {
    try {
        const result = db.exec("SELECT * FROM categories ORDER BY sort_order");
        res.json(result[0] ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        }) : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categories', requireAuth, (req, res) => {
    try {
        const { id, name, icon, sort_order } = req.body;
        if (!id || !name) return res.status(400).json({ error: 'Missing required fields' });
        db.run("INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)", [id, name, icon || '', sort_order || 0]);
        logAction(req.userId, 'create_category', `Created category: ${name}`);
        saveDb();
        res.json({ message: 'Category created' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/categories/:id', requireAuth, (req, res) => {
    try {
        const { name, icon, sort_order, is_active } = req.body;
        db.run("UPDATE categories SET name=?, icon=?, sort_order=?, is_active=? WHERE id=?", [name, icon || '', sort_order || 0, is_active !== undefined ? is_active : 1, req.params.id]);
        logAction(req.userId, 'update_category', `Updated category: ${req.params.id}`);
        saveDb();
        res.json({ message: 'Category updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/categories/all', requireAdmin, (req, res) => {
    try {
        db.run("DELETE FROM sites");
        db.run("DELETE FROM categories");
        logAction(req.userId, 'delete_all_categories', 'Deleted all categories and sites');
        saveDb();
        res.json({ message: 'All categories and sites deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/categories/:id', requireAuth, (req, res) => {
    try {
        db.run("DELETE FROM categories WHERE id=?", [req.params.id]);
        logAction(req.userId, 'delete_category', `Deleted category: ${req.params.id}`);
        saveDb();
        res.json({ message: 'Category deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// TAGS API
// ═══════════════════════════════════════════

app.get('/api/tags', (req, res) => {
    try {
        const result = db.exec("SELECT * FROM tags ORDER BY name");
        res.json(result[0] ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        }) : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tags', requireAuth, (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });
        const dup = db.exec("SELECT id FROM tags WHERE name=?", [name]);
        if (dup[0] && dup[0].values.length) {
            return res.status(409).json({ error: 'Tag name exists' });
        }
        db.run("INSERT INTO tags (name, color) VALUES (?, ?)", [name, color || '#667eea']);
        logAction(req.userId, 'create_tag', `Created tag: ${name}`);
        saveDb();
        res.json({ message: 'Tag created' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/tags/:id', requireAuth, (req, res) => {
    try {
        const result = db.exec("SELECT id, name, color FROM tags WHERE id=?", [req.params.id]);
        if (!result[0] || result[0].values.length === 0) {
            return res.status(404).json({ error: 'Tag not found' });
        }
        const [id, curName, curColor] = result[0].values[0];
        const name = req.body.name !== undefined ? req.body.name : curName;
        const color = req.body.color !== undefined ? req.body.color : curColor;
        if (name !== curName) {
            const dup = db.exec("SELECT id FROM tags WHERE name=? AND id != ?", [name, id]);
            if (dup[0] && dup[0].values.length) {
                return res.status(409).json({ error: 'Tag name exists' });
            }
        }
        db.run("UPDATE tags SET name=?, color=? WHERE id=?", [name, color, id]);
        logAction(req.userId, 'update_tag', `Updated tag ID: ${id}`);
        saveDb();
        res.json({ message: 'Tag updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tags/:id', requireAuth, (req, res) => {
    try {
        const result = db.exec("SELECT id FROM tags WHERE id=?", [req.params.id]);
        if (!result[0] || result[0].values.length === 0) {
            return res.status(404).json({ error: 'Tag not found' });
        }
        db.run("DELETE FROM site_tags WHERE tag_id=?", [req.params.id]);
        db.run("DELETE FROM tags WHERE id=?", [req.params.id]);
        logAction(req.userId, 'delete_tag', `Deleted tag ID: ${req.params.id}`);
        saveDb();
        res.json({ message: 'Tag deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sites/:id/tags', requireAuth, (req, res) => {
    try {
        const { tag_ids } = req.body;
        db.run("DELETE FROM site_tags WHERE site_id=?", [req.params.id]);
        if (tag_ids && Array.isArray(tag_ids)) {
            tag_ids.forEach(tagId => {
                db.run("INSERT INTO site_tags (site_id, tag_id) VALUES (?, ?)", [req.params.id, tagId]);
            });
        }
        saveDb();
        res.json({ message: 'Tags updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// IMPORT/EXPORT API
// ═══════════════════════════════════════════

app.get('/api/export', requireAdmin, (req, res) => {
    try {
        const query = (sql) => {
            const r = db.exec(sql);
            return r[0] ? r[0].values.map(row => {
                const obj = {};
                r[0].columns.forEach((col, i) => obj[col] = row[i]);
                return obj;
            }) : [];
        };
        const sites = query("SELECT * FROM sites");
        const siteTags = query("SELECT site_id, tag_id FROM site_tags");
        const tagsBySite = {};
        siteTags.forEach(st => { (tagsBySite[st.site_id] = tagsBySite[st.site_id] || []).push(st.tag_id); });
        sites.forEach(s => { s.tags = tagsBySite[s.id] || []; });
        // Only publicly safe setting keys are exported — never secrets like
        // weather_api_key. users/sessions/logs/stats details (IPs) are excluded.
        const settings = {};
        query("SELECT key, value FROM settings").forEach(({ key, value }) => {
            if (PUBLIC_SETTING_KEYS.has(key)) settings[key] = value;
        });
        const data = {
            schemaVersion: 2,
            exportDate: new Date().toISOString(),
            sites,
            categories: query("SELECT * FROM categories"),
            tags: query("SELECT * FROM tags"),
            site_tags: siteTags,
            links: query("SELECT * FROM links"),
            pages: query("SELECT * FROM pages"),
            settings,
            clickStats: query("SELECT site_id, COUNT(*) as clicks FROM stats GROUP BY site_id"),
        };
        logAction(req.userId, 'export', 'Database exported');
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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

app.post('/api/import', requireAdmin, (req, res) => {
    try {
        const data = req.body;
        const invalid = validateBackup(data);
        if (invalid) return res.status(400).json({ error: `Invalid backup: ${invalid}` });

        // Only the 10 publicly safe setting keys are imported; the rest are
        // ignored and counted.
        const settingsEntries = data.settings ? Object.entries(data.settings) : [];
        const keptSettings = settingsEntries.filter(([k]) => PUBLIC_SETTING_KEYS.has(k));
        const skippedSettings = settingsEntries.length - keptSettings.length;

        const counts = { sites: 0, categories: 0, tags: 0, links: 0, pages: 0 };
        try {
            db.run("BEGIN");
            if (data.sites) {
                db.run("DELETE FROM sites");
                const stmt = db.prepare(`INSERT INTO sites (id, name, url, description, icon, screenshot, category, sort_order, is_featured, click_count, nofollow, seo_title, seo_description, status, last_status, last_check_at, consecutive_failures)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                data.sites.forEach(s => stmt.run([s.id, s.name, s.url, s.description || '', s.icon || '', s.screenshot || '', s.category,
                    s.sort_order || 0, s.is_featured || 0, s.click_count || 0, s.nofollow || 0, s.seo_title || '', s.seo_description || '',
                    s.status || 'active', s.last_status || null, s.last_check_at || null, s.consecutive_failures || 0]));
                stmt.free();
                counts.sites = data.sites.length;
            }
            if (data.categories) {
                db.run("DELETE FROM categories");
                data.categories.forEach(c => {
                    db.run("INSERT INTO categories (id, name, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?)",
                        [c.id, c.name, c.icon || '', c.sort_order || 0, c.is_active !== undefined ? c.is_active : 1]);
                });
                counts.categories = data.categories.length;
            }
            if (data.tags) {
                db.run("DELETE FROM tags");
                data.tags.forEach(t => {
                    db.run("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)", [t.id, t.name, t.color || '#667eea']);
                });
                counts.tags = data.tags.length;
            }
            if (data.site_tags) {
                db.run("DELETE FROM site_tags");
                data.site_tags.forEach(st => {
                    db.run("INSERT INTO site_tags (site_id, tag_id) VALUES (?, ?)", [st.site_id, st.tag_id]);
                });
            }
            if (data.links) {
                db.run("DELETE FROM links");
                data.links.forEach(l => {
                    db.run("INSERT INTO links (id, name, url, description, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
                        [l.id, l.name, l.url, l.description || '', l.icon || '', l.sort_order || 0]);
                });
                counts.links = data.links.length;
            }
            if (data.pages) {
                db.run("DELETE FROM pages");
                data.pages.forEach(p => {
                    const status = (p.status === 'draft' || p.status === 'published') ? p.status : 'published';
                    db.run("INSERT INTO pages (id, title, content, status) VALUES (?, ?, ?, ?)",
                        [p.id, p.title || '', p.content || '', status]);
                });
                counts.pages = data.pages.length;
            }
            keptSettings.forEach(([key, value]) => setSetting(key, value));
            db.run("COMMIT");
        } catch (txErr) {
            try { db.run("ROLLBACK"); } catch { /* best effort */ }
            return res.status(500).json({ error: 'Import failed, rolled back' });
        }

        logAction(req.userId, 'import', 'Database imported');
        saveDb();
        res.json({ message: 'Import completed', counts, skippedSettings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/import/bookmarks', requireAdmin, (req, res) => {
    try {
        const data = req.body;
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
            return res.status(400).json({ error: 'No bookmarks found' });
        }

        // Fill missing icons with a favicon service
        sites.forEach(site => {
            if (!site.icon) {
                try {
                    site.icon = `https://www.google.com/s2/favicons?domain=${new URL(site.url).hostname}&sz=64`;
                } catch (e) {
                    site.icon = '';
                }
            }
        });

        // Avoid creating duplicates against existing sites
        const existingKeys = new Set();
        const existingResult = db.exec("SELECT url, category FROM sites");
        if (existingResult[0]) {
            existingResult[0].values.forEach(row => existingKeys.add(`${row[0]}|${row[1]}`));
        }

        categories.forEach(cat => {
            db.run("INSERT OR IGNORE INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)", [cat.id, cat.name, cat.icon || '', cat.sort_order || 0]);
        });

        let inserted = 0;
        const insertedSites = [];
        sites.forEach(site => {
            if (existingKeys.has(`${site.url}|${site.category}`)) return;
            db.run("INSERT INTO sites (name, url, description, icon, category, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
                [site.name, site.url, site.description || '', site.icon || '', site.category, site.sort_order || 0]);
            inserted++;
            insertedSites.push(site);
        });

        // Fetch real favicons for imported sites in the background
        (async () => {
            const limit = 5;
            for (let i = 0; i < insertedSites.length; i += limit) {
                const batch = insertedSites.slice(i, i + limit);
                await Promise.all(batch.map(async (site) => {
                    try {
                        const meta = await fetchPageMeta(site.url, new URL(site.url).origin);
                        if (meta.icon && meta.icon.startsWith('http')) {
                            const localPath = await downloadIcon(meta.icon);
                            if (localPath) meta.icon = localPath;
                        }
                        if (meta.icon) {
                            db.run("UPDATE sites SET icon=? WHERE url=? AND category=?", [meta.icon, site.url, site.category]);
                        }
                    } catch (e) {
                        // Ignore fetch failures, keep the fallback icon
                    }
                }));
            }
            saveDb();
        })();

        logAction(req.userId, 'import_bookmarks', `Imported ${inserted} new bookmarks into ${categories.length} categories`);
        saveDb();
        res.json({ message: `Imported ${inserted} bookmarks`, categories: categories.length, sites: inserted });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// FILE UPLOAD API
// ═══════════════════════════════════════════

app.post('/api/upload', requireAuth, (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const ext = path.extname(req.file.originalname || '').toLowerCase();
            if (!hasValidImageMagic(req.file.path, ext)) {
                try { fs.unlinkSync(req.file.path); } catch { /* best effort */ }
                return res.status(400).json({ error: 'Invalid file content' });
            }
            const url = `/uploads/${req.file.filename}`;
            logAction(req.userId, 'upload', `Uploaded: ${req.file.originalname}`);
            res.json({ url, filename: req.file.filename });
        } catch (err2) {
            res.status(500).json({ error: err2.message });
        }
    });
});

// ═══════════════════════════════════════════
// SUBMISSIONS API
// ═══════════════════════════════════════════

app.get('/api/submissions', requireAuth, (req, res) => {
    try {
        const result = db.exec("SELECT * FROM submissions ORDER BY created_at DESC");
        res.json(result[0] ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        }) : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Simple fixed-window rate limiter: max `max` requests per key per hour.
// In-memory — resets on restart, which is acceptable for abuse throttling.
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

function getClientIp(req) {
    return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
}

function categoryExists(id) {
    const r = db.exec("SELECT id FROM categories WHERE id=?", [id]);
    return !!(r[0] && r[0].values.length);
}

// Validate a submission/site URL: http(s) only, host must not be a private
// hostname or private/reserved IP literal (sync check, no DNS — see
// docs/API_CONTRACT.md; the health checker does the full DNS-based check).
function isAllowedPublicUrl(raw) {
    let parsed;
    try { parsed = new URL(String(raw)); } catch { return false; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return !isPrivateHostSync(parsed.hostname);
}

app.post('/api/submissions', (req, res) => {
    try {
        const body = req.body || {};
        // Honeypot: real users never fill the hidden "website" field. Bots get
        // a convincing fake success and nothing is persisted (token included).
        if (body.website) {
            return res.json({ message: 'Submission received', trackingToken: crypto.randomBytes(16).toString('hex') });
        }
        const ip = getClientIp(req);
        if (!submissionLimiter(ip)) {
            return res.status(429).json({ error: 'Too many submissions' });
        }
        const { name, url, description, category, submitter_email } = body;
        if (!name || !url) return res.status(400).json({ error: 'Missing required fields' });
        if (String(name).length > 50) return res.status(400).json({ error: 'Invalid name' });
        if (!isAllowedPublicUrl(url)) return res.status(400).json({ error: 'Invalid URL' });
        if (description && String(description).length > 200) return res.status(400).json({ error: 'Invalid description' });
        if (submitter_email && (String(submitter_email).length > 100 || !SIMPLE_EMAIL_RE.test(String(submitter_email)))) {
            return res.status(400).json({ error: 'Invalid email' });
        }
        if (category && !categoryExists(category)) {
            return res.status(400).json({ error: 'Invalid category' });
        }
        const normalized = normalizeUrl(url);
        const dup = db.exec("SELECT id FROM submissions WHERE normalized_url=? AND status IN ('pending','approved')", [normalized]);
        if (dup[0] && dup[0].values.length) {
            return res.status(409).json({ error: 'Duplicate submission' });
        }
        const trackingToken = crypto.randomBytes(16).toString('hex');
        db.run("INSERT INTO submissions (name, url, description, category, submitter_email, tracking_token, normalized_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [name, url, description || '', category || '', submitter_email || '', trackingToken, normalized]);
        saveDb();
        res.json({ message: 'Submission received', trackingToken });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Public status lookup by tracking token — never leaks submitter_email.
app.get('/api/submissions/status/:token', (req, res) => {
    try {
        const result = db.exec(
            "SELECT name, url, status, review_note, created_at, reviewed_at FROM submissions WHERE tracking_token=?",
            [req.params.token]);
        if (!result[0] || result[0].values.length === 0) {
            return res.status(404).json({ error: 'Not found' });
        }
        const [name, url, status, review_note, created_at, reviewed_at] = result[0].values[0];
        res.json({ name, url, status, review_note, created_at, reviewed_at });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/submissions/:id', requireAuth, (req, res) => {
    try {
        const body = req.body || {};
        const { status } = body;
        const subResult = db.exec("SELECT * FROM submissions WHERE id=?", [req.params.id]);
        let sub = null;
        if (subResult[0] && subResult[0].values.length) {
            sub = {};
            subResult[0].columns.forEach((col, i) => sub[col] = subResult[0].values[0][i]);
        }

        // Editable fields: fall back to the stored values when not provided
        const finalName = body.name !== undefined ? body.name : (sub ? sub.name : '');
        const finalDescription = body.description !== undefined ? body.description : (sub ? sub.description : '');
        const finalCategory = body.category !== undefined ? body.category : (sub ? sub.category : '');
        const finalReviewNote = body.review_note !== undefined ? body.review_note : (sub ? sub.review_note : '');

        if (status === 'approved' && sub) {
            // Re-validate the final data before turning it into a site
            if (!isAllowedPublicUrl(sub.url)) {
                return res.status(400).json({ error: 'Invalid URL' });
            }
            if (!finalCategory || !categoryExists(finalCategory)) {
                return res.status(400).json({ error: 'Invalid category' });
            }
        }

        db.run("UPDATE submissions SET status=?, review_note=?, name=?, description=?, category=?, reviewed_at=datetime('now'), reviewed_by=? WHERE id=?",
            [status, finalReviewNote || '', finalName, finalDescription || '', finalCategory || '', req.userId, req.params.id]);

        if (status === 'approved' && sub) {
            db.run("INSERT INTO sites (name, url, description, icon, category) VALUES (?, ?, ?, ?, ?)",
                [finalName, sub.url, finalDescription || '', body.icon || '', finalCategory]);
        }

        logAction(req.userId, 'review_submission', `Submission ${req.params.id}: ${status}`);
        saveDb();
        res.json({ message: 'Submission updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// REPORTS API
// ═══════════════════════════════════════════

app.get('/api/reports', requireAuth, (req, res) => {
    try {
        const result = db.exec("SELECT r.*, s.name as site_name, s.url as site_url FROM reports r LEFT JOIN sites s ON r.site_id = s.id ORDER BY r.created_at DESC");
        res.json(result[0] ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        }) : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/reports', (req, res) => {
    try {
        const { site_id, reason, reporter_email, detail } = req.body || {};
        if (!site_id || !reason) return res.status(400).json({ error: 'Missing required fields' });
        if (!REPORT_REASONS.has(reason)) return res.status(400).json({ error: 'Invalid reason' });
        if (detail && String(detail).length > 200) return res.status(400).json({ error: 'Invalid detail' });
        const ip = getClientIp(req);
        if (!reportLimiter(ip)) return res.status(429).json({ error: 'Too many reports' });
        // Duplicate suppression: same site + same IP within 24h → pretend
        // success without inserting another row.
        const dup = db.exec(
            "SELECT id FROM reports WHERE site_id=? AND reporter_ip=? AND created_at >= datetime('now', '-24 hours')",
            [site_id, ip]);
        if (dup[0] && dup[0].values.length) {
            return res.json({ message: 'Report received' });
        }
        db.run("INSERT INTO reports (site_id, reason, reporter_email, detail, reporter_ip) VALUES (?, ?, ?, ?, ?)",
            [site_id, reason, reporter_email || '', detail || '', ip]);
        saveDb();
        res.json({ message: 'Report received' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/reports/:id', requireAuth, (req, res) => {
    try {
        const { status } = req.body;
        db.run("UPDATE reports SET status=?, resolved_at=datetime('now'), resolved_by=? WHERE id=?",
            [status, req.userId, req.params.id]);
        
        if (status === 'resolved' && req.body.remove_site) {
            const report = db.exec("SELECT site_id FROM reports WHERE id=?", [req.params.id]);
            if (report[0]) {
                const siteId = report[0].values[0][0];
                db.run("UPDATE sites SET status='inactive' WHERE id=?", [siteId]);
            }
        }
        
        logAction(req.userId, 'resolve_report', `Report ${req.params.id}: ${status}`);
        saveDb();
        res.json({ message: 'Report updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// STATS API
// ═══════════════════════════════════════════

app.get('/api/stats/overview', requireAuth, (req, res) => {
    try {
        const totalSites = db.exec("SELECT COUNT(*) FROM sites")[0]?.values[0][0] || 0;
        const totalClicks = db.exec("SELECT SUM(click_count) FROM sites")[0]?.values[0][0] || 0;
        const pendingSubmissions = db.exec("SELECT COUNT(*) FROM submissions WHERE status='pending'")[0]?.values[0][0] || 0;
        const pendingReports = db.exec("SELECT COUNT(*) FROM reports WHERE status='pending'")[0]?.values[0][0] || 0;
        const activeSites = db.exec("SELECT COUNT(*) FROM sites WHERE status='active'")[0]?.values[0][0] || 0;

        res.json({
            totalSites,
            totalClicks,
            pendingSubmissions,
            pendingReports,
            activeSites,
            pending_submissions: pendingSubmissions,
            pending_reports: pendingReports
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/stats/popular', requireAuth, (req, res) => {
    try {
        const result = db.exec("SELECT id, name, url, click_count FROM sites ORDER BY click_count DESC LIMIT 10");
        res.json(result[0] ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        }) : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/stats/category-distribution', requireAuth, (req, res) => {
    try {
        const result = db.exec("SELECT c.name, COUNT(s.id) as count FROM categories c LEFT JOIN sites s ON c.id = s.category GROUP BY c.id ORDER BY count DESC");
        res.json(result[0] ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        }) : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// LOGS API
// ═══════════════════════════════════════════

app.get('/api/logs', requireAdmin, (req, res) => {
    try {
        const result = db.exec("SELECT l.*, u.username FROM logs l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC LIMIT 100");
        res.json(result[0] ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        }) : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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
function applySettingsUpdate(body, userId) {
    const entries = Object.entries(body || {});
    for (const [key] of entries) {
        if (!WRITABLE_SETTING_KEYS.has(key)) {
            return `Invalid setting key: ${key}`;
        }
    }
    entries.forEach(([key, value]) => setSetting(key, normalizeSettingValue(key, value)));
    logAction(userId, 'update_settings', 'Settings updated');
    saveDb();
    return null;
}

function getAllSettings() {
    const result = db.exec("SELECT key, value FROM settings");
    const settings = {};
    if (result[0]) {
        result[0].values.forEach(([key, value]) => settings[key] = value);
    }
    return settings;
}

app.get('/api/settings', (req, res) => {
    try {
        const all = getAllSettings();
        const settings = {};
        Object.entries(all).forEach(([key, value]) => {
            if (PUBLIC_SETTING_KEYS.has(key)) settings[key] = value;
        });
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Full settings (including secrets) for the admin panel
app.get('/api/admin/settings', requireAdmin, (req, res) => {
    try {
        res.json(getAllSettings());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
    try {
        const err = applySettingsUpdate(req.body, req.userId);
        if (err) return res.status(400).json({ error: err });
        res.json({ message: 'Settings updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Deprecated alias kept for backward compatibility. Use PUT /api/admin/settings.
app.put('/api/settings', requireAdmin, (req, res) => {
    try {
        const err = applySettingsUpdate(req.body, req.userId);
        if (err) return res.status(400).json({ error: err });
        res.set('Deprecation', 'true');
        res.set('Sunset', 'Sat, 01 Jan 2028 00:00:00 GMT');
        res.json({ message: 'Settings updated', deprecated: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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

app.post('/api/weather', async (req, res) => {
    try {
        const { lat, lon } = req.body || {};
        const nLat = Number(lat);
        const nLon = Number(lon);
        if (!Number.isFinite(nLat) || !Number.isFinite(nLon) ||
            nLat < -90 || nLat > 90 || nLon < -180 || nLon > 180) {
            return res.status(400).json({ error: 'Invalid coordinates' });
        }
        if (getSetting('weather_enabled') !== 'true') {
            return res.status(404).json({ error: 'Weather disabled' });
        }
        const apiKey = process.env.WEATHER_API_KEY;
        if (!apiKey) {
            return res.status(503).json({ error: 'Weather not configured' });
        }

        const cacheKey = `${nLat.toFixed(1)},${nLon.toFixed(1)}`;
        const nowTs = Date.now();
        const cached = weatherCache.get(cacheKey);
        if (cached && cached.expires > nowTs) return res.json(cached.data);

        let data;
        try {
            data = await fetchQWeather(nLat, nLon, apiKey);
        } catch {
            return res.status(502).json({ error: 'Weather upstream error' });
        }
        weatherCache.set(cacheKey, { data, expires: nowTs + WEATHER_CACHE_TTL_MS });
        // Opportunistic cleanup of expired entries
        for (const [k, v] of weatherCache) {
            if (v.expires <= nowTs) weatherCache.delete(k);
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// PAGES API
// ═══════════════════════════════════════════

// Public: only published pages are visible
app.get('/api/pages', (req, res) => {
    try {
        const result = db.exec("SELECT * FROM pages WHERE status='published' ORDER BY id");
        res.json(result[0] ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        }) : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: all pages including drafts
app.get('/api/admin/pages', requireAuth, (req, res) => {
    try {
        const result = db.exec("SELECT * FROM pages ORDER BY id");
        res.json(result[0] ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        }) : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pages/:id', (req, res) => {
    try {
        const result = db.exec("SELECT * FROM pages WHERE id = ? AND status='published'", [req.params.id]);
        if (!result[0] || result[0].values.length === 0) {
            return res.status(404).json({ error: 'Page not found' });
        }
        const obj = {};
        result[0].columns.forEach((col, i) => obj[col] = result[0].values[0][i]);
        res.json(obj);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/pages/:id', requireAuth, (req, res) => {
    try {
        const { title, content, status } = req.body;
        if (status !== undefined && status !== 'draft' && status !== 'published') {
            return res.status(400).json({ error: 'Invalid status' });
        }
        db.run("UPDATE pages SET title=COALESCE(?, title), content=COALESCE(?, content), status=COALESCE(?, status), updated_at=datetime('now') WHERE id=?",
            [title ?? null, content ?? null, status ?? null, req.params.id]);
        logAction(req.userId, 'update_page', `Updated page: ${req.params.id}`);
        saveDb();
        res.json({ message: 'Page updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pages', requireAuth, (req, res) => {
    try {
        const { id, title, content, status } = req.body;
        if (!id || !title) return res.status(400).json({ error: 'Missing required fields (id, title)' });
        if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Invalid page ID (a-z, 0-9, hyphens only)' });
        if (status !== undefined && status !== 'draft' && status !== 'published') {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const existing = db.exec("SELECT id FROM pages WHERE id=?", [id]);
        if (existing[0] && existing[0].values.length) {
            return res.status(409).json({ error: 'Page ID exists' });
        }
        db.run("INSERT INTO pages (id, title, content, status) VALUES (?, ?, ?, ?)",
            [id, title, content || '', status || 'published']);
        logAction(req.userId, 'create_page', `Created page: ${id}`);
        saveDb();
        res.status(201).json({ message: 'Page created', id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/pages/:id', requireAuth, (req, res) => {
    try {
        const existing = db.exec("SELECT id FROM pages WHERE id=?", [req.params.id]);
        if (!existing[0] || existing[0].values.length === 0) {
            return res.status(404).json({ error: 'Page not found' });
        }
        db.run("DELETE FROM pages WHERE id=?", [req.params.id]);
        logAction(req.userId, 'delete_page', `Deleted page: ${req.params.id}`);
        saveDb();
        res.json({ message: 'Page deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// LINKS API
// ═══════════════════════════════════════════

app.get('/api/links', (req, res) => {
    try {
        const result = db.exec("SELECT * FROM links ORDER BY sort_order, name");
        res.json(result[0] ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        }) : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/links', requireAuth, (req, res) => {
    try {
        const { name, url, description, icon, sort_order } = req.body;
        if (!name || !url) return res.status(400).json({ error: 'Missing required fields' });
        db.run("INSERT INTO links (name, url, description, icon, sort_order) VALUES (?, ?, ?, ?, ?)",
            [name, url, description || '', icon || '', sort_order || 0]);
        logAction(req.userId, 'create_link', `Created link: ${name}`);
        saveDb();
        res.json({ message: 'Link added' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/links/:id', requireAuth, (req, res) => {
    try {
        const { name, url, description, icon, sort_order } = req.body;
        db.run("UPDATE links SET name=?, url=?, description=?, icon=?, sort_order=? WHERE id=?",
            [name, url, description || '', icon || '', sort_order || 0, req.params.id]);
        logAction(req.userId, 'update_link', `Updated link ID: ${req.params.id}`);
        saveDb();
        res.json({ message: 'Link updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/links/:id', requireAuth, (req, res) => {
    try {
        db.run("DELETE FROM links WHERE id=?", [req.params.id]);
        logAction(req.userId, 'delete_link', `Deleted link ID: ${req.params.id}`);
        saveDb();
        res.json({ message: 'Link deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// FETCH ICON API
// ═══════════════════════════════════════════

const https = require('https');
const http = require('http');

app.get('/api/fetch-icon', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    try {
        const origin = new URL(url).origin;
        const meta = await fetchPageMeta(url, origin);
        // Localize the icon so the frontend doesn't depend on third-party servers
        if (meta.icon && meta.icon.startsWith('http')) {
            const localPath = await downloadIcon(meta.icon);
            if (localPath) meta.icon = localPath;
        }
        res.json(meta);
    } catch (err) {
        res.json({ icon: '', title: '', description: '' });
    }
});

function fetchPageMeta(pageUrl, origin) {
    return new Promise((resolve) => {
        const mod = pageUrl.startsWith('https') ? https : http;
        const req = mod.get(pageUrl, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
            if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                const newOrigin = new URL(resp.headers.location).origin;
                fetchPageMeta(resp.headers.location, newOrigin).then(resolve).catch(() => resolve({ icon: origin + '/favicon.ico', title: '', description: '' }));
                return;
            }
            let html = '';
            resp.on('data', chunk => {
                html += chunk;
                if (html.length > 50000) { resp.destroy(); resolve(parseMeta(html, origin)); }
            });
            resp.on('end', () => resolve(parseMeta(html, origin)));
            resp.on('error', () => resolve({ icon: origin + '/favicon.ico', title: '', description: '' }));
        });
        req.on('error', () => resolve({ icon: origin + '/favicon.ico', title: '', description: '' }));
        req.on('timeout', () => { req.destroy(); resolve({ icon: origin + '/favicon.ico', title: '', description: '' }); });
    });
}

function parseMeta(html, origin) {
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

    return { icon, title, description };
}

// ═══════════════════════════════════════════
// ICON LOCALIZATION
// ═══════════════════════════════════════════

const crypto = require('crypto');
const ICON_DIR = path.join(UPLOAD_DIR, 'icons');
if (!fs.existsSync(ICON_DIR)) {
    fs.mkdirSync(ICON_DIR, { recursive: true });
}

const ICON_EXT_BY_MIME = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
};

// Download a remote icon into uploads/icons, return local path (or null on failure)
function downloadIcon(iconUrl, redirects = 0) {
    return new Promise((resolve) => {
        if (!iconUrl.startsWith('http') || redirects > 3) return resolve(null);
        let referer;
        try { referer = new URL(iconUrl).origin + '/'; } catch { return resolve(null); }
        const mod = iconUrl.startsWith('https') ? https : http;
        const req = mod.get(iconUrl, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': referer } }, (resp) => {
            if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                resp.resume();
                let next;
                try { next = new URL(resp.headers.location, iconUrl).href; } catch { return resolve(null); }
                return resolve(downloadIcon(next, redirects + 1));
            }
            if (resp.statusCode !== 200) { resp.resume(); return resolve(null); }
            const mime = (resp.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            let ext = ICON_EXT_BY_MIME[mime];
            if (!ext) {
                try {
                    const urlExt = path.extname(new URL(iconUrl).pathname).toLowerCase();
                    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'].includes(urlExt)) ext = urlExt === '.jpeg' ? '.jpg' : urlExt;
                } catch { /* keep ext undefined */ }
            }
            if (!ext) { resp.resume(); return resolve(null); }
            const chunks = [];
            let size = 0;
            resp.on('data', chunk => {
                size += chunk.length;
                if (size > 500 * 1024) { resp.destroy(); resolve(null); return; }
                chunks.push(chunk);
            });
            resp.on('end', () => {
                try {
                    if (!size) return resolve(null);
                    const name = crypto.createHash('md5').update(iconUrl).digest('hex') + ext;
                    fs.writeFileSync(path.join(ICON_DIR, name), Buffer.concat(chunks));
                    resolve(`/uploads/icons/${name}`);
                } catch { resolve(null); }
            });
            resp.on('error', () => resolve(null));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

// One-off repair: localize all externally hosted icons in sites/links
app.post('/api/admin/localize-icons', requireAdmin, async (req, res) => {
    try {
        const stats = { sites: { ok: 0, fail: 0 }, links: { ok: 0, fail: 0 } };
        for (const table of ['sites', 'links']) {
            const rows = db.exec(`SELECT id, icon FROM ${table} WHERE icon LIKE 'http%'`);
            const entries = rows[0]?.values || [];
            for (const [id, icon] of entries) {
                let localPath = null;
                try { localPath = await downloadIcon(icon); } catch { localPath = null; }
                if (localPath) {
                    db.run(`UPDATE ${table} SET icon=? WHERE id=?`, [localPath, id]);
                    stats[table].ok++;
                } else {
                    stats[table].fail++;
                }
            }
        }
        saveDb();
        logAction(req.userId, 'localize_icons', `sites ${stats.sites.ok} ok/${stats.sites.fail} fail, links ${stats.links.ok} ok/${stats.links.fail} fail`);
        res.json({ message: 'Done', ...stats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// USERS API
// ═══════════════════════════════════════════

app.get('/api/users', requireAdmin, (req, res) => {
    try {
        const result = db.exec("SELECT id, username, role, is_active, created_at FROM users ORDER BY id");
        res.json(result[0] ? result[0].values.map(row => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        }) : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', requireAdmin, (req, res) => {
    try {
        const { username, password, role } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Missing required fields' });
        if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
        db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", [username, hashPassword(String(password)), role || 'editor']);
        logAction(req.userId, 'create_user', `Created user: ${username}`);
        saveDb();
        res.json({ message: 'User created' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
    try {
        const { role, is_active } = req.body;
        const id = parseInt(req.params.id, 10);
        const result = db.exec("SELECT id, role, is_active FROM users WHERE id=?", [id]);
        if (!result[0] || result[0].values.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const [, curRole, curActive] = result[0].values[0];
        const newRole = role !== undefined ? role : curRole;
        const newActive = is_active !== undefined ? is_active : curActive;
        // Prevent disabling/demoting the last active admin to avoid lockout
        if (curRole === 'admin' && curActive === 1 && (newRole !== 'admin' || Number(newActive) === 0)) {
            const countResult = db.exec("SELECT COUNT(*) as count FROM users WHERE role='admin' AND is_active=1 AND id != ?", [id]);
            const otherAdmins = countResult[0]?.values[0][0] || 0;
            if (otherAdmins === 0) {
                return res.status(403).json({ error: 'Cannot disable the last active admin' });
            }
        }
        db.run("UPDATE users SET role=?, is_active=? WHERE id=?", [newRole, newActive, id]);
        logAction(req.userId, 'update_user', `Updated user ID: ${req.params.id}`);
        saveDb();
        res.json({ message: 'User updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users/:id/reset-password', requireAdmin, (req, res) => {
    try {
        const { newPassword } = req.body || {};
        if (!newPassword || String(newPassword).length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }
        const id = parseInt(req.params.id, 10);
        const result = db.exec("SELECT id FROM users WHERE id=?", [id]);
        if (!result[0] || result[0].values.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        db.run("UPDATE users SET password=?, must_change_password=1 WHERE id=?", [hashPassword(String(newPassword)), id]);
        // Invalidate every session of the reset user
        db.run("DELETE FROM sessions WHERE user_id=?", [id]);
        logAction(req.userId, 'reset_password', `Reset password for user ID: ${id}`);
        saveDb();
        res.json({ message: 'Password reset' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        // Prevent deleting the last active admin to avoid lockout
        const countResult = db.exec("SELECT COUNT(*) as count FROM users WHERE role='admin' AND is_active=1 AND id != ?", [id]);
        const otherAdmins = countResult[0]?.values[0][0] || 0;
        if (otherAdmins === 0) {
            return res.status(403).json({ error: 'Cannot delete the last active admin' });
        }
        db.run("DELETE FROM users WHERE id=?", [id]);
        logAction(req.userId, 'delete_user', `Deleted user ID: ${id}`);
        saveDb();
        res.json({ message: 'User deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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
// results. The single async/await flow also guarantees the completion path
// runs exactly once (no double-finish from timeout + error races).
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
        if (await isPrivateHost(parsed.hostname)) {
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

app.post('/api/health-check', requireAuth, async (req, res) => {
    try {
        const { siteIds } = req.body || {};
        // Missing/empty (including the legacy {urls:[...]} shape) → no-op
        if (!Array.isArray(siteIds) || siteIds.length === 0) {
            return res.json({ results: [] });
        }
        if (siteIds.length > 50) {
            return res.status(400).json({ error: 'Too many site IDs' });
        }
        const ids = [...new Set(siteIds.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n)))];
        if (ids.length === 0) return res.json({ results: [] });

        const placeholders = ids.map(() => '?').join(',');
        const rowsResult = db.exec(`SELECT * FROM sites WHERE id IN (${placeholders})`, ids);
        const sites = (rowsResult[0] ? rowsResult[0].values : []).map(row => {
            const obj = {};
            rowsResult[0].columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        });

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
                db.run("UPDATE sites SET last_status=?, last_check_at=datetime('now'), consecutive_failures=0 WHERE id=?",
                    [probe.status, site.id]);
                result.consecutive_failures = 0;
            } else {
                const failures = (site.consecutive_failures || 0) + 1;
                // Only flip last_status to offline after 3 consecutive failures;
                // before that the previous last_status is kept.
                if (failures >= 3) {
                    db.run("UPDATE sites SET last_status='offline', last_check_at=datetime('now'), consecutive_failures=? WHERE id=?",
                        [failures, site.id]);
                } else {
                    db.run("UPDATE sites SET last_check_at=datetime('now'), consecutive_failures=? WHERE id=?",
                        [failures, site.id]);
                }
                result.consecutive_failures = failures;
            }
            return result;
        });

        saveDb();
        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// SERVE ADMIN PAGES
// ═══════════════════════════════════════════

const ADMIN_DIR = path.join(__dirname, 'public', 'admin');
app.get('/admin', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'index.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'dashboard.html')));
app.get('/admin/settings', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'settings.html')));
app.get('/admin/pages', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'pages.html')));
app.get('/admin/links', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'links.html')));
app.get('/admin/categories', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'categories.html')));
app.get('/admin/submissions', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'submissions.html')));
app.get('/admin/reports', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'reports.html')));
app.get('/admin/health', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'health.html')));
app.get('/admin/stats', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'stats.html')));
app.get('/admin/logs', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'logs.html')));
app.get('/admin/users', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'users.html')));
app.get('/admin/backup', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'backup.html')));

// Start server
async function start(port = PORT) {
    await initDb();
    const server = app.listen(port, () => {
        const actual = server.address().port;
        console.log(`Server running at http://localhost:${actual}`);
        console.log(`Admin panel: http://localhost:${actual}/admin`);
    });
    return server;
}

if (require.main === module) {
    start().catch(err => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
}

module.exports = { app, start };
