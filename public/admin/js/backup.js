        requireLogin();

        function showToast(msg, type = 'success') {
            const toast = document.getElementById('toast');
            toast.textContent = msg;
            toast.className = 'toast ' + type + ' show';
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        async function exportData() {
            const btn = document.getElementById('exportBtn');
            setBtnLoading(btn, true, '导出中...');
            try {
                const res = await fetch('/api/export', { headers: authHeaders() });
                if (!res.ok) {
                    if (res.status !== 403 && res.status !== 429) showToast('导出失败', 'error');
                    return;
                }
                const data = await res.json();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `dognav-backup-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                showToast('导出成功');
            } catch (err) {
                showToast('导出失败', 'error');
            } finally {
                setBtnLoading(btn, false);
            }
        }

        // 导入结果汇总：各表计数 + 被跳过的设置项数量
        function importSummary(result) {
            const c = result.counts || {};
            const parts = ['sites', 'categories', 'tags', 'links', 'pages']
                .filter(k => typeof c[k] === 'number')
                .map(k => `${k}: ${c[k]}`);
            let msg = '导入成功' + (parts.length ? '（' + parts.join('，') + '）' : '');
            if (result.skippedSettings > 0) msg += `，已跳过 ${result.skippedSettings} 项非公开设置`;
            return msg;
        }

        async function importData(event) {
            const input = event.target;
            const file = input.files[0];
            if (!file) return;
            if (!confirm('导入将覆盖现有数据，确定继续？')) {
                input.value = '';
                return;
            }

            input.disabled = true;
            showToast('导入中，请稍候...');
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                const res = await fetch('/api/import', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify(data)
                });
                const result = await res.json().catch(() => ({}));
                if (res.ok && result.message) {
                    showToast(importSummary(result));
                } else if (res.status === 400) {
                    // 备份结构校验失败：未做任何修改
                    showToast('文件格式错误：' + (result.error || 'Invalid backup'), 'error');
                } else if (res.status === 500) {
                    // 导入中途失败：事务已回滚
                    showToast((result.error || '导入失败') + '，数据已回滚', 'error');
                } else if (res.status !== 403 && res.status !== 429) {
                    showToast(result.error || '导入失败', 'error');
                }
            } catch (err) {
                showToast(err instanceof SyntaxError ? '文件格式错误：不是有效的 JSON' : '导入失败', 'error');
            } finally {
                input.disabled = false;
                input.value = '';
            }
        }

        async function importBookmarks(event) {
            const input = event.target;
            const file = input.files[0];
            if (!file) return;

            input.disabled = true;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                const res = await fetch('/api/import/bookmarks', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify(data)
                });
                const result = await res.json().catch(() => ({}));
                if (res.ok) {
                    showToast(`导入成功：${result.sites} 个站点，${result.categories} 个分类`);
                } else if (res.status !== 403 && res.status !== 429) {
                    showToast(result.error || '导入失败', 'error');
                }
            } catch (err) {
                showToast(err instanceof SyntaxError ? '文件格式错误：不是有效的 JSON' : '导入失败', 'error');
            } finally {
                input.disabled = false;
                input.value = '';
            }
        }

        // 导出按钮与文件导入的事件绑定（原 onclick/onchange，CSP 下改为 JS 绑定）
        document.getElementById('exportBtn').addEventListener('click', exportData);
        document.getElementById('importFile').addEventListener('change', importData);
        document.getElementById('bookmarkFile').addEventListener('change', importBookmarks);
