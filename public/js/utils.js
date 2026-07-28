// ═══════════════════════════════════════════
// DogNav 公共前端安全工具（公共页与后台共用）
//   escapeHtml(s)    — 转义文本，安全拼进 HTML
//   sanitizeUrl(url) — 仅允许 http:/https:，其余返回 null
//   sanitizeHtml(html) — 富文本白名单清洗（Quill 产出的 CMS 内容）
// 所有页面需在自身脚本之前引入本文件。
// ═══════════════════════════════════════════
(function () {
    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function sanitizeUrl(url) {
        if (typeof url !== 'string') return null;
        const trimmed = url.trim();
        if (!trimmed) return null;
        try {
            const u = new URL(trimmed, window.location.origin);
            if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
            return null;
        } catch (e) {
            return null;
        }
    }

    // 富文本白名单
    const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'code', 'pre', 'hr']);
    // 这些标签连同内容一起丢弃
    const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe']);

    function sanitizeNode(node, doc) {
        // nodeType: 1=element, 3=text, 8=comment
        if (node.nodeType === 8) return null; // 注释直接剥离
        if (node.nodeType === 3) return doc.createTextNode(node.nodeValue);
        if (node.nodeType !== 1) return null;

        const tag = node.tagName.toLowerCase();
        if (DROP_WITH_CONTENT.has(tag)) return null; // 标签与内容一起丢弃

        if (!ALLOWED_TAGS.has(tag)) {
            // 不允许的标签：剥离标签但保留已清洗的子节点（unwrap）
            const frag = doc.createDocumentFragment();
            node.childNodes.forEach(child => {
                const clean = sanitizeNode(child, doc);
                if (clean) frag.appendChild(clean);
            });
            return frag;
        }

        const el = doc.createElement(tag);
        if (tag === 'a') {
            const href = sanitizeUrl(node.getAttribute('href'));
            if (href) {
                el.setAttribute('href', href);
                el.setAttribute('rel', 'noopener nofollow');
                el.setAttribute('target', '_blank');
            }
            // href 非法时保留为无链接的 <a>（不带任何属性）
        }
        node.childNodes.forEach(child => {
            const clean = sanitizeNode(child, doc);
            if (clean) el.appendChild(clean);
        });
        return el;
    }

    function sanitizeHtml(html) {
        if (typeof html !== 'string' || !html) return '';
        const parser = new DOMParser();
        const src = parser.parseFromString(html, 'text/html');
        const out = document.implementation.createHTMLDocument('');
        const frag = out.createDocumentFragment();
        src.body.childNodes.forEach(child => {
            const clean = sanitizeNode(child, out);
            if (clean) frag.appendChild(clean);
        });
        const holder = out.createElement('div');
        holder.appendChild(frag);
        return holder.innerHTML;
    }

    window.escapeHtml = escapeHtml;
    window.sanitizeUrl = sanitizeUrl;
    window.sanitizeHtml = sanitizeHtml;
})();
