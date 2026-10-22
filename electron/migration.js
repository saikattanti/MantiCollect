import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from './logger.js';

/**
 * Non-destructive first-launch user-data migration.
 *
 * Ensures existing user data (SQLite database, WAL files, settings.json,
 * and encrypted credentials) from earlier MediaVault versions is preserved
 * seamlessly when transitioning to the unified MantiCollect application data directory.
 *
 * Legacy source files are never deleted or modified.
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

    // Check if target already has database or settings
    const targetDb = path.join(targetDir, 'mediavault.db');
    const targetSettings = path.join(targetDir, 'settings.json');
    if (fs.existsSync(targetDb) || fs.existsSync(targetSettings)) {
      return { migrated: false, reason: 'already_initialized' };
    }

    // If candidate legacy dirs not provided, infer platform defaults
    const candidates = legacyDirs.length > 0 ? legacyDirs : getDefaultLegacyDirs(targetDir);

    for (const legacyDir of candidates) {
      if (!legacyDir || legacyDir === targetDir || !fs.existsSync(legacyDir)) {
        continue;
      }

      const legacyDb = path.join(legacyDir, 'mediavault.db');
      const legacySettings = path.join(legacyDir, 'settings.json');

      if (fs.existsSync(legacyDb) || fs.existsSync(legacySettings)) {
        logger.info('migration', `Discovered legacy user data in ${legacyDir}. Preserving into ${targetDir}…`);

        const filesToCopy = [
          'mediavault.db',
          'mediavault.db-wal',
          'mediavault.db-shm',
          'settings.json',
          'credentials.enc'
        ];

        let copiedCount = 0;
        for (const file of filesToCopy) {
          const src = path.join(legacyDir, file);
          const dst = path.join(targetDir, file);
          if (fs.existsSync(src) && !fs.existsSync(dst)) {
            try {
              fs.copyFileSync(src, dst);
              copiedCount++;
            } catch (err) {
              logger.warn('migration', `Failed to copy ${file}: ${err.message}`);
            }
          }
        }

        logger.info('migration', `Successfully migrated ${copiedCount} files from ${legacyDir} to ${targetDir}.`);
        return { migrated: true, sourceDir: legacyDir, copiedCount };
      }
    }

    return { migrated: false, reason: 'no_legacy_data' };
  } catch (err) {
    logger.warn('migration', `Migration check encountered error: ${err.message}`);
    return { migrated: false, error: err.message };
  }
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
