// ═══════════════════════════════════════════
// DogNav 关于页脚本（由 about.html 内联脚本拆离）
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

// Load page content from CMS API
(async function initCMS() {
    try {
        const [pageRes, sitesRes, catsRes] = await Promise.all([
            fetch('/api/pages/about').catch(() => null),
            fetch('/api/sites').catch(() => null),
            fetch('/api/categories').catch(() => null)
        ]);

        // Update stats from real data
        if (sitesRes && sitesRes.ok) {
            const sites = await sitesRes.json();
            const active = sites.filter(s => s.status === 'active');
            document.getElementById('statSites').textContent = active.length + '+';
            const totalClicks = active.reduce((sum, s) => sum + (s.click_count || 0), 0);
            document.getElementById('statClicks').textContent = totalClicks > 9999 ? (totalClicks / 1000).toFixed(1) + 'k' : totalClicks;
        }
        if (catsRes && catsRes.ok) {
            const cats = await catsRes.json();
            const activeCats = cats.filter(c => c.is_active);
            document.getElementById('statCats').textContent = activeCats.length;
        }

        // Load page content from CMS
        if (pageRes && pageRes.ok) {
            const page = await pageRes.json();
            if (page && page.content) {
                const container = document.getElementById('aboutContent');
                // Render CMS content as sanitized HTML (from Quill editor)
                container.innerHTML = '<div class="about-card rv">' + sanitizeHtml(page.content) + '</div>';
                // Re-observe new elements for reveal animation
                container.querySelectorAll('.rv').forEach(el => obs.observe(el));
                // Trigger immediate reveal for visible elements
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
        console.log('CMS not available, stats unavailable');
        document.getElementById('statSites').textContent = '—';
        document.getElementById('statCats').textContent = '—';
        document.getElementById('statClicks').textContent = '—';
    }
})();
