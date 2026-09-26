const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateSettingsUpdate } = require('../public/js/settings-schema');
const homeConfig = require('../public/js/home-config');

describe('settings value validation', () => {
    it('validates a complete update and normalizes booleans and short hex', () => {
        const result = validateSettingsUpdate({
            site_name: ' My navigation ', site_description: '', site_icon: '/icons/site.png',
            footer_text: 'Copyright', footer_blog_url: 'https://example.com/blog', footer_github_url: '',
            theme_primary_color: '#AbC', theme_secondary_color: 'hsl(120, 50%, 30%)', submission_enabled: true,
        });
        assert.equal(result.error, null);
        assert.equal(result.values.theme_primary_color, '#aabbcc');
        assert.equal(result.values.submission_enabled, 'true');
        assert.equal(result.values.site_name, 'My navigation');
    });

    it('rejects malformed bodies, unknown keys, invalid types and oversized strings', () => {
        for (const body of [null, [], 'bad', 42, { unknown: 'value' }, { site_name: null },
            { footer_text: {} }, { site_description: false }, { site_name: 'x'.repeat(121) },
            { submission_enabled: 0 }, { submission_enabled: 'yes' }]) {
            const result = validateSettingsUpdate(body);
            assert.ok(result.error, JSON.stringify(body));
            assert.equal(result.values, undefined);
        }
    });

    it('accepts only safe URL schemes and root-relative icon paths', () => {
        for (const value of ['javascript:alert(1)', 'data:image/png;base64,abc', '//evil.example/icon', '/\\evil.example/icon', 'https://user:pass@example.com', 'https://example.com/\nicon']) {
            assert.ok(validateSettingsUpdate({ site_icon: value }).error, value);
        }
        assert.ok(validateSettingsUpdate({ footer_blog_url: '/blog' }).error);
        assert.equal(validateSettingsUpdate({ site_icon: '/uploads/logo.png' }).error, null);
    });

    it('checks color components and preserves supported functional colors', () => {
        for (const value of ['', '#123456', 'rgb(12, 34, 56)', 'rgba(12, 34, 56, .5)', 'hsla(360, 100%, 0%, 1)']) {
            assert.equal(validateSettingsUpdate({ theme_primary_color: value }).error, null, value);
        }
        for (const value of ['red', '#12345', 'rgb(999, 0, 0)', 'hsl(0, 101%, 0%)', 'rgba(1, 2, 3, 2)', 'rgb(1, 2, 3, .5)']) {
            assert.ok(validateSettingsUpdate({ theme_primary_color: value }).error, value);
        }
    });

    it('returns no partial values when a later field fails', () => {
        const result = validateSettingsUpdate({ site_name: 'valid name', footer_blog_url: 'javascript:alert(1)' });
        assert.equal(result.field, 'footer_blog_url');
        assert.equal(result.values, undefined);
        assert.match(result.error, /footer_blog_url/);
    });

    it('normalizes a root site URL and rejects paths or unsafe values', () => {
        assert.equal(validateSettingsUpdate({ site_url: 'https://Example.com' }).values.site_url, 'https://example.com/');
        assert.equal(validateSettingsUpdate({ site_url: '' }).error, null);
        for (const value of ['javascript:alert(1)', '/local', 'https://example.com/blog', 'https://example.com/?q=1', 'https://example.com/#anchor']) {
            assert.equal(validateSettingsUpdate({ site_url: value }).field, 'site_url');
        }
    });

    it('serializes validated homepage objects for storage', () => {
        const result = validateSettingsUpdate({ home_config: { category_limit: 8, pinned_ids: [] } });
        assert.equal(result.error, null);
        assert.equal(JSON.parse(result.values.home_config).category_limit, 8);
        assert.deepEqual(JSON.parse(result.values.home_config).pinned_ids, []);
        assert.equal(validateSettingsUpdate({ home_config: '{broken' }).field, 'home_config');
    });
});

describe('homepage configuration', () => {
    it('merges missing fields and preserves explicit empty lists', () => {
        const result = homeConfig.validate({ category_ids: [], pinned_ids: [], show_recent: false });
        assert.equal(result.error, null);
        assert.deepEqual(result.value.category_ids, []);
        assert.deepEqual(result.value.pinned_ids, []);
        assert.equal(result.value.show_recent, false);
        assert.equal(result.value.engines.length, 6);
        assert.equal(homeConfig.parse('{}').category_limit, 5);
        assert.deepEqual(homeConfig.parse('{}').layout, []);
    });

    it('falls back safely and does not share mutable defaults', () => {
        for (const raw of [undefined, null, 'bad', '[]', { category_limit: 0 }]) {
            assert.deepEqual(homeConfig.parse(raw), homeConfig.DEFAULTS);
        }
        const config = homeConfig.parse(null);
        config.engines[0].name = 'changed';
        assert.equal(homeConfig.DEFAULTS.engines[0].name, '百度');
    });

    it('rejects invalid field types, ranges, unknown keys and duplicate IDs', () => {
        for (const raw of [
            { category_ids: [1] }, { category_ids: ['a', 'a'] }, { category_ids: Array.from({ length: 101 }, (_, i) => String(i)) },
            { pinned_ids: [-1] }, { pinned_ids: [1, 1] }, { pinned_ids: ['1'] }, { pinned_ids: Array.from({ length: 13 }, (_, i) => i + 1) },
            { category_limit: 13 }, { category_limit: 1.5 }, { show_recent: 'false' }, { unknown: true },
            { engines: [] }, { default_engine: 'absent' }, { engines: [homeConfig.DEFAULTS.engines[0], homeConfig.DEFAULTS.engines[0]] },
        ]) assert.ok(homeConfig.validate(raw).error, JSON.stringify(raw));
    });

    it('validates ordered dashboard groups while accepting legacy configs', () => {
        const pinned = { id: 'pinned', width: 'full', variant: 'service', columns: 4, collapsed: false };
        const category = { id: 'tools', width: 'half', variant: 'bookmark', columns: 1, collapsed: true };
        assert.deepEqual(homeConfig.validate({ layout: [pinned, category] }).value.layout, [pinned, category]);
        assert.deepEqual(homeConfig.validate({}).value.layout, []);
        for (const layout of [null, [pinned, pinned], [{ ...pinned, columns: 0 }], [{ ...pinned, width: 'tiny' }], [{ ...pinned, extra: 1 }]]) {
            assert.ok(homeConfig.validate({ layout }).error, JSON.stringify(layout));
        }
    });

    it('accepts query-value and path templates but rejects unsafe or ambiguous templates', () => {
        const config = url => ({ engines: [{ id: 'custom', name: 'Custom', url }], default_engine: 'custom' });
        for (const url of ['https://example.com/?q={query}', 'https://example.com/search/{query}']) {
            assert.equal(homeConfig.validate(config(url)).error, null, url);
        }
        for (const url of ['javascript:{query}', 'https://{query}.example.com/', 'https://example.com/#{query}',
            'https://example.com/?{query}=value', 'https://user:pass@example.com/?q={query}', 'https://example.com/?q={query}&r={query}',
            'https://example.com/', '//example.com/?q={query}', 'https://example.com/\\{query}']) {
            assert.ok(homeConfig.validate(config(url)).error, url);
        }
    });
});
