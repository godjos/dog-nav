        requireLogin();

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

        function readFileWithProgress(file, onProgress) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onprogress = (e) => {
                    if (e.lengthComputable) onProgress(e.loaded / e.total);
                };
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
                reader.readAsText(file);
            });
        }

        async function importBookmarks(event) {
            const input = event.target;
            const file = input.files[0];
            if (!file) return;

            const fileInfo = document.getElementById('bookmarkFileInfo');
            const wrap = document.getElementById('bookmarkProgressWrap');
            const fill = document.getElementById('bookmarkProgressFill');
            const pctText = document.getElementById('bookmarkProgressText');
            const statusEl = document.getElementById('bookmarkImportStatus');

            const setProgress = (pct) => {
                fill.style.width = pct + '%';
                pctText.textContent = Math.round(pct) + '%';
            };
            const setIndeterminate = (on) => wrap.classList.toggle('indeterminate', on);
            const setStatus = (msg, type) => {
                statusEl.textContent = msg;
                statusEl.className = 'import-status' + (type ? ' ' + type : '');
            };

            input.disabled = true;
            fileInfo.hidden = false;
            fileInfo.textContent = `已选择：${file.name}（${(file.size / 1024).toFixed(1)} KB）`;
            wrap.hidden = false;
            try {
                setStatus('正在读取文件…');
                const text = await readFileWithProgress(file, (p) => setProgress(p * 100));

                setStatus('正在解析书签…');
                let data;
                try {
                    data = JSON.parse(text);
                } catch {
                    setStatus('导入失败：文件不是有效的 JSON，请导出浏览器书签后重试。', 'error');
                    showToast('文件格式错误：不是有效的 JSON', 'error');
                    return;
                }

                setStatus('正在写入分类和站点…');
                setIndeterminate(true);
                const res = await fetch('/api/import/bookmarks', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify(data)
                });
                const result = await res.json().catch(() => ({}));
                if (res.ok) {
                    setIndeterminate(false);
                    setProgress(100);
                    setStatus(`导入完成：${result.sites} 个站点、${result.categories} 个分类已写入。图标可在「站点管理」页批量修复。`, 'success');
                    showToast(`导入成功：${result.sites} 个站点，${result.categories} 个分类`);
                } else if (res.status === 400) {
                    const msg = result.error === 'No bookmarks found'
                        ? '导入失败：文件中没有可导入的书签。'
                        : '导入失败：' + (result.error || '请求无效');
                    setStatus(msg, 'error');
                    showToast(msg, 'error');
                } else if (res.status === 403 || res.status === 429 || res.status === 401) {
                    // 401/403 由 auth.js 统一跳转/提示，429 已提示频率限制
                    setStatus('导入未执行：没有权限或操作过于频繁。', 'error');
                } else {
                    setStatus('导入失败：' + (result.error || '服务器错误'), 'error');
                    showToast(result.error || '导入失败', 'error');
                }
            } catch (err) {
                setStatus('导入失败：网络错误，请检查连接后重试。', 'error');
                showToast('网络错误，导入失败', 'error');
            } finally {
                setIndeterminate(false);
                input.disabled = false;
                input.value = '';
            }
        }

        // 导出按钮与文件导入的事件绑定（原 onclick/onchange，CSP 下改为 JS 绑定）
        document.getElementById('exportBtn').addEventListener('click', exportData);
        document.getElementById('importFile').addEventListener('change', importData);
        document.getElementById('bookmarkFile').addEventListener('change', importBookmarks);
