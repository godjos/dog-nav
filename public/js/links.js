// ═══════════════════════════════════════════
// DogNav 友链页脚本（由 links.html 内联脚本拆离）
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
    entries.forEach((e, i) => { if (e.isIntersecting) { setTimeout(() => e.target.classList.add('vis'), i * 40); obs.unobserve(e.target); } });
}, { threshold: 0.1 });
function revealEls(els) { setTimeout(() => { els.forEach(el => { const r = el.getBoundingClientRect(); if (r.top < window.innerHeight && r.bottom > 0) { el.classList.add('vis'); } else { obs.observe(el); } }); }, 50); }
revealEls(document.querySelectorAll('.rv'));

function iconFallbackUri(name) {
    const letter = encodeURIComponent([...(name || '网')][0]);
    return `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 36 36%22><rect fill=%22%237f5af0%22 width=%2236%22 height=%2236%22 rx=%2218%22/><text x=%2218%22 y=%2224%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2216%22>${letter}</text></svg>`;
}

function renderFriendLinks(links) {
    const grid = document.getElementById('friendsGrid');
    grid.textContent = '';
    if (!links || links.length === 0) {
        const p = document.createElement('p');
        p.style.cssText = 'color:var(--text-3);grid-column:1/-1;text-align:center;padding:var(--space-xl)';
        p.textContent = '暂无友情链接';
        grid.appendChild(p);
        return;
    }
    links.forEach(f => {
        const name = f.name || '';
        const url = sanitizeUrl(f.url);
        if (!url) return; // 非法 URL 不渲染
        const desc = f.description || '';
        const rawIcon = f.icon || '🔗';

        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = 'link-card rv';

        const avatar = document.createElement('div');
        avatar.className = 'link-avatar';
        // 与 app.js 一致：只有明确的 URL 图标才走 <img>，文本图标直接渲染，
        // 避免 emoji 被 sanitizeUrl 解析成同源相对地址白走一次 404
        const isUrlIcon = typeof rawIcon === 'string' && /^(https?:\/\/|\/|data:image\/)/i.test(rawIcon);
        const iconUrl = isUrlIcon
            ? (sanitizeUrl(rawIcon) || (rawIcon.startsWith('data:image/') ? rawIcon : null))
            : null;
        if (iconUrl) {
            const img = document.createElement('img');
            img.src = iconUrl;
            img.alt = '';
            img.loading = 'lazy';
            img.style.cssText = 'width:32px;height:32px;border-radius:6px;object-fit:cover';
            img.onerror = () => { img.onerror = null; img.src = iconFallbackUri(name); };
            avatar.appendChild(img);
        } else {
            avatar.textContent = typeof rawIcon === 'string' ? rawIcon : '🔗';
        }

        const info = document.createElement('div');
        info.className = 'link-info';
        const nameEl = document.createElement('div');
        nameEl.className = 'link-name';
        nameEl.textContent = name;
        const descEl = document.createElement('div');
        descEl.className = 'link-desc';
        descEl.textContent = desc;
        info.append(nameEl, descEl);

        a.append(avatar, info);
        grid.appendChild(a);
    });
    revealEls(grid.querySelectorAll('.rv'));
}

// Load from CMS API
(async function initCMS() {
    try {
        const [linksRes, pageRes] = await Promise.all([
            fetch('/api/links').catch(() => null),
            fetch('/api/pages/links').catch(() => null)
        ]);

        // Load friend links from CMS（失败或为空时展示「暂无友情链接」占位）
        if (linksRes && linksRes.ok) {
            const links = await linksRes.json();
            renderFriendLinks(links);
        } else {
            renderFriendLinks([]);
        }

        // Load page content from CMS
        if (pageRes && pageRes.ok) {
            const page = await pageRes.json();
            if (page && page.content) {
                const container = document.getElementById('linksPageContent');
                container.innerHTML = '<div class="about-card rv" style="margin-bottom:var(--space-lg)">' + sanitizeHtml(page.content) + '</div>';
                container.querySelectorAll('.rv').forEach(el => obs.observe(el));
                setTimeout(() => {
                    container.querySelectorAll('.rv').forEach(el => {
                        const r = el.getBoundingClientRect();
                        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('vis');
                    });
                }, 50);
            }
            if (page && page.title) {
                document.title = page.title + ' - ' + (window.DogNavSettings ? DogNavSettings.siteName() : 'DogNav');
            }
        }
    } catch (err) {
        console.log('CMS not available');
        renderFriendLinks([]);
    }
})();
