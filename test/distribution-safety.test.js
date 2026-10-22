import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { migrateUserDataIfNeeded } from '../electron/migration.js';

test('1. Fresh installation: returns no_legacy_data when no legacy directory exists', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'manticollect-dist-test-'));
  try {
    const targetDir = path.join(tmpRoot, 'MantiCollect');
    const legacyDir = path.join(tmpRoot, 'NonExistentLegacy');

    const res = migrateUserDataIfNeeded({
      targetDir,
      legacyDirs: [legacyDir]
    });

    assert.equal(res.migrated, false);
    assert.equal(res.reason, 'no_legacy_data');
    assert.ok(fs.existsSync(targetDir), 'targetDir should be created');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('2. Complete legacy migration: preserves database, WAL, SHM, settings, and credentials', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'manticollect-dist-test-'));
  try {
    const legacyDir = path.join(tmpRoot, 'MediaVault');
    const targetDir = path.join(tmpRoot, 'MantiCollect');
    fs.mkdirSync(legacyDir, { recursive: true });

    // Seed dummy database with SQLite WAL files
    fs.writeFileSync(path.join(legacyDir, 'mediavault.db'), 'SQLite format 3\0PRIMARY_DATABASE');
    fs.writeFileSync(path.join(legacyDir, 'mediavault.db-wal'), 'WAL_JOURNAL_CONTENT_BYTES');
    fs.writeFileSync(path.join(legacyDir, 'mediavault.db-shm'), 'SHM_INDEX_BYTES');
    fs.writeFileSync(path.join(legacyDir, 'settings.json'), JSON.stringify({ concurrency: 4 }));
    fs.writeFileSync(path.join(legacyDir, 'credentials.enc'), 'ENCRYPTED_VAULT_PAYLOAD');

    const res = migrateUserDataIfNeeded({
      targetDir,
      legacyDirs: [legacyDir]
    });

    assert.equal(res.migrated, true);
    assert.equal(res.copiedCount, 5);
    assert.deepEqual(res.migratedFiles.sort(), [
      'credentials.enc',
      'mediavault.db',
      'mediavault.db-shm',
      'mediavault.db-wal',
      'settings.json'
    ].sort());

    // Check target integrity
    assert.equal(fs.readFileSync(path.join(targetDir, 'mediavault.db'), 'utf8'), 'SQLite format 3\0PRIMARY_DATABASE');
    assert.equal(fs.readFileSync(path.join(targetDir, 'mediavault.db-wal'), 'utf8'), 'WAL_JOURNAL_CONTENT_BYTES');
    assert.equal(fs.readFileSync(path.join(targetDir, 'mediavault.db-shm'), 'utf8'), 'SHM_INDEX_BYTES');
    assert.equal(fs.readFileSync(path.join(targetDir, 'credentials.enc'), 'utf8'), 'ENCRYPTED_VAULT_PAYLOAD');

    // Check legacy immutability: original files must remain 100% intact
    assert.ok(fs.existsSync(path.join(legacyDir, 'mediavault.db')));
    assert.ok(fs.existsSync(path.join(legacyDir, 'mediavault.db-wal')));
    assert.ok(fs.existsSync(path.join(legacyDir, 'settings.json')));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('3. Partially populated target: migrates missing database and credentials even if settings.json already exists', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'manticollect-dist-test-'));
  try {
    const legacyDir = path.join(tmpRoot, 'MediaVault');
    const targetDir = path.join(tmpRoot, 'MantiCollect');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });

    // Pre-existing settings in MantiCollect (e.g. generated on early boot)
    fs.writeFileSync(path.join(targetDir, 'settings.json'), JSON.stringify({ concurrency: 8, custom: true }));

    // Legacy data has database and credentials
    fs.writeFileSync(path.join(legacyDir, 'mediavault.db'), 'LEGACY_DATABASE_CONTENT');
    fs.writeFileSync(path.join(legacyDir, 'settings.json'), JSON.stringify({ concurrency: 2, legacy: true }));
    fs.writeFileSync(path.join(legacyDir, 'credentials.enc'), 'LEGACY_CREDENTIALS');

    const res = migrateUserDataIfNeeded({
      targetDir,
      legacyDirs: [legacyDir]
    });

    assert.equal(res.migrated, true);
    assert.equal(res.copiedCount, 2);
    assert.deepEqual(res.migratedFiles.sort(), ['credentials.enc', 'mediavault.db'].sort());

    // CRITICAL: Pre-existing settings.json in target MUST NOT be overwritten
    const currentSettings = JSON.parse(fs.readFileSync(path.join(targetDir, 'settings.json'), 'utf8'));
    assert.equal(currentSettings.concurrency, 8);
    assert.equal(currentSettings.custom, true);
    assert.equal(currentSettings.legacy, undefined);

    // Missing database and credentials MUST have been migrated
    assert.equal(fs.readFileSync(path.join(targetDir, 'mediavault.db'), 'utf8'), 'LEGACY_DATABASE_CONTENT');
    assert.equal(fs.readFileSync(path.join(targetDir, 'credentials.enc'), 'utf8'), 'LEGACY_CREDENTIALS');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('4. Existing MantiCollect user data is NEVER overwritten by legacy data', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'manticollect-dist-test-'));
  try {
    const legacyDir = path.join(tmpRoot, 'MediaVault');
    const targetDir = path.join(tmpRoot, 'MantiCollect');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });

    // Target already fully populated with modern MantiCollect data
    fs.writeFileSync(path.join(targetDir, 'mediavault.db'), 'MODERN_MANTICOLLECT_DB');
    fs.writeFileSync(path.join(targetDir, 'settings.json'), JSON.stringify({ version: 'manticollect' }));
    fs.writeFileSync(path.join(targetDir, 'credentials.enc'), 'MODERN_SECRETS');

    // Legacy directory also has older data
    fs.writeFileSync(path.join(legacyDir, 'mediavault.db'), 'OLD_MEDIAVAULT_DB');
    fs.writeFileSync(path.join(legacyDir, 'settings.json'), JSON.stringify({ version: 'mediavault' }));
    fs.writeFileSync(path.join(legacyDir, 'credentials.enc'), 'OLD_SECRETS');

    const res = migrateUserDataIfNeeded({
      targetDir,
      legacyDirs: [legacyDir]
    });

    assert.equal(res.migrated, false);
    assert.equal(res.reason, 'target_already_populated');

    // Verify existing modern data remains completely untouched
    assert.equal(fs.readFileSync(path.join(targetDir, 'mediavault.db'), 'utf8'), 'MODERN_MANTICOLLECT_DB');
    assert.equal(fs.readFileSync(path.join(targetDir, 'credentials.enc'), 'utf8'), 'MODERN_SECRETS');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('5. Idempotent: repeated calls do not recopy files or create duplicates', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'manticollect-dist-test-'));
  try {
    const legacyDir = path.join(tmpRoot, 'MediaVault');
    const targetDir = path.join(tmpRoot, 'MantiCollect');
    fs.mkdirSync(legacyDir, { recursive: true });

    fs.writeFileSync(path.join(legacyDir, 'mediavault.db'), 'IDEMPOTENCY_TEST_DB');

    // First call: migrates
    const res1 = migrateUserDataIfNeeded({ targetDir, legacyDirs: [legacyDir] });
    assert.equal(res1.migrated, true);

    // Second call: skips
    const res2 = migrateUserDataIfNeeded({ targetDir, legacyDirs: [legacyDir] });
    assert.equal(res2.migrated, false);
    assert.equal(res2.reason, 'target_already_populated');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
