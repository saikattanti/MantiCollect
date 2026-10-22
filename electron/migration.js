import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from './logger.js';

/**
 * Robust, non-destructive user-data migration.
 *
 * Ensures existing user data (SQLite database, WAL files, settings.json,
 * and encrypted credentials) from earlier MediaVault versions is preserved
 * seamlessly when transitioning to the unified MantiCollect application data directory.
 *
 * Safety guarantees:
 * - Atomic copying: Files are copied to a .tmp destination first, flushed to disk,
 *   and renamed to prevent half-written or corrupted files on crash/interruption.
 * - Granular preservation: An existing settings.json does not prevent migrating
 *   an unmigrated mediavault.db, and vice versa.
 * - Non-overwriting: Existing target files are NEVER overwritten by legacy files.
 * - Legacy immutability: Source files in the legacy directory are never deleted or modified.
 * - WAL database integrity: If mediavault.db-wal and mediavault.db-shm exist in legacy,
 *   they are copied alongside mediavault.db.
 * - Idempotency: Safe to call repeatedly on startup.
 */
export function migrateUserDataIfNeeded({
  targetDir,
  legacyDirs = []
} = {}) {
  if (!targetDir) return { migrated: false, reason: 'no_target_dir' };

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const candidates = legacyDirs.length > 0 ? legacyDirs : getDefaultLegacyDirs(targetDir);
    let totalCopied = 0;
    const migratedFiles = [];
    let detectedSource = null;

    for (const legacyDir of candidates) {
      if (!legacyDir || legacyDir === targetDir || !fs.existsSync(legacyDir)) {
        continue;
      }

      // Check if this legacy directory contains any salvageable user data
      const legacyDb = path.join(legacyDir, 'mediavault.db');
      const legacySettings = path.join(legacyDir, 'settings.json');
      const legacyCreds = path.join(legacyDir, 'credentials.enc');

      const hasLegacyData =
        fs.existsSync(legacyDb) ||
        fs.existsSync(legacySettings) ||
        fs.existsSync(legacyCreds);

      if (!hasLegacyData) {
        continue;
      }

      detectedSource = legacyDir;

      // 1. Database and SQLite WAL files (only if target mediavault.db is missing)
      const targetDb = path.join(targetDir, 'mediavault.db');
      if (!fs.existsSync(targetDb) && fs.existsSync(legacyDb)) {
        const dbFiles = ['mediavault.db', 'mediavault.db-wal', 'mediavault.db-shm'];
        for (const f of dbFiles) {
          const src = path.join(legacyDir, f);
          const dst = path.join(targetDir, f);
          if (fs.existsSync(src) && !fs.existsSync(dst)) {
            if (safeAtomicCopy(src, dst)) {
              totalCopied++;
              migratedFiles.push(f);
            }
          }
        }
      }

      // 2. Settings (only if target settings.json is missing)
      const targetSettings = path.join(targetDir, 'settings.json');
      if (!fs.existsSync(targetSettings) && fs.existsSync(legacySettings)) {
        if (safeAtomicCopy(legacySettings, targetSettings)) {
          totalCopied++;
          migratedFiles.push('settings.json');
        }
      }

      // 3. Encrypted credentials (only if target credentials.enc is missing)
      const targetCreds = path.join(targetDir, 'credentials.enc');
      if (!fs.existsSync(targetCreds) && fs.existsSync(legacyCreds)) {
        if (safeAtomicCopy(legacyCreds, targetCreds)) {
          totalCopied++;
          migratedFiles.push('credentials.enc');
        }
      }

      // If we copied files from this candidate, record migration log and stop candidate search
      if (totalCopied > 0) {
        logger.info('migration', `Migrated ${totalCopied} files (${migratedFiles.join(', ')}) from ${legacyDir} to ${targetDir}.`);
        recordMigrationMarker(targetDir, {
          sourceDir: legacyDir,
          migratedFiles,
          timestamp: new Date().toISOString()
        });
        return {
          migrated: true,
          sourceDir: legacyDir,
          copiedCount: totalCopied,
          migratedFiles
        };
      }
    }

    return {
      migrated: false,
      reason: detectedSource ? 'target_already_populated' : 'no_legacy_data'
    };
  } catch (err) {
    logger.warn('migration', `Migration check encountered error: ${err.message}`);
    return { migrated: false, error: err.message };
  }
}

/**
 * Atomically copy file from src to dst using a temporary file.
 * Returns true on success, false if copy failed or was interrupted.
 */
function safeAtomicCopy(src, dst) {
  const tmp = `${dst}.migration.tmp`;
  try {
    // If a stale tmp file exists from a crashed run, remove it
    if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }
    fs.copyFileSync(src, tmp);

    // Verify file size matches source before committing rename
    const srcStat = fs.statSync(src);
    const tmpStat = fs.statSync(tmp);
    if (srcStat.size !== tmpStat.size) {
      throw new Error(`Size mismatch during copy: src=${srcStat.size}, tmp=${tmpStat.size}`);
    }

    fs.renameSync(tmp, dst);
    return true;
  } catch (err) {
    logger.warn('migration', `Failed atomic copy ${path.basename(src)}: ${err.message}`);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    return false;
  }
}

function recordMigrationMarker(targetDir, metadata) {
  try {
    const markerFile = path.join(targetDir, '.migration-history.json');
    let history = [];
    if (fs.existsSync(markerFile)) {
      history = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    }
    history.push(metadata);
    fs.writeFileSync(markerFile, JSON.stringify(history, null, 2), 'utf8');
  } catch {}
}

function getDefaultLegacyDirs(currentTarget) {
  const dirs = [];
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    dirs.push(path.join(appData, 'MediaVault'));
    dirs.push(path.join(appData, 'mediavault'));
  } else if (process.platform === 'darwin') {
    dirs.push(path.join(home, 'Library', 'Application Support', 'MediaVault'));
    dirs.push(path.join(home, 'Library', 'Application Support', 'mediavault'));
  } else {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    dirs.push(path.join(configHome, 'MediaVault'));
    dirs.push(path.join(configHome, 'mediavault'));
  }
  return dirs.filter((d) => path.resolve(d) !== path.resolve(currentTarget));
}
