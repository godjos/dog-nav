// ═══════════════════════════════════════════
// DogNav 浏览器书签解析器（公共前后台共享，UMD）
//   把 Chrome / Firefox / Edge 导出的书签文件解析成统一树：
//     - Chrome/Firefox JSON（roots/children 或数组）
//     - Netscape Bookmark HTML（书签.htm，常见 <DL>/<DT><A>/<H3> 结构）
//   输出：{ roots: [{ title, children: [{ title, url }] }], totalSites }
//   该结构与 POST /api/import/bookmarks 的消费格式一致，前端解析后
//   可先预览再提交，服务端无需理解 HTML。
//   暴露 window.DogNavBookmarkParser / module.exports
// ═══════════════════════════════════════════
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DogNavBookmarkParser = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const UNSAFE_URL = /^\s*(javascript|data|vbscript|file):/i;
    const MAX_DEPTH = 32;

    function decodeEntities(text) {
        return String(text)
            .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'")
            .replace(/&amp;/gi, '&');
    }

    function attr(source, name) {
        const m = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(source);
        return m ? decodeEntities(m[2] !== undefined ? m[2] : m[3]) : '';
    }

    // Netscape Bookmark HTML → roots 树
    function parseHtml(source) {
        const roots = [];
        const stack = [roots];       // 每层是 children 数组
        const folders = [null];      // 与 stack 平行，记录每层的文件夹节点
        let pendingFolder = null;    // <H3> 后紧跟的 <DL> 属于该文件夹
        let inHead = true;           // 跳过 <H1> 之前的标题噪音
        const re = /<H3[^>]*>([\s\S]*?)<\/H3>|<A\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/A\s*>|<\/A\s*>)|<DL[^>]*>|<\/DL\s*>/gi;
        let m;
        while ((m = re.exec(source)) !== null) {
            const token = m[0].toUpperCase();
            if (token.startsWith('<H3')) {
                pendingFolder = { title: decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim() || '未分类', children: [] };
            } else if (token.startsWith('<A')) {
                inHead = false;
                const href = attr(m[2] || '', 'HREF');
                const name = decodeEntities(String(m[3] || '').replace(/<[^>]+>/g, '')).trim();
                if (href && !UNSAFE_URL.test(href)) {
                    stack[stack.length - 1].push({ title: name || href, url: href.trim() });
                }
            } else if (token.startsWith('<DL')) {
                inHead = false;
                if (pendingFolder) {
                    if (stack.length > MAX_DEPTH) { pendingFolder = null; continue; }
                    stack[stack.length - 1].push(pendingFolder);
                    stack.push(pendingFolder.children);
                    folders.push(pendingFolder);
                    pendingFolder = null;
                }
            } else { // </DL>
                if (stack.length > 1) { stack.pop(); folders.pop(); }
                pendingFolder = null;
            }
        }
        return roots;
    }

    // Chrome 书签 JSON → roots 树（文件夹保留层级）
    function parseJson(data) {
        const roots = [];
        const fill = (folderNode, children, depth) => {
            if (!Array.isArray(children) || depth > MAX_DEPTH) return;
            children.forEach(child => {
                if (!child) return;
                if (child.url) {
                    const url = String(child.url).trim();
                    if (url && !UNSAFE_URL.test(url)) {
                        folderNode.children.push({ title: String(child.title || child.name || url).trim() || url, url });
                    }
                } else if (child.children || child.title !== undefined || child.name !== undefined) {
                    const sub = { title: String(child.title || child.name || '未分类').trim() || '未分类', children: [] };
                    folderNode.children.push(sub);
                    fill(sub, child.children, depth + 1);
                }
            });
        };
        const topNodes = Array.isArray(data) ? data
            : (data && data.roots && typeof data.roots === 'object') ? Object.values(data.roots)
            : [data];
        topNodes.forEach(node => {
            if (!node) return;
            if (node.url) {
                const url = String(node.url).trim();
                if (url && !UNSAFE_URL.test(url)) {
                    roots.push({ title: String(node.title || node.name || url).trim() || url, url });
                }
            } else if (node.children || node.title !== undefined || node.name !== undefined) {
                const folder = { title: String(node.title || node.name || '未分类').trim() || '未分类', children: [] };
                roots.push(folder);
                fill(folder, node.children, 1);
            }
        });
        return roots;
    }

    function countSites(nodes) {
        let total = 0;
        const walk = (list) => (list || []).forEach(n => {
            if (n.url) total++;
            else if (Array.isArray(n.children)) walk(n.children);
        });
        walk(nodes);
        return total;
    }

    // 入口：接受文本（JSON 或 HTML），返回 { roots, totalSites, format }
    function parse(text) {
        if (typeof text !== 'string' || !text.trim()) return { roots: [], totalSites: 0, format: null, error: 'empty' };
        let roots;
        let format;
        const trimmed = text.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            let data;
            try { data = JSON.parse(trimmed); } catch { return { roots: [], totalSites: 0, format: null, error: 'json' }; }
            roots = parseJson(data);
            format = 'json';
        } else if (/<NETSCAPE-Bookmark-file|<DL>/i.test(trimmed) || /<A\s+[^>]*HREF\s*=/i.test(trimmed)) {
            roots = parseHtml(text);
            format = 'html';
        } else {
            return { roots: [], totalSites: 0, format: null, error: 'unsupported' };
        }
        return { roots, totalSites: countSites(roots), format };
    }

    return { parse };
});
