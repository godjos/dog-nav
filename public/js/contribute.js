// ═══════════════════════════════════════════
// DogNav 提交收录页脚本（由 contribute.html 内联脚本拆离）
// ═══════════════════════════════════════════
const H = document.documentElement;
const savedTheme = localStorage.getItem('dognav-theme');
if (savedTheme) H.setAttribute('data-theme', savedTheme);

document.getElementById('themeBtn').addEventListener('click', () => {
    const next = H.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    H.setAttribute('data-theme', next);
    localStorage.setItem('dognav-theme', next);
});
document.getElementById('mobBtn').addEventListener('click', () => document.getElementById('navLinks').classList.toggle('open'));
const obs = new IntersectionObserver(entries => {
    entries.forEach((e, i) => { if (e.isIntersecting) { setTimeout(() => e.target.classList.add('vis'), i * 60); obs.unobserve(e.target); } });
}, { threshold: 0.1 });
document.querySelectorAll('.rv').forEach(el => { setTimeout(() => { const r = el.getBoundingClientRect(); if (r.top < window.innerHeight && r.bottom > 0) { el.classList.add('vis'); } else { obs.observe(el); } }, 50); });

// Dynamic categories from API
(async function loadCats() {
    try {
        const res = await fetch('/api/categories');
        if (res.ok) {
            const cats = await res.json();
            const activeCats = cats.filter(c => c.is_active);
            if (activeCats.length > 0) {
                const sel = document.getElementById('siteCat');
                sel.textContent = '';
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = '请选择分类';
                sel.appendChild(placeholder);
                activeCats.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = `${c.icon || '📁'} ${c.name}`;
                    sel.appendChild(opt);
                });
            }
            // If no active cats from API, keep the hardcoded options in HTML
        }
    } catch (err) { /* keep hardcoded options */ }
})();

// 投稿开关（submission_enabled）由 /js/settings-loader.js 统一处理：
// 关闭时会显示「投稿已关闭」并禁用下方表单。

// Form submission → POST to CMS API
document.getElementById('submitForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const name = document.getElementById('siteName').value.trim();
    const url = document.getElementById('siteUrl').value.trim();
    const desc = document.getElementById('siteDesc').value.trim();
    const cat = document.getElementById('siteCat').value;
    const reason = document.getElementById('siteReason').value.trim();
    const contact = document.getElementById('siteContact').value.trim();
    const honeypot = document.getElementById('hpWebsite').value;
    if (!name || !url || !desc || !cat) return;

    const btn = this.querySelector('.submit-btn');
    btn.textContent = '提交中...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name, url,
                description: desc || reason,
                category: cat,
                submitter_email: contact,
                website: honeypot // 蜜罐字段：真人留空，机器人填了会被服务端静默丢弃
            })
        });
        const data = await res.json();
        if (res.ok) {
            // 展示查询凭证并清空表单
            document.getElementById('trackingToken').textContent = data.trackingToken || '';
            document.getElementById('formCard').style.display = 'none';
            document.getElementById('successMsg').classList.add('show');
            this.reset();
        } else {
            let msg = data.error || '提交失败，请稍后重试';
            if (res.status === 409) msg = '该网址已被投稿过';
            else if (res.status === 429) msg = '提交过于频繁，请稍后再试';
            alert(msg);
            btn.textContent = '提交收录申请';
            btn.disabled = false;
        }
    } catch (err) {
        alert('网络错误，请稍后重试');
        btn.textContent = '提交收录申请';
        btn.disabled = false;
    }
});

// 复制查询凭证
document.getElementById('btnCopyToken').addEventListener('click', async function() {
    const token = document.getElementById('trackingToken').textContent;
    if (!token) return;
    try {
        await navigator.clipboard.writeText(token);
        this.textContent = '已复制';
    } catch (err) {
        // 剪贴板 API 不可用（非安全上下文等）：选中文字让用户手动复制
        const range = document.createRange();
        range.selectNodeContents(document.getElementById('trackingToken'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        this.textContent = '请手动复制';
    }
    setTimeout(() => { this.textContent = '复制'; }, 2000);
});

// 查询投稿进度
const SUB_STATUS_TEXT = { pending: '待审核', approved: '已收录', rejected: '已拒绝' };

function addStatusRow(resultEl, key, valueNode) {
    const row = document.createElement('div');
    row.className = 'row';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'v';
    if (typeof valueNode === 'string') v.textContent = valueNode;
    else v.appendChild(valueNode);
    row.append(k, v);
    resultEl.appendChild(row);
}

document.getElementById('btnQueryStatus').addEventListener('click', async function() {
    const token = document.getElementById('statusToken').value.trim();
    const errEl = document.getElementById('statusError');
    const resultEl = document.getElementById('statusResult');
    errEl.classList.remove('show');
    resultEl.classList.remove('show');
    resultEl.textContent = '';
    if (!token) return;

    this.disabled = true;
    this.textContent = '查询中...';
    try {
        const res = await fetch(`/api/submissions/status/${encodeURIComponent(token)}`);
        if (res.status === 404) {
            errEl.textContent = '查询凭证无效，请检查后重试';
            errEl.classList.add('show');
        } else if (!res.ok) {
            errEl.textContent = '查询失败，请稍后再试';
            errEl.classList.add('show');
        } else {
            const data = await res.json();
            addStatusRow(resultEl, '网站名称', data.name || '-');
            addStatusRow(resultEl, '网站地址', data.url || '-');
            const badge = document.createElement('span');
            const status = Object.prototype.hasOwnProperty.call(SUB_STATUS_TEXT, data.status) ? data.status : 'pending';
            badge.className = `status-badge ${status}`;
            badge.textContent = SUB_STATUS_TEXT[status];
            addStatusRow(resultEl, '审核状态', badge);
            if (data.review_note) addStatusRow(resultEl, '审核备注', data.review_note);
            addStatusRow(resultEl, '提交时间', data.created_at ? new Date(data.created_at.replace(' ', 'T') + 'Z').toLocaleString('zh-CN') : '-');
            if (data.reviewed_at) {
                addStatusRow(resultEl, '审核时间', new Date(data.reviewed_at.replace(' ', 'T') + 'Z').toLocaleString('zh-CN'));
            }
            resultEl.classList.add('show');
        }
    } catch (err) {
        errEl.textContent = '网络错误，请稍后再试';
        errEl.classList.add('show');
    }
    this.disabled = false;
    this.textContent = '查询';
});
