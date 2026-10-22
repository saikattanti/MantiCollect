/**
 * MantiCollect Browser Extension - Background Service Worker (Manifest V3)
 *
 * Provides:
 * 1. Context menu integration (links, pages, selection).
 * 2. Bridge communication (Native Messaging with Loopback HTTP fallback).
 * 3. Notification and status badge feedback.
 * 4. Optional download interception when explicitly enabled by user.
 */

const NATIVE_HOST_NAME = 'com.mantitup.manticollect';
const DEFAULT_PORT = 52443;

// Initialize context menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'manticollect-download-link',
      title: 'Download with MantiCollect',
      contexts: ['link']
    });

    chrome.contextMenus.create({
      id: 'manticollect-download-page',
      title: 'Send Page URL to MantiCollect',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'manticollect-download-selection',
      title: 'Download Selection in MantiCollect',
      contexts: ['selection']
    });
  });
});

async function getStorageConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['bridgePort', 'authToken', 'downloadInterception'], (items) => {
      resolve({
        port: items.bridgePort || DEFAULT_PORT,
        token: items.authToken || '',
        downloadInterception: Boolean(items.downloadInterception)
      });
    });
  });
}

function sanitizeUrlForDisplay(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return String(rawUrl).split(/[?#]/)[0];
  }
}

function showNotification(title, message, isError = false) {
  try {
    // Redact tokens/secrets from messages
    const sanitized = String(message)
      .replace(/([?&](?:token|sig|key|signature|auth)=)[^&\s]+/gi, '$1***')
      .slice(0, 150);

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: `MantiCollect: ${title}`,
      message: sanitized,
      priority: isError ? 2 : 1
    });
  } catch {}
}

function setBadge(text, color) {
  try {
    chrome.action.setBadgeText({ text });
    if (color) chrome.action.setBadgeBackgroundColor({ color });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, 4000);
  } catch {}
}

/**
 * Communicates with MantiCollect desktop application.
 * Tries Native Messaging first; falls back to authenticated loopback HTTP API.
 */
async function sendToDesktop(action, payload = {}) {
  // 1. Try Native Messaging
  const nativeResult = await new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(
        NATIVE_HOST_NAME,
        { action, ...payload },
        (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve(null);
          } else {
            resolve(response);
          }
        }
      );
    } catch {
      resolve(null);
    }
  });

  if (nativeResult) {
    return { ...nativeResult, bridge: 'native' };
  }

  // 2. Fallback to Authenticated Loopback HTTP Bridge
  const config = await getStorageConfig();
  const endpointMap = {
    status: '/api/status',
    ping: '/api/status',
    enqueue: '/api/enqueue',
    checkUrl: '/api/check-url',
    focus: '/api/focus'
  };

  const endpoint = endpointMap[action] || '/api/status';
  const method = action === 'status' || action === 'ping' ? 'GET' : 'POST';

  try {
    const fetchOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`
      }
    };
    if (method === 'POST') {
      fetchOptions.body = JSON.stringify(payload);
    }

    const res = await fetch(`http://127.0.0.1:${config.port}${endpoint}`, fetchOptions);
    const data = await res.json();
    return { ...data, bridge: 'loopback' };
  } catch (err) {
    return {
      ok: false,
      error: 'Could not connect to MantiCollect. Make sure the desktop app is open and your auth token matches.',
      bridge: 'none'
    };
  }
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let targetUrl = '';
  if (info.menuItemId === 'manticollect-download-link' && info.linkUrl) {
    targetUrl = info.linkUrl;
  } else if (info.menuItemId === 'manticollect-download-page' && info.pageUrl) {
    targetUrl = info.pageUrl;
  } else if (info.menuItemId === 'manticollect-download-selection' && info.selectionText) {
    targetUrl = info.selectionText.trim();
  }

  if (!targetUrl) return;

  const res = await sendToDesktop('enqueue', {
    url: targetUrl,
    title: tab?.title || '',
    requestId: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  });

  if (res.ok) {
    if (res.duplicate) {
      showNotification('Already Queued', `${res.title || sanitizeUrlForDisplay(targetUrl)} is already in the download queue.`);
      setBadge('!', '#eab308');
    } else {
      showNotification('Download Added', `${res.title || 'Job enqueued'} successfully.`);
      setBadge('✓', '#22c55e');
    }
  } else {
    showNotification('Download Failed', res.error || 'Failed to enqueue URL', true);
    setBadge('✕', '#ef4444');
  }
});

// Listener for popup messages
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req.type === 'SEND_TO_DESKTOP') {
    sendToDesktop(req.action, req.payload).then(sendResponse);
    return true; // async response
  }
});

// Optional Download Interception (strictly opt-in, disabled by default)
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  const config = await getStorageConfig();
  if (!config.downloadInterception) return;

  const url = downloadItem.finalUrl || downloadItem.url;
  if (!url || !/^https?:\/\//i.test(url)) return;

  // Avoid intercepting extension internal downloads
  if (url.startsWith('blob:') || url.startsWith('data:')) return;

  try {
    // Attempt enqueue to MantiCollect
    const res = await sendToDesktop('enqueue', {
      url,
      title: downloadItem.filename ? downloadItem.filename.split(/[\\/]/).pop() : '',
      requestId: `intercept-${downloadItem.id}`
    });

    if (res && res.ok) {
      // Successfully handed off to desktop: cancel browser download
      chrome.downloads.cancel(downloadItem.id, () => {
        chrome.downloads.erase({ id: downloadItem.id }, () => {});
      });
      showNotification('Download Captured', `Transferred to MantiCollect: ${res.title || sanitizeUrlForDisplay(url)}`);
    }
  } catch {}
});
