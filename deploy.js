#!/usr/bin/env node

/**
 * DogNav Cloudflare 可信发布脚本（根目录，唯一实现）
 *
 * cloudflare/deploy.js 只是转发到本脚本的兼容入口。
 *
 * 使用方法:
 *   git clone https://github.com/BYGD/dog-nav.git
 *   cd dog-nav
 *   npm install
 *   npm run deploy:cf
 *
 * 发布流程（任何关键步骤失败都会以非零退出码终止，绝不误报"部署成功"）:
 *   1. 安装依赖
 *   2. 检查/登录 Cloudflare
 *   3. 部署前门禁: npm test + 双运行时契约测试（CONTRACT_TARGET=both）
 *   4. 创建/发现 D1 数据库（CLI 优先，CLOUDFLARE_API_TOKEN REST 兜底）
 *   5. 同步根目录与 cloudflare/ 两个 wrangler.toml 的 database_id
 *   6. 记录部署前当前活动版本 id（尽力而为，用于自动回滚）
 *   7. wrangler deploy，并从输出解析真实 workers.dev 地址
 *      （可用环境变量 DEPLOY_VERIFY_URL 覆盖）
 *   8. 部署后验证:
 *      - 核心冒烟（/ 、/api/settings、未知热榜源 400）失败 → 自动回滚并退出非零
 *      - 六个外部热榜源验证（失败重试三轮，间隔可用 DEPLOY_VERIFY_RETRY_MS 覆盖）
 *        三轮后仍失败 → 打印诊断、退出非零，但不回滚
 *
 * 可选: 导入完整 150+ 站点数据
 *   npm run db:seed
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DB_NAME = 'dognav';
const TOML_PATHS = [
    path.join(ROOT, 'wrangler.toml'),
    path.join(ROOT, 'cloudflare', 'wrangler.toml'),
];
const HOT_SOURCES = ['zhihu', 'weibo', 'bilibili', 'ithome', '36kr', 'sspai'];
const DEFAULT_RETRY_MS = 10000;
const SOURCE_VERIFY_ROUNDS = 3;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 命令执行器 ──────────────────────────────────────────────────────────────
// 默认失败即抛错（带 stdout/stderr 摘要）。只有明确的探测步骤才传
// { allowFailure: true }：whoami（判断是否登录）、d1 list（发现数据库）、
// deployments list（部署前保存版本，尽力而为）。
function createRun(execImpl = execSync, { cwd = ROOT, log = console.log } = {}) {
    return function run(cmd, opts = {}) {
        const { allowFailure = false, ...execOpts } = opts;
        log(`\n> ${cmd}`);
        try {
            const out = execImpl(cmd, { cwd, encoding: 'utf8', stdio: 'pipe', ...execOpts });
            return out == null ? '' : String(out).trim();
        } catch (err) {
            const stdout = (err.stdout || '').toString().trim();
            const stderr = (err.stderr || '').toString().trim();
            const combined = [stdout, stderr].filter(Boolean).join('\n');
            if (allowFailure) return combined;
            const summary = combined.split('\n').slice(-20).join('\n');
            throw new Error(`命令执行失败: ${cmd}\n${summary}`);
        }
    };
}

const run = createRun();

function step(msg) {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  ${msg}`);
    console.log('═'.repeat(50));
}

// ─── 从 wrangler deploy 输出提取真实 workers.dev URL ─────────────────────────
function extractWorkerUrl(text) {
    const m = String(text || '').match(/https:\/\/[\w-]+\.[\w-]+\.workers\.dev/);
    return m ? m[0] : null;
}

// ─── 从 wrangler deployments list --json 输出取最新一条版本 id ───────────────
function extractLatestDeploymentId(jsonText) {
    try {
        const list = JSON.parse(jsonText);
        if (!Array.isArray(list) || list.length === 0) return null;
        // 有 created_on 时按时间取最新，否则取数组最后一条
        const latest = list.every((v) => v.created_on)
            ? list.reduce((a, b) => (a.created_on > b.created_on ? a : b))
            : list[list.length - 1];
        return latest.id || null;
    } catch {
        return null;
    }
}

// ─── 部署后验证器 ────────────────────────────────────────────────────────────
async function request(fetchImpl, url) {
    try {
        const res = await fetchImpl(url);
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
        const contentType = (res.headers && typeof res.headers.get === 'function')
            ? (res.headers.get('content-type') || '')
            : '';
        return { status: res.status, contentType, json, text };
    } catch (err) {
        return { error: err.message };
    }
}

function summarize(text) {
    return String(text || '').replace(/\s+/g, ' ').slice(0, 120);
}

function checkSourceResult(source, res) {
    if (res.error) return `请求失败: ${res.error}`;
    if (res.status !== 200) return `HTTP ${res.status}: ${summarize(res.text)}`;
    if (!res.json || typeof res.json !== 'object' || Array.isArray(res.json)) {
        return `响应不是 JSON 对象: ${summarize(res.text)}`;
    }
    if (res.json.source !== source) {
        return `source 字段不匹配: 期望 "${source}"，实际 ${JSON.stringify(res.json.source)}`;
    }
    if (!Array.isArray(res.json.items) || res.json.items.length < 5) {
        const n = Array.isArray(res.json.items) ? res.json.items.length : '无 items 数组';
        return `热榜条目不足 5 条（实际: ${n}）`;
    }
    return null;
}

// 返回 verify(baseUrl) → { coreFailures: string[], sourceFailures: { source: 诊断 } }
// coreFailures 非空 → 调用方应回滚；sourceFailures 非空 → 报错退出但不回滚。
function createVerifier({
    fetchImpl = fetch,
    retryDelayMs = DEFAULT_RETRY_MS,
    sources = HOT_SOURCES,
    sleepImpl = sleep,
} = {}) {
    return async function verify(baseUrl) {
        const coreFailures = [];

        // a. 首页: 200 + text/html
        const home = await request(fetchImpl, `${baseUrl}/`);
        if (home.error) {
            coreFailures.push(`GET / 请求失败: ${home.error}`);
        } else {
            if (home.status !== 200) coreFailures.push(`GET / 期望 200，实际 ${home.status}`);
            if (!home.contentType.includes('text/html')) {
                coreFailures.push(`GET / Content-Type 期望 text/html，实际 "${home.contentType || '(无)'}"`);
            }
        }

        // b. /api/settings: 200 + JSON 对象
        const settings = await request(fetchImpl, `${baseUrl}/api/settings`);
        if (settings.error) {
            coreFailures.push(`GET /api/settings 请求失败: ${settings.error}`);
        } else {
            if (settings.status !== 200) coreFailures.push(`GET /api/settings 期望 200，实际 ${settings.status}`);
            if (!settings.json || typeof settings.json !== 'object' || Array.isArray(settings.json)) {
                coreFailures.push(`GET /api/settings 响应不是 JSON 对象: ${summarize(settings.text)}`);
            }
        }

        // c. 未知热榜源必须 400
        const unknown = await request(fetchImpl, `${baseUrl}/api/hot/not-a-source`);
        if (unknown.error) {
            coreFailures.push(`GET /api/hot/not-a-source 请求失败: ${unknown.error}`);
        } else if (unknown.status !== 400) {
            coreFailures.push(`GET /api/hot/not-a-source 期望 400，实际 ${unknown.status}`);
        }

        // 外部热榜源: 失败的源间隔重试共三轮
        const sourceFailures = {};
        let pending = [...sources];
        for (let round = 1; round <= SOURCE_VERIFY_ROUNDS && pending.length > 0; round++) {
            const stillFailing = [];
            for (const source of pending) {
                const res = await request(fetchImpl, `${baseUrl}/api/hot/${source}`);
                const problem = checkSourceResult(source, res);
                if (problem) {
                    sourceFailures[source] = problem; // 保留最近一次诊断
                    stillFailing.push(source);
                } else {
                    delete sourceFailures[source];
                }
            }
            pending = stillFailing;
            if (pending.length > 0 && round < SOURCE_VERIFY_ROUNDS) {
                await sleepImpl(retryDelayMs);
            }
        }

        return { coreFailures, sourceFailures };
    };
}

// 回滚决策: 只有核心冒烟失败才回滚，外部源失败不回滚
function shouldRollback(verifyResult) {
    return verifyResult.coreFailures.length > 0;
}

// ─── D1 REST 兜底创建 ────────────────────────────────────────────────────────
async function createD1ViaAPI() {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) {
        console.log('  未检测到 CLOUDFLARE_API_TOKEN，跳过 API 方式');
        return null;
    }

    try {
        const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

        // 获取 Account ID
        const acctResp = await fetch('https://api.cloudflare.com/client/v4/accounts', { headers });
        const acctData = await acctResp.json();

        if (!acctData.success || !acctData.result || acctData.result.length === 0) {
            console.log('  无法获取 Account ID');
            return null;
        }

        const accountId = acctData.result[0].id;
        const accountName = acctData.result[0].name;
        console.log(`  Account: ${accountName} (${accountId})`);

        // 检查数据库是否已存在
        const dbResp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, { headers });
        const dbData = await dbResp.json();

        const existing = dbData.result?.find(db => db.name === DB_NAME);
        if (existing) {
            console.log(`  数据库已存在: ${existing.uuid}`);
            return existing.uuid;
        }

        // 创建新数据库
        const createResp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: DB_NAME })
        });
        const createData = await createResp.json();

        if (createData.success && createData.result?.uuid) {
            console.log(`  数据库已创建 (API): ${createData.result.uuid}`);
            return createData.result.uuid;
        }

        console.log('  API 创建失败:', JSON.stringify(createData.errors));
        return null;
    } catch (e) {
        console.log('  API 异常:', e.message);
        return null;
    }
}

// ─── 同步两个 wrangler.toml 的 database_id ──────────────────────────────────
function updateTomlDbId(tomlPath, dbId) {
    if (!fs.existsSync(tomlPath)) return false;
    let toml = fs.readFileSync(tomlPath, 'utf8');
    if (/database_id\s*=\s*".*"/.test(toml)) {
        toml = toml.replace(/database_id\s*=\s*".*"/, `database_id = "${dbId}"`);
    } else {
        toml = toml.replace(
            /(database_name\s*=\s*"dognav")/,
            `$1\ndatabase_id = "${dbId}"`
        );
    }
    fs.writeFileSync(tomlPath, toml);
    return true;
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n🐕 DogNav Cloudflare 可信发布\n');

    // ─── Step 1: Install deps ───
    step('Step 1/8: 安装依赖');
    if (!fs.existsSync(path.join(ROOT, 'node_modules', 'hono'))) {
        console.log('安装依赖中...');
        run('npm install', { stdio: 'inherit' });
    }
    console.log('✓ 依赖已就绪');

    // ─── Step 2: Check auth ───
    step('Step 2/8: 检查 Cloudflare 认证');
    const whoami = run('npx wrangler whoami', { allowFailure: true });
    if (whoami.includes('not logged in') || whoami.includes('Error') || !whoami.includes('@')) {
        console.log('需要登录 Cloudflare...');
        console.log('即将打开浏览器，请在浏览器中完成登录。\n');
        run('npx wrangler login', { stdio: 'inherit' });
    }
    console.log('✓ Cloudflare 认证通过');

    // ─── Step 3: Pre-deploy gates ───
    step('Step 3/8: 部署前门禁（测试）');
    run('npm test', { stdio: 'inherit' });
    console.log('✓ 单元/API 测试通过');
    run('npm run test:contract', {
        stdio: 'inherit',
        env: { ...process.env, CONTRACT_TARGET: 'both' },
    });
    console.log('✓ 双运行时契约测试通过（wrangler 不可用时自动 skip）');

    // ─── Step 4: Create D1 database ───
    step('Step 4/8: 创建 D1 数据库');
    let dbId = '';

    // 方式 1: wrangler CLI
    const dbList = run('npx wrangler d1 list', { allowFailure: true });
    // wrangler d1 list 的表格输出中 uuid 列在 name 之前，取包含数据库名的那一行里的 uuid
    const dbLine = dbList.split('\n').find(line => line.includes(DB_NAME));
    const dbMatch = dbLine && dbLine.match(/([a-f0-9-]{36})/i);

    if (dbMatch) {
        dbId = dbMatch[1];
        console.log(`✓ 数据库已存在: ${DB_NAME} (${dbId})`);
    } else {
        console.log(`创建新数据库: ${DB_NAME}`);
        let createOut = '';
        try {
            createOut = run(`npx wrangler d1 create ${DB_NAME}`);
        } catch (e) {
            console.log(`  wrangler CLI 创建失败: ${e.message}`);
        }
        const idMatch = createOut.match(/database_id\s*=\s*"([a-f0-9-]{36})"/);

        if (idMatch) {
            dbId = idMatch[1];
            console.log(`✓ 数据库已创建 (CLI): ${dbId}`);
        } else {
            // 方式 2: REST API fallback
            console.log('\n  尝试通过 Cloudflare API 创建...');
            dbId = await createD1ViaAPI();

            if (!dbId) {
                throw new Error(
                    '无法创建 D1 数据库。请手动执行:\n' +
                    '    npx wrangler d1 create dognav\n' +
                    '  然后将 database_id 复制到 wrangler.toml'
                );
            }
        }
    }

    // ─── Step 5: Update wrangler.toml (both copies stay in sync) ───
    step('Step 5/8: 更新配置');
    for (const p of TOML_PATHS) {
        if (updateTomlDbId(p, dbId)) {
            console.log(`✓ ${path.relative(ROOT, p)} 已更新 (database_id = ${dbId})`);
        }
    }

    // ─── Step 6: Save current active version for rollback ───
    step('Step 6/8: 记录当前部署版本（用于回滚）');
    let previousVersionId = null;
    const deployments = run('npx wrangler deployments list --json', { allowFailure: true });
    previousVersionId = extractLatestDeploymentId(deployments);
    if (previousVersionId) {
        console.log(`✓ 当前活动版本: ${previousVersionId}`);
    } else {
        console.log('⚠ 无法获取当前版本 id（可能从未部署过），自动回滚将降级为不带 id 的 wrangler rollback');
    }

    // ─── Step 7: Deploy ───
    step('Step 7/8: 部署到 Cloudflare');
    const deployOut = run('npx wrangler deploy');
    if (deployOut) console.log(deployOut);

    const verifyUrl = process.env.DEPLOY_VERIFY_URL || extractWorkerUrl(deployOut);
    if (!verifyUrl) {
        throw new Error(
            '无法确定部署后的真实地址：wrangler deploy 输出中未找到 workers.dev URL。\n' +
            '请通过环境变量 DEPLOY_VERIFY_URL 指定后重试。'
        );
    }
    console.log(`✓ 部署完成，验证地址: ${verifyUrl}`);

    // ─── Step 8: Post-deploy verification ───
    step('Step 8/8: 部署后验证');
    const retryDelayMs = Number(process.env.DEPLOY_VERIFY_RETRY_MS) || DEFAULT_RETRY_MS;
    const verify = createVerifier({ retryDelayMs });
    const result = await verify(verifyUrl);

    if (shouldRollback(result)) {
        console.error('\n✗ 核心冒烟验证失败:');
        for (const f of result.coreFailures) console.error(`  - ${f}`);
        console.error('\n开始自动回滚...');
        const idArg = previousVersionId ? ` ${previousVersionId}` : '';
        try {
            run(`npx wrangler rollback${idArg} --message "auto rollback: core smoke failed"`, { stdio: 'inherit' });
            console.error('✓ 已回滚到部署前版本');
        } catch (rollbackErr) {
            console.error('✗ 自动回滚也失败了，请立即手动执行: npx wrangler rollback');
            console.error(`  回滚错误: ${rollbackErr.message}`);
        }
        throw new Error('部署后核心验证失败，已尝试回滚');
    }

    const failedSources = Object.keys(result.sourceFailures);
    if (failedSources.length > 0) {
        console.error('\n✗ 以下外部热榜源验证失败（三轮重试后仍失败，不回滚）:');
        for (const source of failedSources) {
            console.error(`  - ${source}: ${result.sourceFailures[source]}`);
        }
        throw new Error(`外部热榜源验证失败: ${failedSources.join(', ')}`);
    }

    console.log('✓ 核心冒烟通过（/ 、/api/settings、未知热榜源 400）');
    console.log(`✓ 外部热榜源全部通过（${HOT_SOURCES.join(', ')}）`);

    // ─── Done!（只有走到这里才允许打印"部署成功"）───
    console.log(`\n${'═'.repeat(50)}`);
    console.log('  ✅ 部署成功!');
    console.log('═'.repeat(50));
    console.log(`\n  🌐 网站地址: ${verifyUrl}`);
    console.log(`  🔧 后台管理: ${verifyUrl}/admin`);
    console.log(`  👤 管理员账号: 仅在部署时设置了 INITIAL_ADMIN_PASSWORD 环境变量才会创建 admin 账号`);
    console.log(`     未设置则首次部署后没有任何管理员，请设置该变量后重新部署。`);
    console.log(`\n  首次访问网站时 Worker 会自动创建数据库表和默认数据。`);
    console.log(`  如需导入完整 150+ 站点数据，运行: npm run db:seed`);
    console.log(`  如需回滚: npx wrangler rollback（查看版本: npx wrangler deployments list）\n`);
}

if (require.main === module) {
    main().catch(err => {
        console.error('\n✗ 部署失败:', err.message);
        process.exit(1);
    });
}

module.exports = {
    main,
    run,
    createRun,
    extractWorkerUrl,
    extractLatestDeploymentId,
    createVerifier,
    shouldRollback,
    updateTomlDbId,
    HOT_SOURCES,
};
