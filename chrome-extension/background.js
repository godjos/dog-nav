// ═══════════════════════════════════════════
// Dog-Nav Chrome Extension - Background Service Worker
// ═══════════════════════════════════════════

chrome.runtime.onInstalled.addListener(() => {
    // 注册右键菜单
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
