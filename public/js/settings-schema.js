(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./home-config'));
    else root.DogNavSettingsSchema = factory(root.DogNavHomeConfig);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (homeConfig) {
    'use strict';
    const limits = {
        site_name: 120, site_description: 1000, site_icon: 2048, site_url: 2048,
        footer_text: 1000, footer_blog_url: 2048, footer_github_url: 2048,
        theme_primary_color: 100, theme_secondary_color: 100,
    };

    function validColor(value) {
        if (/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return true;
        const match = value.match(/^(rgb|rgba|hsl|hsla)\(([^)]+)\)$/);
        if (!match) return false;
        const parts = match[2].split(',').map(part => part.trim());
        const alpha = match[1].endsWith('a');
        if (parts.length !== (alpha ? 4 : 3)) return false;
        if (alpha && (!/^(?:0|1|0?\.\d+)$/.test(parts[3]) || Number(parts[3]) > 1)) return false;
        if (match[1].startsWith('rgb')) {
            return parts.slice(0, 3).every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
        }
        return /^\d{1,3}$/.test(parts[0]) && Number(parts[0]) <= 360 &&
            parts.slice(1, 3).every(part => /^\d{1,3}%$/.test(part) && Number(part.slice(0, -1)) <= 100);
    }

    function validUrl(value, allowRelative) {
        if (/[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
        if (allowRelative && value.startsWith('/') && !value.startsWith('//')) return true;
        try {
            const url = new URL(value);
            return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
        } catch { return false; }
    }

    function validateSettingsUpdate(body) {
        const fail = (field, reason) => ({ error: `${field}: ${reason}`, field });
        if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('settings', '必须是设置对象');
        const values = {};
        for (const [key, raw] of Object.entries(body)) {
            if (key === 'home_config') {
                const result = homeConfig.validate(raw);
                if (result.error) return fail(key, result.error);
                values[key] = JSON.stringify(result.value);
                continue;
            }
            if (key === 'submission_enabled') {
                if (![true, false, 'true', 'false'].includes(raw)) return fail(key, '必须为 true 或 false');
                values[key] = String(raw);
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(limits, key)) return { error: `Invalid setting key: ${key}`, field: key };
            if (typeof raw !== 'string') return fail(key, '必须是字符串');
            if (raw.length > limits[key]) return fail(key, `不得超过 ${limits[key]} 个字符`);
            const value = raw.trim();
            if (key === 'site_url' && value) {
                if (!validUrl(value, false)) return fail(key, '请输入 HTTP(S) 站点根地址');
                const url = new URL(value);
                if (url.pathname !== '/' || url.search || url.hash) return fail(key, '站点地址不能包含路径、查询参数或片段');
                values[key] = url.origin + '/';
                continue;
            }
            if (['site_icon', 'footer_blog_url', 'footer_github_url'].includes(key) && value && !validUrl(value, key === 'site_icon')) {
                return fail(key, key === 'site_icon' ? '请输入 HTTP(S) 地址或以 / 开头的同源路径' : '请输入 HTTP(S) 地址');
            }
            if (key.startsWith('theme_') && value && !validColor(value)) return fail(key, '请输入有效的 HEX、RGB 或 HSL 颜色');
            values[key] = /^#[\da-f]{3}$/i.test(value) && key.startsWith('theme_')
                ? '#' + value.slice(1).split('').map(char => char + char).join('').toLowerCase()
                : value;
        }
        return { values, error: null, field: null };
    }

    return { validateSettingsUpdate };
});
