#!/usr/bin/env node

/**
 * MantiCollect Native Messaging Host
 *
 * Implements the Chromium Native Messaging protocol (stdin/stdout length-prefixed JSON frames).
 * Relays extension messages to the running MantiCollect instance via the local loopback bridge.
 *
 * Output rules:
 * - stdout is strictly reserved for length-prefixed protocol frames.
 * - All logging, debug, and diagnostic output MUST go to stderr.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_MESSAGE_SIZE = 1024 * 1024; // 1 MB

function log(msg) {
  process.stderr.write(`[MantiCollect Host] ${new Date().toISOString()} ${msg}\n`);
}

function sendResponse(obj) {
  try {
    const json = JSON.stringify(obj);
    const bytes = Buffer.from(json, 'utf8');
    if (bytes.length > MAX_MESSAGE_SIZE) {
      log(`Error: Response size ${bytes.length} exceeds 1MB limit`);
      return;
    }
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(bytes.length, 0);
    process.stdout.write(header);
    process.stdout.write(bytes);
  } catch (err) {
    log(`Failed to write response to stdout: ${err.message}`);
  }
}

function getSettingsPath() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const p1 = path.join(appData, 'MediaVault', 'settings.json');
    const p2 = path.join(appData, 'MantiCollect', 'settings.json');
    return fs.existsSync(p1) ? p1 : p2;
  } else if (process.platform === 'darwin') {
    const p1 = path.join(home, 'Library', 'Application Support', 'MediaVault', 'settings.json');
    const p2 = path.join(home, 'Library', 'Application Support', 'MantiCollect', 'settings.json');
    return fs.existsSync(p1) ? p1 : p2;
  } else {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const p1 = path.join(configHome, 'MediaVault', 'settings.json');
    const p2 = path.join(configHome, 'MantiCollect', 'settings.json');
    return fs.existsSync(p1) ? p1 : p2;
  }
}

function loadBridgeCredentials() {
  const p = getSettingsPath();
  try {
    if (fs.existsSync(p)) {
      const s = JSON.parse(fs.readFileSync(p, 'utf8'));
      return {
        port: s.browserBridgePort || 52443,
        token: s.browserAuthToken || ''
      };
    }
  } catch (err) {
    log(`Warning: Failed to read settings from ${p}: ${err.message}`);
  }
  return { port: 52443, token: '' };
}

function relayToBridge(endpoint, method, payload = null) {
  return new Promise((resolve) => {
    const creds = loadBridgeCredentials();
    const bodyStr = payload ? JSON.stringify(payload) : '';

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: creds.port,
        path: endpoint,
        method,
        headers: {
          'Host': `127.0.0.1:${creds.port}`,
          'Authorization': `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        },
        timeout: 5000
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch {
            resolve({ ok: false, error: `Invalid bridge response (HTTP ${res.statusCode})` });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Connection to MantiCollect timed out' });
    });

    req.on('error', (err) => {
      resolve({
        ok: false,
        error: `Could not reach MantiCollect (${err.code || err.message}). Please ensure MantiCollect is running.`
      });
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    sendResponse({ ok: false, error: 'Invalid message structure' });
    return;
  }

  const action = msg.action || msg.type;
  log(`Handling action: ${action}`);

  switch (action) {
    case 'ping':
      sendResponse({
        ok: true,
        type: 'pong',
        app: 'MantiCollect',
        version: '0.1.0',
        timestamp: Date.now()
      });
      break;

    case 'status': {
      const res = await relayToBridge('/api/status', 'GET');
      sendResponse(res);
      break;
    }

    case 'checkUrl': {
      const res = await relayToBridge('/api/check-url', 'POST', { url: msg.url });
      sendResponse(res);
      break;
    }

    case 'enqueue': {
      const res = await relayToBridge('/api/enqueue', 'POST', {
        url: msg.url,
        title: msg.title,
        format: msg.format,
        requestId: msg.requestId
      });
      sendResponse(res);
      break;
    }

    case 'focus': {
      const res = await relayToBridge('/api/focus', 'POST');
      sendResponse(res);
      break;
    }

    default:
      sendResponse({ ok: false, error: `Unknown action: ${action}` });
      break;
  }
}

// Set up stdin reader with 32-bit length-prefix decoder
let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (len > MAX_MESSAGE_SIZE) {
      log(`Error: Received frame with size ${len} > limit 1MB`);
      buffer = Buffer.alloc(0);
      sendResponse({ ok: false, error: 'Oversized message' });
      return;
    }

    if (buffer.length < 4 + len) {
      // Need more data
      break;
    }

    const payload = buffer.subarray(4, 4 + len);
    buffer = buffer.subarray(4 + len);

    try {
      const parsed = JSON.parse(payload.toString('utf8'));
      handleMessage(parsed);
    } catch (err) {
      log(`Error parsing message JSON: ${err.message}`);
      sendResponse({ ok: false, error: 'Malformed JSON payload' });
    }
  }
});

process.stdin.on('end', () => {
  log('stdin closed by browser; terminating native host process.');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  log(`Uncaught Exception: ${err.stack || err}`);
});

log('MantiCollect native host process initialized');
