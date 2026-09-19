/* Homepage controls share the same configuration contract as the public page. */
(function () {
    const flags = ['show_recent', 'show_favorites', 'show_health', 'show_read_later'];
    const byId = id => document.getElementById(id);
    let ready = false;
    let locked = true;
    let rawConfig = '';
    let previewSettings = null;

    function option(value, label, selected) {
        const el = document.createElement('option');
        el.value = value;
        el.textContent = label;
        el.selected = selected;
        return el;
    }
    function checkbox(value, label, selected) {
        const wrapper = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox'; input.value = value; input.checked = selected;
        wrapper.append(input, document.createTextNode(label));
        return wrapper;
    }
    function refreshDefaultEngine(selected = byId('home_default_engine').value) {
        const select = byId('home_default_engine');
        select.replaceChildren();
        for (const row of byId('home_engines').children) {
            const [id, name] = row.querySelectorAll('input');
            select.append(option(id.value, name.value || id.value, id.value === selected));
        }
    }
    function addEngine(engine = { id: '', name: '', url: '' }) {
        const row = document.createElement('div'); row.className = 'home-engine';
        for (const [key, label] of [['id', '引擎标识'], ['name', '显示名称'], ['url', '搜索地址（含 {query}）']]) {
            const input = document.createElement('input');
            input.value = engine[key]; input.placeholder = label; input.setAttribute('aria-label', label);
            if (key !== 'url') input.addEventListener('change', () => refreshDefaultEngine());
            row.append(input);
        }
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除';
        remove.addEventListener('click', () => { row.remove(); refreshDefaultEngine(); });
        row.append(remove); byId('home_engines').append(row);
    }
    function setDisabled(disabled) {
        locked = disabled;
        byId('home_fields').disabled = disabled || !ready;
        byId('previewHomeBtn').disabled = disabled || !ready;
    }
    function selectedValues(container) {
        return Array.from(byId(container).querySelectorAll('input:checked'), el => el.value);
    }
    function read() {
        if (!ready) return rawConfig;
        const engines = Array.from(byId('home_engines').children, row => {
            const inputs = row.querySelectorAll('input');
            return { id: inputs[0].value, name: inputs[1].value, url: inputs[2].value };
        });
        const config = {
            category_ids: byId('home_category_mode').value === 'all' ? null : selectedValues('home_categories'),
            category_limit: Number(byId('home_category_limit').value),
            pinned_ids: byId('home_pinned_mode').value === 'auto' ? null : selectedValues('home_pinned').map(Number),
            default_engine: byId('home_default_engine').value,
            engines
        };
        flags.forEach(key => config[key] = byId(key).checked);
        return JSON.stringify(config);
    }
    async function load(raw) {
        rawConfig = raw || JSON.stringify(DogNavHomeConfig.DEFAULTS);
        ready = false; setDisabled(locked);
        byId('retryHomeBtn').hidden = true;
        byId('home_load_status').textContent = '正在加载分类与站点…';
        try {
            const responses = await Promise.all([fetch('/api/categories'), fetch('/api/sites')]);
            if (responses.some(response => !response.ok)) throw new Error('加载失败');
            const [categories, sites] = await Promise.all(responses.map(response => response.json()));
            if (!Array.isArray(categories) || !Array.isArray(sites)) throw new Error('数据格式错误');
            const validation = DogNavHomeConfig.validate(rawConfig);
            if (validation.error) throw new Error(validation.error);
            const config = validation.value;
            byId('home_category_mode').value = config.category_ids === null ? 'all' : 'custom';
            byId('home_pinned_mode').value = config.pinned_ids === null ? 'auto' : 'custom';
            byId('home_categories').replaceChildren(...categories.map(c => checkbox(c.id, c.name, config.category_ids?.includes(String(c.id)))));
            // Preserve references to removed entries until an administrator explicitly clears them.
            for (const id of config.category_ids || []) if (!categories.some(c => String(c.id) === id)) byId('home_categories').append(checkbox(id, `已移除分类：${id}`, true));
            byId('home_pinned').replaceChildren(...sites.map(s => checkbox(s.id, s.name, config.pinned_ids?.includes(Number(s.id)))));
            for (const id of config.pinned_ids || []) if (!sites.some(s => Number(s.id) === id)) byId('home_pinned').append(checkbox(id, `已移除站点：${id}`, true));
            byId('home_category_limit').value = config.category_limit;
            flags.forEach(key => byId(key).checked = config[key]);
            byId('home_engines').replaceChildren(); config.engines.forEach(addEngine);
            refreshDefaultEngine(config.default_engine);
            ready = true;
            byId('home_load_status').textContent = '';
        } catch (error) {
            byId('home_load_status').textContent = `首页配置暂不可编辑：${error.message}。原配置已保留。`;
            byId('retryHomeBtn').hidden = false;
        }
        setDisabled(locked);
        return ready;
    }
    function sendPreview() {
        if (previewSettings) byId('home_preview').contentWindow.postMessage({ type: 'dognav:preview', settings: previewSettings }, location.origin);
    }
    function preview(settings) {
        const result = DogNavHomeConfig.validate(settings.home_config);
        if (result.error) { showToast(result.error, 'error'); return; }
        previewSettings = settings;
        const iframe = byId('home_preview');
        iframe.hidden = false;
        if (!iframe.getAttribute('src')) iframe.src = '/?preview=1';
        else sendPreview();
    }
    byId('home_preview').addEventListener('load', sendPreview);
    byId('addEngineBtn').addEventListener('click', () => { addEngine(); refreshDefaultEngine(); });
    byId('retryHomeBtn').addEventListener('click', () => load(rawConfig));
    byId('home_preview_width').addEventListener('change', event => byId('home_preview').classList.toggle('mobile-preview', event.target.value === 'mobile'));
    window.DogNavHomeSettings = { load, read, setDisabled, preview };
})();
