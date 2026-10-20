import electron from 'electron';
import { normalizeUrlInput, assertPublicUrl } from './security.js';
import { resolveProvider } from './providers/registry.js';
import { MAX_URL_LENGTH } from './bridge/validator.js';

const electronClipboard = typeof electron === 'object' && electron?.clipboard ? electron.clipboard : null;

/**
 * Consent-driven clipboard URL detector.
 *
 * Requirements:
 * - Disabled by default.
 * - Non-invasive: checks upon window focus and a low-frequency 3s timer only when window is active.
 * - Ignores passwords, auth tokens, plain text, and non-URL content.
 * - Never auto-downloads; strictly emits a proposal event requiring explicit user consent.
 * - Deduplicates: never prompts repeatedly for the same copied URL.
 * - Does not log arbitrary clipboard text or persist clipboard content to disk.
 */
export function createClipboardDetector({
  getWindow,
  getSettings,
  readClipboardText = () => (electronClipboard ? electronClipboard.readText() : ''),
  pollIntervalMs = 3000
} = {}) {
  let lastDetectedUrl = null;
  let timer = null;
  let running = false;

  async function checkClipboard() {
    const s = getSettings();
    if (!s?.clipboardDetection) return;

    let text = '';
    try {
      text = String(readClipboardText() || '').trim();
    } catch {
      return;
    }

    if (!text || text.length > MAX_URL_LENGTH) return;
    if (!/^https?:\/\//i.test(text)) return;
    if (text === lastDetectedUrl) return;

    let parsed;
    try {
      parsed = new URL(text);
    } catch {
      return;
    }

    // Reject embedded credentials
    if (parsed.username || parsed.password) return;

    try {
      const normalized = normalizeUrlInput(text);
      await assertPublicUrl(normalized, { allowLocal: Boolean(s.allowLocalNetwork) });
      const provider = resolveProvider(normalized);
      if (!provider) return;

      lastDetectedUrl = text;

      const win = getWindow?.();
      if (win && !win.isDestroyed()) {
        win.webContents.send('clipboard:detected', {
          url: normalized,
          provider: provider.id,
          providerName: provider.name,
          isDirect: !!provider.isDirect
        });
      }
    } catch {
      // Intentionally ignore validation failures to avoid spamming logs or UI with invalid clipboard text
    }
  }

  return {
    start() {
      if (running) return;
      running = true;

      // Check on focus
      const win = getWindow?.();
      if (win && !win.isDestroyed()) {
        win.on('focus', () => {
          checkClipboard();
        });
      }

      // Low-frequency background tick
      timer = setInterval(() => {
        const currentWin = getWindow?.();
        if (currentWin && !currentWin.isDestroyed() && currentWin.isVisible()) {
          checkClipboard();
        }
      }, pollIntervalMs);
    },
    stop() {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    checkNow() {
      return checkClipboard();
    },
    getLastDetectedUrl() {
      return lastDetectedUrl;
    },
    clearLastDetectedUrl() {
      lastDetectedUrl = null;
    }
  };
}
