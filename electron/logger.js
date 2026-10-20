import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const { app } = typeof electron === 'object' && electron ? electron : { app: null };

let logDir = '';
function dir() {
  if (!logDir) {
    if (!app) throw new Error('logger is only available inside the Electron runtime');
    logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function write(level, scope, message) {
  try {
    const stamp = new Date().toISOString();
    const line = `${stamp} ${level.toUpperCase()} [${scope}] ${String(message).replace(/\s+/g, ' ')}\n`;
    fs.appendFileSync(path.join(dir(), `mediavault-${stamp.slice(0, 10)}.log`), line);
  } catch {
    // Logging must never crash the application.
  }
}

export const logger = {
  info(scope, msg) {
    write('info', scope, msg);
  },
  warn(scope, msg) {
    write('warn', scope, msg);
  },
  error(scope, msg) {
    write('error', scope, msg);
  }
};
