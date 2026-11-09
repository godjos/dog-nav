// ═══════════════════════════════════════════
// Dog-Nav Chrome Extension - Background Service Worker
// ═══════════════════════════════════════════

function normalizeUrl(raw) {
    if (!raw) return '';
    try {
        const u = new URL(raw.trim());
        let path = u.pathname.replace(/\/+$/, '') || '/';
        return (u.protocol + '//' + u.hostname + (u.port ? ':' + u.port : '') + path + u.search).toLowerCase();
    } catch {
        return raw.trim().toLowerCase().replace(/\/+$/, '');
    }
}

async function updateTabBadge(tabId, url) {
    if (!tabId || !url || !/^https?:\/\//i.test(url)) {
        if (tabId && chrome.action && chrome.action.setBadgeText) {
            chrome.action.setBadgeText({ tabId, text: '' });
        }
        return;
    }

    try {
        const stored = await chrome.storage.local.get(['dognav_collected_urls']);
        const collected = Array.isArray(stored.dognav_collected_urls) ? stored.dognav_collected_urls : [];
        const norm = normalizeUrl(url);
        const isCollected = collected.includes(norm);

        if (isCollected) {
            await chrome.action.setBadgeText({ tabId, text: '★' });
            await chrome.action.setBadgeBackgroundColor({ tabId, color: '#10b981' });
            await chrome.action.setTitle({ tabId, title: '该页面已收录在 Dog-Nav（点击可编辑或删除）' });
        } else {
            await chrome.action.setBadgeText({ tabId, text: '' });
            await chrome.action.setTitle({ tabId, title: '收藏到 Dog-Nav' });
        }
    } catch (e) {
        // Ignored in service worker context
    }
}

// 标签激活或更新时更新角标状态
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url) {
            await updateTabBadge(tab.id, tab.url);
        }
    } catch {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
        await updateTabBadge(tabId, tab.url || changeInfo.url);
    }
});

// 监听来自 popup 的广播消息以刷新徽标
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === 'REFRESH_BADGES') {
        chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
            if (tab && tab.id && tab.url) {
                updateTabBadge(tab.id, tab.url);
            }
        });
        sendResponse({ success: true });
    }
    return true;
});

// 注册右键菜单
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'dognav-save-page',
        title: '收藏此网页到 Dog-Nav',
        contexts: ['page']
    });

    chrome.contextMenus.create({
        id: 'dognav-save-link',
        title: '收藏此链接到 Dog-Nav',
        contexts: ['link']
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    let targetUrl = '';
    let targetTitle = '';

    if (info.menuItemId === 'dognav-save-page') {
        targetUrl = tab ? tab.url : info.pageUrl;
        targetTitle = tab ? tab.title : '';
    } else if (info.menuItemId === 'dognav-save-link') {
        targetUrl = info.linkUrl;
        targetTitle = info.selectionText || '';
    }

    if (!targetUrl) return;

    // 打开独立弹窗窗口进行快速收藏
    const popupUrl = chrome.runtime.getURL(
        `popup.html?url=${encodeURIComponent(targetUrl)}&title=${encodeURIComponent(targetTitle)}`
    );

    chrome.windows.create({
        url: popupUrl,
        type: 'popup',
        width: 480,
        height: 640
    });
});
