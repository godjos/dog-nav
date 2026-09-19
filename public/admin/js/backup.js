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

        // 导入结果汇总：各表计数 + 被跳过的设置项数量 + 恢复的图标文件数
        function importSummary(result) {
            const c = result.counts || {};
            const parts = ['sites', 'categories', 'tags', 'links', 'pages']
                .filter(k => typeof c[k] === 'number')
                .map(k => `${k}: ${c[k]}`);
            let msg = '导入成功' + (parts.length ? '（' + parts.join('，') + '）' : '');
            if (result.skippedSettings > 0) msg += `，已跳过 ${result.skippedSettings} 项非公开设置`;
            if (result.iconsRestored > 0) msg += `，已恢复 ${result.iconsRestored} 个站点图标文件`;
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

        let pendingBookmarks = null; // 已解析待确认导入的书签树

        function renderBookmarkPreview(result, fileName) {
            const preview = document.getElementById('bookmarkPreview');
            const summary = document.getElementById('bookmarkSummary');
            const list = document.getElementById('bookmarkList');
            if (result.totalSites === 0) return false;
            const folders = result.roots.filter(n => n.children);
            const flat = result.roots.filter(n => n.url);
            const folderCount = folders.length;
            const parts = [];
            if (folderCount) parts.push(`${folderCount} 个分类`);
            if (flat.length) parts.push(`${flat.length} 个未分类站点`);
            summary.textContent = `「${fileName}」解析成功：共 ${result.totalSites} 个站点` +
                (parts.length ? `（${parts.join('，')}）` : '') + '，将跳过与现有站点重复的条目。';
            list.textContent = '';
            const items = [];
            const collect = (nodes, prefix) => nodes.forEach(n => {
                if (n.url) items.push((prefix ? prefix + ' / ' : '') + n.title);
                else if (n.children) collect(n.children, prefix ? prefix + ' / ' + n.title : n.title);
            });
            collect(result.roots, '');
            const MAX_LIST = 200;
            items.slice(0, MAX_LIST).forEach(text => {
                const li = document.createElement('li');
                li.textContent = text;
                list.appendChild(li);
            });
            if (items.length > MAX_LIST) {
                const li = document.createElement('li');
                li.className = 'bm-empty';
                li.textContent = `…还有 ${items.length - MAX_LIST} 个站点`;
                list.appendChild(li);
            }
            preview.hidden = false;
            return true;
        }

        function resetBookmarkImport() {
            pendingBookmarks = null;
            document.getElementById('bookmarkPreview').hidden = true;
            document.getElementById('bookmarkFile').value = '';
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
            try {
                setStatus('正在读取并解析书签…');
                const text = await readFileWithProgress(file, (p) => setProgress(p * 100));
                const result = DogNavBookmarkParser.parse(text);
                if (result.error || result.totalSites === 0) {
                    const msg = result.error === 'json'
                        ? '导入失败：文件不是有效的 JSON，请检查书签文件后重试。'
                        : result.error === 'empty'
                            ? '导入失败：文件为空。'
                            : result.error === 'unsupported'
                                ? '导入失败：无法识别的书签格式，请使用浏览器导出的书签 JSON 或 HTML 文件。'
                                : '导入失败：文件中没有可导入的书签。';
                    setStatus(msg, 'error');
                    showToast(msg, 'error');
                    return;
                }
                if (!renderBookmarkPreview(result, file.name)) {
                    setStatus('导入失败：文件中没有可导入的书签。', 'error');
                    return;
                }
                pendingBookmarks = result.roots;
                setStatus('请确认上方的导入预览。');
            } catch (err) {
                setStatus('导入失败：文件读取失败，请重试。', 'error');
                showToast('文件读取失败', 'error');
            } finally {
                input.disabled = false;
            }
        }

        async function confirmImportBookmarks() {
            if (!pendingBookmarks) return;
            const roots = pendingBookmarks;
            const input = document.getElementById('bookmarkFile');
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

            document.getElementById('bookmarkPreview').hidden = true;
            wrap.hidden = false;
            setProgress(100);
            setIndeterminate(true);
            setStatus('正在写入分类和站点…');
            try {
                const res = await fetch('/api/import/bookmarks', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify(roots)
                });
                const result = await res.json().catch(() => ({}));
                if (res.ok) {
                    setIndeterminate(false);
                    setStatus(`导入完成：${result.sites} 个站点、${result.categories} 个分类已写入。图标可在「站点管理」页批量修复。`, 'success');
                    showToast(`导入成功：${result.sites} 个站点，${result.categories} 个分类`);
                    resetBookmarkImport();
                } else if (res.status === 400) {
                    const msg = result.error === 'No bookmarks found'
                        ? '导入失败：文件中没有可导入的书签。'
                        : '导入失败：' + (result.error || '请求无效');
                    setStatus(msg, 'error');
                    showToast(msg, 'error');
                } else if (res.status === 403 || res.status === 429 || res.status === 401) {
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
                document.getElementById('bookmarkProgressWrap').hidden = true;
            }
        }

        // 导出按钮与文件导入的事件绑定（原 onclick/onchange，CSP 下改为 JS 绑定）
        document.getElementById('exportBtn').addEventListener('click', exportData);
        document.getElementById('importFile').addEventListener('change', importData);
        document.getElementById('bookmarkFile').addEventListener('change', importBookmarks);
        document.getElementById('bookmarkConfirmBtn').addEventListener('click', confirmImportBookmarks);
        document.getElementById('bookmarkCancelBtn').addEventListener('click', resetBookmarkImport);
