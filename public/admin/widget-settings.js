(function () {
    const $ = id => document.getElementById(id);
    const names = { github: 'GitHub 仓库', uptimekuma: '公开状态页', custom_json: 'JSON API', weather: '天气' };
    let sites = [];
    let widgets = [];

    function field(label, id, value = '', type = 'text') {
        const wrap = document.createElement('label');
        wrap.textContent = label;
        const input = document.createElement('input');
        input.id = id;
        input.type = type;
        input.value = value ?? '';
        input.required = true;
        wrap.append(input);
        return wrap;
    }

    function renderFields(config = {}) {
        const type = $('widget_type').value;
        $('widget_site').disabled = type === 'weather';
        const fields = $('widget_type_fields');
        fields.replaceChildren();
        if (type === 'github') {
            fields.append(field('仓库所有者', 'widget_owner', config.owner), field('仓库名称', 'widget_repo', config.repo));
        } else if (type === 'uptimekuma') {
            fields.append(field('公开状态页根地址（HTTPS，默认端口）', 'widget_url', config.url, 'url'), field('状态页 slug', 'widget_slug', config.slug));
        } else if (type === 'weather') {
            fields.append(field('纬度', 'widget_latitude', config.latitude, 'number'), field('经度', 'widget_longitude', config.longitude, 'number'));
            $('widget_latitude').step = $('widget_longitude').step = 'any';
            $('widget_latitude').min = '-90'; $('widget_latitude').max = '90';
            $('widget_longitude').min = '-180'; $('widget_longitude').max = '180';
        } else {
            fields.append(field('公开 JSON API 地址（HTTPS）', 'widget_url', config.url, 'url'));
            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent = '最多四项指标；字段路径使用点分隔键名，例如 data.count。接口须使用公开 HTTPS 地址，不填写密钥。';
            fields.append(hint);
            for (let i = 0; i < 4; i++) {
                const mapping = config.mappings?.[i] || {};
                const row = document.createElement('div');
                row.className = 'widget-mapping-row';
                row.append(field('指标名称', `widget_label_${i}`, mapping.label), field('字段路径', `widget_path_${i}`, mapping.path), field('单位（可选）', `widget_unit_${i}`, mapping.unit));
                row.querySelector(`#widget_unit_${i}`).required = false;
                if (i > 0) {
                    row.querySelector(`#widget_label_${i}`).required = false;
                    row.querySelector(`#widget_path_${i}`).required = false;
                }
                fields.append(row);
            }
        }
    }

    function readConfig() {
        const type = $('widget_type').value;
        if (type === 'github') return { owner: $('widget_owner').value.trim(), repo: $('widget_repo').value.trim() };
        if (type === 'uptimekuma') return { url: $('widget_url').value.trim(), slug: $('widget_slug').value.trim() };
        if (type === 'weather') return { latitude: Number($('widget_latitude').value), longitude: Number($('widget_longitude').value) };
        const mappings = [];
        for (let i = 0; i < 4; i++) {
            const label = $(`widget_label_${i}`).value.trim();
            const path = $(`widget_path_${i}`).value.trim();
            const unit = $(`widget_unit_${i}`).value.trim();
            if (label || path || unit) mappings.push({ label, path, ...(unit ? { unit } : {}) });
        }
        return { url: $('widget_url').value.trim(), mappings };
    }

    function resetForm(widget = null) {
        const form = $('widget_form');
        form.hidden = !widget;
        $('widget_id').value = widget?.id || '';
        $('widget_form_title').textContent = widget?.id ? '编辑组件' : '添加组件';
        $('widget_type').value = widget?.type || 'github';
        $('widget_site').value = widget?.site_id == null ? '' : String(widget.site_id);
        $('widget_visibility').value = widget?.visibility || 'public';
        $('widget_enabled').checked = widget?.enabled !== false && widget?.enabled !== 0;
        $('widget_sort').value = widget?.sort_order ?? 0;
        renderFields(widget?.config || {});
    }

    function renderList() {
        const list = $('widget_list');
        list.replaceChildren();
        for (const widget of widgets) {
            const row = document.createElement('div');
            row.className = 'widget-list-row';
            const title = document.createElement('strong');
            const site = sites.find(item => Number(item.id) === Number(widget.site_id));
            title.textContent = `${names[widget.type] || widget.type} · ${site?.name || '顶部信息栏'}`;
            const state = document.createElement('small');
            state.textContent = `${widget.visibility === 'private' ? '仅管理员' : '公开'} · ${widget.enabled ? '已启用' : '已停用'}`;
            const edit = document.createElement('button');
            edit.type = 'button'; edit.textContent = '编辑';
            edit.addEventListener('click', () => { resetForm(widget); $('widget_form').scrollIntoView({ block: 'nearest' }); });
            const remove = document.createElement('button');
            remove.type = 'button'; remove.textContent = '删除';
            remove.addEventListener('click', async () => {
                if (!window.confirm(`删除 ${title.textContent}？`)) return;
                const res = await fetch(`/api/admin/widgets/${widget.id}`, { method: 'DELETE', headers: authHeaders() });
                if (!res.ok) return showToast('删除组件失败', 'error');
                await load();
                showToast('组件已删除');
            });
            row.append(title, state, edit, remove);
            list.append(row);
        }
        if (!widgets.length) list.textContent = '尚无组件。可先添加天气、GitHub 仓库或公开状态页。';
    }

    async function load() {
        $('widget_status').textContent = '正在加载组件…';
        $('widgetRetryBtn').hidden = true;
        $('widgetAddBtn').hidden = true;
        try {
            const [siteResponse, widgetResponse] = await Promise.all([
                fetch('/api/sites'), fetch('/api/admin/widgets', { headers: authHeaders() }),
            ]);
            if (!siteResponse.ok || !widgetResponse.ok) throw new Error('请求失败');
            sites = await siteResponse.json();
            widgets = await widgetResponse.json();
            if (!Array.isArray(sites) || !Array.isArray(widgets)) throw new Error('数据格式错误');
            const selected = $('widget_site').value;
            $('widget_site').replaceChildren();
            const empty = document.createElement('option');
            empty.value = ''; empty.textContent = '选择站点';
            $('widget_site').append(empty);
            sites.forEach(site => {
                const option = document.createElement('option');
                option.value = String(site.id); option.textContent = site.name;
                $('widget_site').append(option);
            });
            $('widget_site').value = selected;
            $('widget_status').textContent = '';
            $('widgetAddBtn').hidden = false;
            renderList();
        } catch {
            $('widget_status').textContent = '组件加载失败，现有配置未修改。';
            $('widgetRetryBtn').hidden = false;
        }
    }

    $('widget_type').addEventListener('change', () => renderFields());
    $('widgetRetryBtn').addEventListener('click', load);
    $('widgetAddBtn').addEventListener('click', () => resetForm({}));
    $('widgetCancelBtn').addEventListener('click', () => resetForm());
    $('widget_form').addEventListener('submit', async event => {
        event.preventDefault();
        const type = $('widget_type').value;
        if (type !== 'weather' && !$('widget_site').value) return showToast('请选择关联站点', 'error');
        const id = $('widget_id').value;
        const payload = {
            site_id: type === 'weather' ? null : Number($('widget_site').value),
            type,
            visibility: $('widget_visibility').value,
            enabled: $('widget_enabled').checked,
            sort_order: Number($('widget_sort').value),
            config: readConfig(),
        };
        const submit = $('widget_form').querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
            const res = await fetch(id ? `/api/admin/widgets/${id}` : '/api/admin/widgets', {
                method: id ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || '保存失败');
            }
            resetForm();
            await load();
            showToast('组件已保存');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            submit.disabled = false;
        }
    });
    requireLogin().then(me => { if (me?.role === 'admin') load(); });
})();
