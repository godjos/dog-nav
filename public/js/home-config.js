(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DogNavHomeConfig = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const DEFAULTS = Object.freeze({
        category_ids: null, category_limit: 5, pinned_ids: null, layout: Object.freeze([]),
        show_recent: true, show_favorites: true, show_health: true, show_read_later: true,
        default_engine: 'baidu',
        engines: Object.freeze([
            { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd={query}' },
            { id: 'google', name: 'Google', url: 'https://www.google.com/search?q={query}' },
            { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q={query}' },
            { id: 'github', name: 'GitHub', url: 'https://github.com/search?q={query}' },
            { id: 'bilibili', name: 'B站', url: 'https://search.bilibili.com/all?keyword={query}' },
            { id: 'zhihu', name: '知乎', url: 'https://www.zhihu.com/search?type=content&q={query}' },
        ].map(Object.freeze)),
    });
    const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULTS));
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const fail = error => ({ value: null, error });

    function validTemplate(template) {
        if (typeof template !== 'string' || template.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(template)) return false;
        if (template.split('{query}').length !== 2) return false;
        try {
            const marker = 'DOGNAV_QUERY_PLACEHOLDER';
            const url = new URL(template.replace('{query}', marker));
            return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password &&
                !url.origin.includes(marker.toLowerCase()) &&
                (url.pathname.includes(marker) || Array.from(url.searchParams.values()).some(value => value.includes(marker)));
        } catch { return false; }
    }

    function validate(raw) {
        if (typeof raw === 'string') {
            if (raw.length > 40000) return fail('首页配置过长');
            try { raw = JSON.parse(raw); } catch { return fail('首页配置必须为有效 JSON'); }
        }
        if (!isObject(raw)) return fail('首页配置必须为对象');
        for (const key of Object.keys(raw)) {
            if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return fail(`未知首页配置字段：${key}`);
        }
        const value = Object.assign(cloneDefaults(), raw);
        for (const [key, max, valid] of [
            ['category_ids', 100, id => typeof id === 'string' && id.trim().length > 0 && id.length <= 120],
            ['pinned_ids', 12, id => Number.isSafeInteger(id) && id > 0],
        ]) {
            const ids = value[key];
            if (ids !== null && (!Array.isArray(ids) || ids.length > max || !ids.every(valid) || new Set(ids).size !== ids.length)) {
                return fail(`${key} 必须为 null 或至多 ${max} 个不重复有效 ID`);
            }
        }
        if (!Array.isArray(value.layout) || value.layout.length > 101) return fail('layout 必须为至多 101 个分组的数组');
        const layoutIds = new Set();
        for (const group of value.layout) {
            if (!isObject(group) || Object.keys(group).some(key => !['id', 'width', 'variant', 'columns', 'collapsed'].includes(key)) ||
                typeof group.id !== 'string' || !group.id.trim() || group.id.length > 120 || layoutIds.has(group.id) ||
                !['full', 'half', 'third'].includes(group.width) || !['service', 'bookmark'].includes(group.variant) ||
                !Number.isInteger(group.columns) || group.columns < 1 || group.columns > 4 || typeof group.collapsed !== 'boolean') {
                return fail('layout 分组必须有唯一 ID、有效宽度、卡片类型、1 至 4 列及折叠状态');
            }
            layoutIds.add(group.id);
        }
        if (!Number.isInteger(value.category_limit) || value.category_limit < 1 || value.category_limit > 12) return fail('category_limit 必须为 1 至 12 的整数');
        for (const key of ['show_recent', 'show_favorites', 'show_health', 'show_read_later']) {
            if (typeof value[key] !== 'boolean') return fail(`${key} 必须为布尔值`);
        }
        if (!Array.isArray(value.engines) || value.engines.length < 1 || value.engines.length > 12) return fail('搜索引擎数量必须为 1 至 12');
        const ids = new Set();
        for (const engine of value.engines) {
            if (!isObject(engine) || Object.keys(engine).some(key => !['id', 'name', 'url'].includes(key)) ||
                typeof engine.id !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(engine.id) || ids.has(engine.id)) return fail('搜索引擎 ID 必须有效且不重复');
            if (typeof engine.name !== 'string' || !engine.name.trim() || engine.name.length > 40) return fail(`${engine.id} 名称必须为 1 至 40 个字符`);
            if (!validTemplate(engine.url)) return fail(`${engine.id} 地址必须为 HTTP(S)，并在路径或查询参数值中包含一个 {query}`);
            ids.add(engine.id);
        }
        if (typeof value.default_engine !== 'string' || !ids.has(value.default_engine)) return fail('默认搜索引擎必须在引擎列表中');
        return { value: JSON.parse(JSON.stringify(value)), error: null };
    }

    function parse(raw) {
        const result = validate(raw);
        return result.error ? cloneDefaults() : result.value;
    }
    return { DEFAULTS, parse, validate };
});
