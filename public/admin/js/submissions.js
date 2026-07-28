        requireLogin();

        const SUB_STATUS = {
            pending: '待审核',
            approved: '已通过',
            rejected: '已拒绝'
        };

        let subsCache = [];
        let categories = [];
        let approvingId = null;

        async function loadCategories() {
            try {
                const res = await fetch('/api/categories');
                if (res.ok) categories = await res.json();
            } catch (err) { /* 分类加载失败时下拉为空，确认收录会被服务端 400 拦截 */ }
        }

        function fillCategorySelect(selected) {
            const sel = document.getElementById('apprCategory');
            sel.textContent = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '请选择分类';
            sel.appendChild(placeholder);
            categories.filter(c => c.is_active).forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = `${c.icon || '📁'} ${c.name}`;
                sel.appendChild(opt);
            });
            // 投稿带来的分类可能已停用：保留该值以便管理员看清原选择
            if (selected && !categories.some(c => String(c.id) === String(selected))) {
                const opt = document.createElement('option');
                opt.value = selected;
                opt.textContent = `${selected}（已停用）`;
                sel.appendChild(opt);
            }
            sel.value = selected || '';
        }

        function openApproveModal(id) {
            const sub = subsCache.find(s => Number(s.id) === Number(id));
            if (!sub) return;
            approvingId = sub.id;
            document.getElementById('apprName').value = sub.name || '';
            document.getElementById('apprDesc').value = sub.description || '';
            document.getElementById('apprIcon').value = sub.icon || '';
            fillCategorySelect(sub.category);
            // 预填行内已输入的备注
            const noteInput = document.querySelector(`input[data-note-for="${Number(sub.id) || 0}"]`);
            document.getElementById('apprNote').value = noteInput ? noteInput.value : '';
            const errEl = document.getElementById('apprError');
            errEl.classList.remove('show');
            errEl.textContent = '';
            document.getElementById('modalOverlay').classList.add('show');
        }

        function closeApproveModal() {
            approvingId = null;
            document.getElementById('modalOverlay').classList.remove('show');
        }

        async function loadSubmissions() {
            const res = await fetch('/api/submissions', { headers: authHeaders() });
            const subs = await res.json();
            subsCache = Array.isArray(subs) ? subs : [];
            const tbody = document.getElementById('submissionsBody');
            const empty = document.getElementById('emptyState');

            if (subsCache.length === 0) {
                tbody.innerHTML = '';
                empty.style.display = 'block';
                return;
            }
            empty.style.display = 'none';

            tbody.innerHTML = subsCache.map(s => {
                const sid = Number(s.id) || 0;
                const status = Object.prototype.hasOwnProperty.call(SUB_STATUS, s.status) ? s.status : 'pending';
                const safeUrl = sanitizeUrl(s.url);
                const urlCell = safeUrl
                    ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener" style="color:#667eea">${escapeHtml(s.url)}</a>`
                    : escapeHtml(s.url || '-');
                return `
                <tr>
                    <td><strong>${escapeHtml(s.name)}</strong></td>
                    <td>${urlCell}</td>
                    <td>${escapeHtml(s.description || '-')}</td>
                    <td>${escapeHtml(s.category || '-')}</td>
                    <td>${escapeHtml(s.submitter_email || '匿名')}</td>
                    <td><span class="badge badge-${status}">${SUB_STATUS[status]}</span></td>
                    <td>${escapeHtml(new Date(s.created_at).toLocaleString('zh-CN'))}</td>
                    <td>
                        ${s.status === 'pending' ? `
                            <input type="text" class="note-input" data-note-for="${sid}" placeholder="审核备注（选填）" maxlength="200">
                            <button class="btn-approve" data-action="approve" data-id="${sid}">通过</button>
                            <button class="btn-reject" data-action="reject" data-id="${sid}">拒绝</button>
                        ` : (s.review_note ? escapeHtml(s.review_note) : '-')}
                    </td>
                </tr>`;
            }).join('');
        }

        // 拒绝：携带行内 review_note
        async function reject(id) {
            const noteInput = document.querySelector(`input[data-note-for="${id}"]`);
            const reviewNote = noteInput ? noteInput.value.trim() : '';
            const res = await fetch(`/api/submissions/${id}`, {
                method: 'PUT',
                headers: authHeaders(),
                body: JSON.stringify({ status: 'rejected', review_note: reviewNote })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(data.error || '操作失败，请稍后重试');
            }
            loadSubmissions();
        }

        // 确认收录：PUT status=approved + 编辑后的字段，400 时展示服务端 error
        document.getElementById('approveForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (approvingId === null) return;
            const btn = document.getElementById('apprSubmit');
            const errEl = document.getElementById('apprError');
            errEl.classList.remove('show');
            btn.disabled = true;
            btn.textContent = '提交中...';
            try {
                const res = await fetch(`/api/submissions/${approvingId}`, {
                    method: 'PUT',
                    headers: authHeaders(),
                    body: JSON.stringify({
                        status: 'approved',
                        name: document.getElementById('apprName').value.trim(),
                        description: document.getElementById('apprDesc').value.trim(),
                        icon: document.getElementById('apprIcon').value.trim(),
                        category: document.getElementById('apprCategory').value,
                        review_note: document.getElementById('apprNote').value.trim()
                    })
                });
                if (res.ok) {
                    closeApproveModal();
                    loadSubmissions();
                } else {
                    const data = await res.json().catch(() => ({}));
                    errEl.textContent = data.error || '收录失败，请检查填写内容';
                    errEl.classList.add('show');
                }
            } catch (err) {
                errEl.textContent = '网络错误，请稍后重试';
                errEl.classList.add('show');
            }
            btn.disabled = false;
            btn.textContent = '确认收录';
        });

        document.getElementById('apprCancel').addEventListener('click', closeApproveModal);
        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeApproveModal();
        });

        // 行内按钮：事件委托（CSP 下用 JS 绑定，不用内联事件属性）
        document.getElementById('submissionsBody').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const id = Number(btn.dataset.id);
            if (btn.dataset.action === 'approve') openApproveModal(id);
            else if (btn.dataset.action === 'reject') reject(id);
        });

        loadCategories();
        loadSubmissions();
