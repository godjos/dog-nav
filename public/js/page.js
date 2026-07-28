// ═══════════════════════════════════════════
// DogNav 自定义页面脚本（由 page.html 内联脚本拆离）
// ═══════════════════════════════════════════
const H = document.documentElement;
const savedTheme = localStorage.getItem('dognav-theme');
if (savedTheme) H.setAttribute('data-theme', savedTheme);

document.getElementById('themeBtn').addEventListener('click', () => {
    const next = H.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    H.classList.add('notransition');
    H.setAttribute('data-theme', next);
    localStorage.setItem('dognav-theme', next);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => H.classList.remove('notransition'));
    });
});
document.getElementById('mobBtn').addEventListener('click', () => document.getElementById('navLinks').classList.toggle('open'));
const obs = new IntersectionObserver(entries => {
    entries.forEach((e, i) => { if (e.isIntersecting) { setTimeout(() => e.target.classList.add('vis'), i * 60); obs.unobserve(e.target); } });
}, { threshold: 0.1 });
document.querySelectorAll('.rv').forEach(el => { setTimeout(() => { const r = el.getBoundingClientRect(); if (r.top < window.innerHeight && r.bottom > 0) { el.classList.add('vis'); } else { obs.observe(el); } }, 50); });

function getSlug() {
    const path = window.location.pathname;
    const match = path.match(/^\/(?:page|p)\/([a-z0-9-]+)/);
    if (match) return match[1];
    const params = new URLSearchParams(window.location.search);
    return params.get('slug');
}

(async function initCMS() {
    const slug = getSlug();
    if (!slug) { showNotFound(); return; }

    try {
        const pageRes = await fetch('/api/pages/' + slug).catch(() => null);

        if (!pageRes || !pageRes.ok) { showNotFound(); return; }

        const page = await pageRes.json();
        if (!page || !page.content) { showNotFound(); return; }

        document.title = (page.title || slug) + ' - ' + (window.DogNavSettings ? DogNavSettings.siteName() : 'DogNav');
        document.getElementById('pageTitle').innerHTML = '<span class="grad">' + escapeHtml(page.title || slug) + '</span>';
        if (page.updated_at) {
            document.getElementById('pageSubtitle').textContent = '最后更新: ' + new Date(page.updated_at).toLocaleDateString('zh-CN');
        }

        const container = document.getElementById('pageContent');
        container.innerHTML = '<div class="page-card rv">' + sanitizeHtml(page.content) + '</div>';
        container.querySelectorAll('.rv').forEach(el => obs.observe(el));
        setTimeout(() => {
            container.querySelectorAll('.rv').forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('vis');
            });
        }, 50);
    } catch (err) {
        console.error('Failed to load page:', err);
        showNotFound();
    }
})();

function showNotFound() {
    document.title = '页面不存在 - ' + (window.DogNavSettings ? DogNavSettings.siteName() : 'DogNav');
    document.getElementById('pageTitle').innerHTML = '<span class="grad">页面不存在</span>';
    document.getElementById('pageSubtitle').textContent = '404 Not Found';
    document.getElementById('pageContent').innerHTML = '<div class="page-card rv not-found"><div class="emoji">🔍</div><h2>找不到这个页面</h2><p>你访问的页面可能已被删除或地址有误。<br><br><a href="index.html">← 返回首页</a></p></div>';
    document.querySelectorAll('.rv').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('vis');
        else obs.observe(el);
    });
}
