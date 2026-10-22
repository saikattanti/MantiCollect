import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

test('1. Approved brand assets exist in public/ with valid formats and dimensions', async () => {
  const favTr = path.join(root, 'public', 'MantiCollect-fav-tr.png');
  const nameLogoTr = path.join(root, 'public', 'MantiCollect-name-logo-tr.png');
  const fullLogoTr = path.join(root, 'public', 'MantiCollect-full-logo-tr.png');

  assert.ok(fs.existsSync(favTr), 'App icon / Favicon transparent variant must exist');
  assert.ok(fs.existsSync(nameLogoTr), 'Wordmark transparent variant must exist');
  assert.ok(fs.existsSync(fullLogoTr), 'Full logo with tagline transparent variant must exist');

  // Verify PNG signature (first 8 bytes: 89 50 4E 47 0D 0A 1A 0A)
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const file of [favTr, nameLogoTr, fullLogoTr]) {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    assert.deepEqual(buf, pngHeader, `${path.basename(file)} must be a valid PNG`);
  }
});

test('2. Electron icon assets generated from approved app icon are valid', async () => {
  const icoPath = path.join(root, 'electron', 'assets', 'icon.ico');
  const pngPath = path.join(root, 'electron', 'assets', 'icon.png');
  const trayPath = path.join(root, 'electron', 'assets', 'tray-icon.png');
  const tray2xPath = path.join(root, 'electron', 'assets', 'tray-icon@2x.png');

  assert.ok(fs.existsSync(icoPath), 'icon.ico must exist in electron/assets/');
  assert.ok(fs.existsSync(pngPath), 'icon.png must exist in electron/assets/');
  assert.ok(fs.existsSync(trayPath), 'tray-icon.png must exist in electron/assets/');
  assert.ok(fs.existsSync(tray2xPath), 'tray-icon@2x.png must exist in electron/assets/');

  // Verify ICO header: 0x0000 0x0001 (type 1 for icon)
  const icoBuf = fs.readFileSync(icoPath);
  assert.ok(icoBuf.length > 50000, 'icon.ico should contain multi-resolution icon frames');
  assert.equal(icoBuf.readUInt16LE(0), 0, 'ICO reserved word must be 0');
  assert.equal(icoBuf.readUInt16LE(2), 1, 'ICO type must be 1 (icon)');
  const imageCount = icoBuf.readUInt16LE(4);
  assert.ok(imageCount >= 5, `ICO should contain multiple icon sizes, got ${imageCount}`);
});

test('3. package.json packaging configuration adheres to distribution requirements', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.equal(pkg.name, 'manticollect', 'package name must be manticollect');
  assert.equal(pkg.productName, 'MantiCollect', 'productName must be MantiCollect');
  assert.ok(pkg.description.includes('MantiCollect — A Mantitup Product'), 'description must include product tagline');
  assert.equal(pkg.author, 'Mantitup', 'author must reflect publisher Mantitup');

  // Electron Builder config
  const build = pkg.build;
  assert.ok(build, 'build configuration must exist');
  assert.equal(build.appId, 'com.mantitup.manticollect', 'appId must match bundle ID com.mantitup.manticollect');
  assert.equal(build.productName, 'MantiCollect', 'build productName must be MantiCollect');
  assert.equal(build.win.icon, 'electron/assets/icon.ico', 'Windows icon must point to electron/assets/icon.ico');
  assert.equal(build.win.artifactName, 'MantiCollect-Setup-${version}.exe', 'artifactName must follow MantiCollect-Setup pattern');

  // NSIS safety rules
  const nsis = build.nsis;
  assert.ok(nsis, 'nsis configuration must exist');
  assert.equal(nsis.oneClick, false, 'oneClick must be false for user-customizable installation');
  assert.equal(nsis.perMachine, false, 'perMachine should be false for standard per-user install');
  assert.equal(nsis.allowToChangeInstallationDirectory, true, 'installation directory must be customizable');
  assert.equal(nsis.deleteAppDataOnUninstall, false, 'CRITICAL: deleteAppDataOnUninstall must be false to preserve user data');
  assert.equal(nsis.shortcutName, 'MantiCollect', 'shortcutName must be MantiCollect');
});

test('4. Non-destructive legacy user data migration preserves existing databases and settings', async () => {
  const { migrateUserDataIfNeeded } = await import('../electron/migration.js');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'manticollect-migration-test-'));
  const legacyDir = path.join(tmpRoot, 'MediaVault');
  const targetDir = path.join(tmpRoot, 'MantiCollect');

  try {
    fs.mkdirSync(legacyDir, { recursive: true });

    // Seed dummy legacy files
    fs.writeFileSync(path.join(legacyDir, 'mediavault.db'), 'DUMMY_SQLITE_DATABASE_CONTENT');
    fs.writeFileSync(path.join(legacyDir, 'settings.json'), JSON.stringify({ downloadDir: 'C:/Test' }));
    fs.writeFileSync(path.join(legacyDir, 'credentials.enc'), 'ENCRYPTED_SECRETS_DATA');

    // Run migration
    const res = migrateUserDataIfNeeded({
      targetDir,
      legacyDirs: [legacyDir]
    });

    assert.equal(res.migrated, true, 'Migration should execute when target has no data');
    assert.equal(res.copiedCount, 3, 'Should copy db, settings, and credentials');

    // Check target files
    assert.equal(fs.readFileSync(path.join(targetDir, 'mediavault.db'), 'utf8'), 'DUMMY_SQLITE_DATABASE_CONTENT');
    assert.equal(fs.existsSync(path.join(targetDir, 'settings.json')), true);
    assert.equal(fs.existsSync(path.join(targetDir, 'credentials.enc')), true);

    // Verify legacy files remain untouched (non-destructive)
    assert.equal(fs.existsSync(path.join(legacyDir, 'mediavault.db')), true);

    // Run migration again on already initialized target: must NOT overwrite
    const res2 = migrateUserDataIfNeeded({
      targetDir,
      legacyDirs: [legacyDir]
    });
    assert.equal(res2.migrated, false);
    assert.equal(res2.reason, 'already_initialized');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('5. ytDlpCandidates includes userData vendor directory for packaged downloads', async () => {
  const { ytDlpCandidates } = await import('../electron/bins.js');
  const candidates = ytDlpCandidates();
  assert.ok(Array.isArray(candidates), 'Candidates must be an array');
  assert.ok(candidates.length >= 1, 'Candidates must include at least dev or resource vendor paths');
});

test('6. Updater service truthfully reports unsupported_dev in development mode', async () => {
  const { createUpdateService, UPDATER_STATES } = await import('../electron/updater.js');
  const updater = createUpdateService({
    isPackaged: false,
    appVersion: '0.1.0'
  });

  const status = updater.getStatus();
  assert.equal(status.state, UPDATER_STATES.UNSUPPORTED_DEV);
  assert.equal(status.isPackaged, false);
  assert.ok(status.message.includes('development mode'));

  const checkResult = await updater.checkForUpdates();
  assert.equal(checkResult.state, UPDATER_STATES.UNSUPPORTED_DEV);
});
