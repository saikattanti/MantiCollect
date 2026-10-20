document.addEventListener('DOMContentLoaded', async () => {
  const connectionBadge = document.getElementById('connection-badge');
  const connectionText = document.getElementById('connection-text');
  const tabUrlElem = document.getElementById('tab-url');
  const providerBadge = document.getElementById('provider-badge');
  const supportStatus = document.getElementById('support-status');
  const btnSend = document.getElementById('btn-send');
  const btnFocus = document.getElementById('btn-focus');
  const statusMessage = document.getElementById('status-message');
  const bridgeTypeElem = document.getElementById('bridge-type');

  // Settings elements
  const inputPort = document.getElementById('input-port');
  const inputToken = document.getElementById('input-token');
  const checkInterception = document.getElementById('check-interception');
  const btnSaveSettings = document.getElementById('btn-save-settings');

  let activeTabUrl = '';
  let activeTabTitle = '';
  let isConnected = false;

  // Load saved settings into form
  chrome.storage.local.get(['bridgePort', 'authToken', 'downloadInterception'], (items) => {
    if (items.bridgePort) inputPort.value = items.bridgePort;
    if (items.authToken) inputToken.value = items.authToken;
    if (items.downloadInterception !== undefined) checkInterception.checked = items.downloadInterception;
  });

  // Save settings handler
  btnSaveSettings.addEventListener('click', () => {
    const port = parseInt(inputPort.value, 10) || 52443;
    const token = inputToken.value.trim();
    const interception = checkInterception.checked;

    chrome.storage.local.set(
      {
        bridgePort: port,
        authToken: token,
        downloadInterception: interception
      },
      () => {
        showStatus('Settings saved. Rechecking connection…', 'ok');
        checkConnection();
      }
    );
  });

  function showStatus(text, type = 'ok') {
    statusMessage.textContent = text;
    statusMessage.className = `status-box status-${type}`;
    statusMessage.classList.remove('hidden');
  }

  function hideStatus() {
    statusMessage.classList.add('hidden');
  }

  // Detect current active tab
  async function detectActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        activeTabUrl = tab.url;
        activeTabTitle = tab.title || '';
        tabUrlElem.textContent = tab.url;

        // Check if browser internal or unsupported scheme
        if (!/^https?:\/\//i.test(tab.url)) {
          supportStatus.textContent = 'System/internal pages cannot be downloaded';
          supportStatus.className = 'support-status text-warn';
          btnSend.disabled = true;
          return;
        }

        // Check URL support with MantiCollect
        checkUrlSupport(tab.url);
      } else {
        tabUrlElem.textContent = 'No active tab URL detected';
        supportStatus.textContent = '';
        btnSend.disabled = true;
      }
    } catch (err) {
      tabUrlElem.textContent = 'Error detecting tab';
      btnSend.disabled = true;
    }
  }

  async function checkConnection() {
    connectionBadge.className = 'badge badge-checking';
    connectionText.textContent = 'Checking…';

    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'SEND_TO_DESKTOP', action: 'status' },
          (response) => resolve(response)
        );
      });

      if (res && res.ok) {
        isConnected = true;
        connectionBadge.className = 'badge badge-connected';
        connectionText.textContent = 'Connected';
        bridgeTypeElem.textContent = res.bridge === 'native' ? 'Native Messaging' : 'Loopback Bridge';
        if (activeTabUrl && /^https?:\/\//i.test(activeTabUrl)) {
          checkUrlSupport(activeTabUrl);
        }
      } else {
        isConnected = false;
        connectionBadge.className = 'badge badge-disconnected';
        connectionText.textContent = 'Not Connected';
        bridgeTypeElem.textContent = 'Disconnected';
        btnSend.disabled = true;
        showStatus('Desktop application not reachable. Ensure MantiCollect is running.', 'err');
      }
    } catch {
      isConnected = false;
      connectionBadge.className = 'badge badge-disconnected';
      connectionText.textContent = 'Not Connected';
      btnSend.disabled = true;
    }
  }

  async function checkUrlSupport(url) {
    if (!isConnected) return;

    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'SEND_TO_DESKTOP', action: 'checkUrl', payload: { url } },
          (response) => resolve(response)
        );
      });

      if (res && res.ok && res.supported) {
        providerBadge.textContent = res.providerName || res.provider || 'Supported';
        providerBadge.classList.remove('hidden');
        supportStatus.textContent = res.isDirect ? 'Direct Media Stream' : 'Supported Media Source';
        supportStatus.className = 'support-status text-ok';
        btnSend.disabled = false;
      } else {
        providerBadge.classList.add('hidden');
        supportStatus.textContent = res?.error || 'Unsupported URL';
        supportStatus.className = 'support-status text-warn';
        btnSend.disabled = true;
      }
    } catch {
      supportStatus.textContent = 'Validation error';
      supportStatus.className = 'support-status text-err';
      btnSend.disabled = true;
    }
  }

  // Send link button
  btnSend.addEventListener('click', async () => {
    if (!activeTabUrl || !isConnected) return;
    btnSend.disabled = true;
    btnSend.textContent = 'Sending…';
    hideStatus();

    try {
      const requestId = `popup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'SEND_TO_DESKTOP',
            action: 'enqueue',
            payload: {
              url: activeTabUrl,
              title: activeTabTitle,
              requestId
            }
          },
          (response) => resolve(response)
        );
      });

      if (res && res.ok) {
        if (res.duplicate) {
          showStatus('Already queued or currently downloading in MantiCollect.', 'warn');
        } else {
          showStatus(`Successfully queued in MantiCollect! (Job ID: ${res.id.slice(0, 8)}…)`, 'ok');
        }
      } else {
        showStatus(res?.error || 'Failed to enqueue URL', 'err');
      }
    } catch (err) {
      showStatus(`Error: ${err.message}`, 'err');
    } finally {
      btnSend.disabled = false;
      btnSend.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        </svg>
        Send to MantiCollect
      `;
    }
  });

  // Open App button
  btnFocus.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'SEND_TO_DESKTOP', action: 'focus' });
  });

  // Initial run
  await detectActiveTab();
  await checkConnection();
});
