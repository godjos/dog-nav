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

// Fallback friend links (used when CMS is unavailable)
const fallbackFriends = [
    { name: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com', description: '技术周刊与博客', icon: '📝' },
    { name: '酷壳', url: 'https://coolshell.cn', description: '陈皓的技术博客', icon: '🐚' },
    { name: 'V2EX', url: 'https://v2ex.com', description: '创意工作者社区', icon: '💬' },
    { name: '掘金', url: 'https://juejin.cn', description: '开发者技术社区', icon: '💎' },
    { name: '博客园', url: 'https://www.cnblogs.com', description: '开发者的网上家园', icon: '🏡' },
    { name: '少数派', url: 'https://sspai.com', description: '数字生活指南', icon: '📲' },
    { name: 'Dribbble', url: 'https://dribbble.com', description: '设计师作品展示', icon: '🏀' },
    { name: 'Behance', url: 'https://www.behance.net', description: 'Adobe 创意平台', icon: '🎭' },
    { name: '站酷', url: 'https://www.zcool.com.cn', description: '设计师社区', icon: '🎯' },
    { name: '优设', url: 'https://www.uisdc.com', description: '设计师学习平台', icon: '📐' },
    { name: '花瓣网', url: 'https://huaban.com', description: '中文灵感收集', icon: '🌺' },
    { name: 'GitHub', url: 'https://github.com', description: '全球代码托管平台', icon: '🐙' },
    { name: 'Notion', url: 'https://notion.so', description: '一体化工作空间', icon: '📋' },
    { name: 'Figma', url: 'https://figma.com', description: '协作设计工具', icon: '🖌️' },
    { name: '草料二维码', url: 'https://cli.im', description: '在线二维码生成', icon: '📱' },
    { name: 'iLovePDF', url: 'https://www.ilovepdf.com/zh-cn', description: 'PDF 在线处理', icon: '📄' },
];

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
        const name = f.name || f.n || '';
        const url = sanitizeUrl(f.url || f.u);
        if (!url) return; // 非法 URL 不渲染
        const desc = f.description || f.d || '';
        const rawIcon = f.icon || f.i || '🔗';

        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = 'link-card rv';

        const avatar = document.createElement('div');
        avatar.className = 'link-avatar';
        const iconUrl = typeof rawIcon === 'string'
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

        // Load friend links from CMS
        if (linksRes && linksRes.ok) {
            const links = await linksRes.json();
            if (links && links.length > 0) {
                renderFriendLinks(links);
            } else {
                renderFriendLinks(fallbackFriends);
            }
        } else {
            renderFriendLinks(fallbackFriends);
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
        console.log('CMS not available, using fallback');
        renderFriendLinks(fallbackFriends);
    }
})();
