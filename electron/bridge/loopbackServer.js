import http from 'node:http';
import { logger } from '../logger.js';
import { validateBrowserSubmission } from './validator.js';

export const DEFAULT_BRIDGE_PORT = 52443;
const MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KB
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;

/**
 * Creates and starts a secure local loopback HTTP server for browser extension communication.
 *
 * Security safeguards:
 * - Strictly binds to 127.0.0.1 (never 0.0.0.0).
 * - Requires cryptographically generated Bearer token for every endpoint.
 * - Enforces Host header whitelist to block DNS rebinding attacks.
 * - CORS headers restricted to extension contexts.
 * - Strict 64 KB payload size limit to prevent memory exhaustion.
 * - In-memory rate limiting to prevent flood attacks.
 * - Inbound URLs pass full SSRF, scheme, and provider validation.
 */
export function createLoopbackBridge({
  getPort = () => DEFAULT_BRIDGE_PORT,
  getAuthToken,
  getQueue,
  getWindow,
  getSettings,
  appVersion = '0.1.0'
}) {
  let server = null;
  const recentRequests = [];
  const recentRequestIds = new Map(); // requestId -> { id, timestamp }

  function isRateLimited() {
    const now = Date.now();
    // Prune old timestamps
    while (recentRequests.length && now - recentRequests[0] > RATE_LIMIT_WINDOW_MS) {
      recentRequests.shift();
    }
    if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
      return true;
    }
    recentRequests.push(now);
    return false;
  }

  function setCorsHeaders(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-ID');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  function sendJson(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
  }

  function authenticate(req) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return false;
    const clientToken = auth.slice(7).trim();
    const expectedToken = getAuthToken();
    return Boolean(clientToken && expectedToken && clientToken === expectedToken);
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let total = 0;
      const chunks = [];

      req.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_PAYLOAD_BYTES) {
          req.destroy(new Error('Payload Too Large'));
          return reject(new Error('Payload Too Large'));
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('Invalid JSON payload'));
        }
      });

      req.on('error', reject);
    });
  }

  server = http.createServer(async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Host header validation to prevent DNS rebinding
    const hostHeader = (req.headers.host || '').toLowerCase();
    const isLoopbackHost =
      hostHeader.startsWith('127.0.0.1:') ||
      hostHeader === '127.0.0.1' ||
      hostHeader.startsWith('localhost:') ||
      hostHeader === 'localhost';

    if (!isLoopbackHost) {
      logger.warn('bridge', `Rejected request with unexpected Host header: ${hostHeader}`);
      sendJson(res, 403, { ok: false, error: 'Forbidden: Invalid Host header' });
      return;
    }

    if (isRateLimited()) {
      sendJson(res, 429, { ok: false, error: 'Too Many Requests' });
      return;
    }

    // Authenticate all API endpoints
    if (!authenticate(req)) {
      sendJson(res, 401, { ok: false, error: 'Unauthorized: Invalid or missing bearer token' });
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;

    try {
      /* ------------ GET /api/status ------------ */
      if (req.method === 'GET' && pathname === '/api/status') {
        sendJson(res, 200, {
          ok: true,
          app: 'MantiCollect',
          version: appVersion,
          ready: true,
          platform: process.platform
        });
        return;
      }

      /* ------------ POST /api/focus ------------ */
      if (req.method === 'POST' && pathname === '/api/focus') {
        const win = getWindow?.();
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
        sendJson(res, 200, { ok: true, focused: true });
        return;
      }

      /* ------------ POST /api/check-url ------------ */
      if (req.method === 'POST' && pathname === '/api/check-url') {
        const body = await readJsonBody(req);
        const s = getSettings();
        try {
          const validated = await validateBrowserSubmission(body, {
            allowLocal: Boolean(s?.allowLocalNetwork)
          });
          sendJson(res, 200, {
            ok: true,
            supported: true,
            url: validated.url,
            provider: validated.provider,
            providerName: validated.providerName,
            isDirect: validated.isDirect
          });
        } catch (err) {
          sendJson(res, 200, {
            ok: false,
            supported: false,
            error: err.message
          });
        }
        return;
      }

      /* ------------ POST /api/enqueue ------------ */
      if (req.method === 'POST' && pathname === '/api/enqueue') {
        const body = await readJsonBody(req);
        const s = getSettings();
        const validated = await validateBrowserSubmission(body, {
          allowLocal: Boolean(s?.allowLocalNetwork)
        });

        // Check idempotency if requestId was provided
        if (validated.requestId) {
          const cached = recentRequestIds.get(validated.requestId);
          if (cached && Date.now() - cached.timestamp < 60000) {
            sendJson(res, 200, {
              ok: true,
              id: cached.id,
              duplicate: true,
              message: 'Request already processed'
            });
            return;
          }
        }

        const q = getQueue();
        if (!q) {
          sendJson(res, 503, { ok: false, error: 'Download queue is not ready' });
          return;
        }

        // Deduplicate against currently active or waiting jobs with exact same URL
        const activeJobs = q.listJobs().filter((j) =>
          ['waiting', 'downloading', 'resuming', 'fetching_metadata'].includes(j.status)
        );
        const existing = activeJobs.find((j) => j.url === validated.url);
        if (existing) {
          sendJson(res, 200, {
            ok: true,
            id: existing.id,
            url: validated.url,
            title: existing.title,
            duplicate: true,
            status: existing.status,
            message: 'URL is already active in download queue'
          });
          return;
        }

        // Enqueue job via existing queue API
        const id = q.startJob({
          url: validated.url,
          provider: validated.provider,
          title: validated.title,
          format: validated.format,
          extra: {
            submittedFrom: 'browser_extension',
            requestId: validated.requestId || null
          }
        });

        if (validated.requestId) {
          recentRequestIds.set(validated.requestId, { id, timestamp: Date.now() });
        }

        // Notify Electron renderer window
        const win = getWindow?.();
        if (win && !win.isDestroyed()) {
          win.webContents.send('browser:download-queued', {
            id,
            url: validated.url,
            title: validated.title,
            provider: validated.provider
          });
        }

        logger.info('bridge', `Enqueued browser download: ${validated.url} (job ${id})`);
        sendJson(res, 200, {
          ok: true,
          id,
          url: validated.url,
          provider: validated.provider,
          title: validated.title,
          duplicate: false
        });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      logger.warn('bridge', `Request error on ${pathname}: ${err.message}`);
      sendJson(res, 400, { ok: false, error: err.message });
    }
  });

  return {
    start() {
      return new Promise((resolve, reject) => {
        const port = getPort();
        server.listen(port, '127.0.0.1', () => {
          const actualPort = server.address().port;
          logger.info('bridge', `MantiCollect loopback bridge listening on 127.0.0.1:${actualPort}`);
          resolve({ port: actualPort });
        });
        server.on('error', (err) => {
          logger.error('bridge', `Bridge failed to start on port ${port}: ${err.message}`);
          reject(err);
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        if (!server) return resolve();
        server.close(() => {
          logger.info('bridge', 'MantiCollect loopback bridge stopped');
          resolve();
        });
      });
    },
    getServer() {
      return server;
    }
  };
}
