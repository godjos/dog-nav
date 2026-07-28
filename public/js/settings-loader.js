// ═══════════════════════════════════════════
// DogNav 共享设置加载器（公共页统一引入，需在 utils.js 之后、
// 各页面脚本之前引入）
//   fetch /api/settings（失败静默回退默认值，不阻塞页面），
//   然后把站点设置应用到当前页面：favicon、logo 文字、标题、
//   meta 描述、页脚文字与链接、主题色 CSS 变量、投稿入口、
//   天气组件显隐。
//   暴露 window.DogNavSettings = { current, ready, siteName() }
// ═══════════════════════════════════════════
(function () {
    const DEFAULTS = {
        site_name: 'DogNav',
        site_description: '',
        site_icon: '',
        footer_text: '',
        footer_blog_url: '',
        footer_github_url: '',
        theme_primary_color: '',
        theme_secondary_color: '',
        weather_enabled: 'false',
        submission_enabled: 'true',
    };
    const current = Object.assign({}, DEFAULTS);

    // 合法颜色：#rgb / #rrggbb / rgb() / rgba() / hsl() / hsla()
    const COLOR_RE = /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)|hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/;

    function validColor(v) {
        return typeof v === 'string' && COLOR_RE.test(v.trim());
    }

    // #rgb / #rrggbb → [r, g, b]，否则 null
    function hexToRgb(hex) {
        const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
        if (!m) return null;
        let h = m[1];
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }

    function applyFavicon(v) {
        if (!v) return;
        const url = sanitizeUrl(v); // 相对路径会被解析为同源绝对地址
        if (!url) return;
        let link = document.querySelector('link[rel="icon"]');
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
        }
        link.href = url;
    }

    function applySiteName(name) {
        if (!name) return;
        document.querySelectorAll('.logo-text').forEach(el => {
            el.textContent = name;
        });
        const loaderLabel = document.querySelector('.loader .loader-label');
        if (loaderLabel) loaderLabel.textContent = name;

        const title = document.title;
        if (title.includes('DogNav')) {
            document.title = title.split('DogNav').join(name);
        } else if (!title.endsWith(' - ' + name)) {
            document.title = title + ' - ' + name;
        }
    }

    function applyDescription(v) {
        if (!v) return;
        const meta = document.querySelector('meta[name="description"]');
        if (meta) meta.setAttribute('content', v);
    }

    function applyFooterText(v) {
        if (!v) return;
        const el = document.getElementById('footerText');
        if (el) el.textContent = v;
    }

    function applyFooterLink(wrapId, linkId, v) {
        const wrap = document.getElementById(wrapId);
        const link = document.getElementById(linkId);
        if (!wrap || !link) return;
        const url = v ? sanitizeUrl(v) : null;
        if (url) {
            link.href = url;
            wrap.style.display = '';
        } else {
            // 为空或非法：隐藏该链接（连同分隔符）
            wrap.style.display = 'none';
        }
    }

    function applyThemeColor(cssVar, softVar, glowVar, v) {
        if (!validColor(v)) return;
        const color = v.trim();
        const root = document.documentElement.style;
        root.setProperty(cssVar, color);
        // hex 时同步派生 soft/glow 的 rgba 变体，保持整体协调
        const rgb = hexToRgb(color);
        if (rgb && softVar) {
            root.setProperty(softVar, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.12)`);
            if (glowVar) root.setProperty(glowVar, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.25)`);
        }
    }

    function applySubmissionEnabled(v) {
        if (v !== 'false') return;
        // 隐藏所有指向投稿页的入口
        document.querySelectorAll('a[href="contribute.html"]').forEach(a => {
            const li = a.closest('li');
            (li || a).style.display = 'none';
        });
        // 投稿页本身：显示「投稿已关闭」并禁用表单
        const form = document.getElementById('submitForm');
        if (form) {
            const msg = document.getElementById('closedMsg');
            if (msg) msg.hidden = false;
            form.querySelectorAll('input, select, textarea, button').forEach(el => {
                el.disabled = true;
            });
        }
    }

    function applyWeatherEnabled(v) {
        if (v !== 'true') return; // 默认隐藏，保持现状
        const widget = document.getElementById('weatherWidget');
        if (widget) widget.classList.add('show');
    }

    function apply(settings) {
        applyFavicon(settings.site_icon);
        applySiteName(settings.site_name);
        applyDescription(settings.site_description);
        applyFooterText(settings.footer_text);
        applyFooterLink('footerBlogWrap', 'footerBlogLink', settings.footer_blog_url);
        applyFooterLink('footerGithubWrap', 'footerGithubLink', settings.footer_github_url);
        applyThemeColor('--accent', '--accent-soft', '--accent-glow', settings.theme_primary_color);
        applyThemeColor('--accent-2', null, null, settings.theme_secondary_color);
        applySubmissionEnabled(settings.submission_enabled);
        applyWeatherEnabled(settings.weather_enabled);
    }

    const ready = fetch('/api/settings')
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
            if (data && typeof data === 'object') Object.assign(current, data);
            apply(current);
        })
        .catch(() => {
            // 获取失败：静默使用默认值，不阻塞页面
        })
        .then(() => {
            window.dispatchEvent(new CustomEvent('dognav:settings', { detail: current }));
        });

    window.DogNavSettings = {
        current,
        ready,
        siteName() { return current.site_name || DEFAULTS.site_name; },
    };
})();
