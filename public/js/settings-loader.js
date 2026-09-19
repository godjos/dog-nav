// ═══════════════════════════════════════════
// DogNav 共享设置加载器（公共页统一引入，需在 utils.js 之后、
// 各页面脚本之前引入）
//   fetch /api/settings（失败静默回退默认值，不阻塞页面），
//   然后把站点设置应用到当前页面：favicon、logo 文字、标题、
//   meta 描述、页脚文字与链接、主题色 CSS 变量、投稿入口。
//   暴露 window.DogNavSettings = { current, ready, siteName() }
// ═══════════════════════════════════════════
(function () {
    const DEFAULTS = {
        site_name: 'DogNav',
        site_description: '',
        site_icon: '',
        site_url: '',
        footer_text: '',
        footer_blog_url: '',
        footer_github_url: '',
        theme_primary_color: '',
        theme_secondary_color: '',
        submission_enabled: 'true',
    };
    const current = Object.assign({}, DEFAULTS);

    // 后台「首页设置」预览：iframe 以 ?preview=1 打开时不请求真实设置，
    // 完全由父页面 postMessage 推送的预览设置驱动，避免真实设置后达覆盖预览。
    const PREVIEW_MODE = (() => {
        try {
            return typeof location !== 'undefined' && typeof window !== 'undefined' && window.parent !== window &&
                new URLSearchParams(location.search).get('preview') === '1';
        } catch { return false; }
    })();

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

    function applySiteUrl(v) {
        const url = v ? sanitizeUrl(v) : null;
        if (!url) return;
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) canonical.setAttribute('href', url);
        // 无 DOM 能力（如测试沙箱）时仅更新 canonical
        if (typeof document.createElement !== 'function' || !document.head) return;
        let ogUrl = document.querySelector('meta[property="og:url"]');
        if (!ogUrl) {
            ogUrl = document.createElement('meta');
            ogUrl.setAttribute('property', 'og:url');
            document.head.appendChild(ogUrl);
        }
        ogUrl.setAttribute('content', url);
        // JSON-LD WebSite 地址同步，保持站内元信息一致
        const ld = document.querySelector('script[type="application/ld+json"]');
        if (ld && typeof ld.textContent === 'string' && ld.textContent.trim()) {
            try {
                const json = JSON.parse(ld.textContent);
                if (json && typeof json === 'object') {
                    json.url = url;
                    ld.textContent = JSON.stringify(json);
                }
            } catch { /* JSON-LD 不是可解析对象时保持原样 */ }
        }
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
        const meta = document.querySelector('meta[name="description"]');
        if (meta) meta.setAttribute('content', v);
        const subtitle = document.getElementById('siteDescription');
        if (subtitle) {
            subtitle.textContent = v;
            subtitle.hidden = !v;
        }
    }

    function applyFooterText(v) {
        const el = document.getElementById('footerText');
        if (el) {
            el.textContent = v;
            el.hidden = !v;
        }
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

    function apply(settings) {
        applyFavicon(settings.site_icon);
        applySiteName(settings.site_name);
        applyDescription(settings.site_description);
        applySiteUrl(settings.site_url);
        applyFooterText(settings.footer_text);
        applyFooterLink('footerBlogWrap', 'footerBlogLink', settings.footer_blog_url);
        applyFooterLink('footerGithubWrap', 'footerGithubLink', settings.footer_github_url);
        applyThemeColor('--accent', '--accent-soft', '--accent-glow', settings.theme_primary_color);
        applyThemeColor('--accent-2', null, null, settings.theme_secondary_color);
        applySubmissionEnabled(settings.submission_enabled);
    }

    // 预览模式下不请求真实设置，等待父页面 postMessage 预览数据
    const ready = PREVIEW_MODE
        ? Promise.resolve().then(() => {
            window.dispatchEvent(new CustomEvent('dognav:settings', { detail: current }));
        })
        : fetch('/api/settings')
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
        apply(settings) {
            if (settings && typeof settings === 'object') Object.assign(current, settings);
            apply(current);
        },
        siteName() { return current.site_name || DEFAULTS.site_name; },
    };
})();
