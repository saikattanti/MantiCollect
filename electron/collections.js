import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { logger } from './logger.js';

/**
 * Collections Management Service.
 *
 * Implements many-to-many relationship between collections and library items
 * using pure database transactions. Deleting a collection NEVER deletes underlying
 * files unless explicitly requested.
 */
export function createCollectionsManager({ getDbInstance = getDb } = {}) {
  const db = () => getDbInstance();

  function listCollections() {
    const rows = db()
      .prepare(
        `SELECT c.id, c.name, c.description, c.color, c.created_at, c.updated_at,
                COUNT(ci.item_path) AS item_count
         FROM collections c
         LEFT JOIN collection_items ci ON c.id = ci.collection_id
         GROUP BY c.id
         ORDER BY c.name ASC`
      )
      .all();
    return rows;
  }

  function getCollection(id) {
    if (!id || typeof id !== 'string') return null;
    const row = db()
      .prepare(
        `SELECT c.id, c.name, c.description, c.color, c.created_at, c.updated_at,
                COUNT(ci.item_path) AS item_count
         FROM collections c
         LEFT JOIN collection_items ci ON c.id = ci.collection_id
         WHERE c.id = ?
         GROUP BY c.id`
      )
      .get(id);
    return row || null;
  }

  function createCollection({ name, description = '', color = '#3b82f6' }) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Collection name is required');
    }
    const cleanName = name.trim().slice(0, 100);
    const cleanDesc = typeof description === 'string' ? description.trim().slice(0, 500) : '';
    const cleanColor = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#3b82f6';

    const existing = db().prepare('SELECT id FROM collections WHERE LOWER(name) = LOWER(?)').get(cleanName);
    if (existing) {
      throw new Error(`A collection named "${cleanName}" already exists`);
    }

    const id = randomUUID();
    const now = Date.now();

    db()
      .prepare(
        `INSERT INTO collections (id, name, description, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, cleanName, cleanDesc, cleanColor, now, now);

    logger.info('collections', `Created collection "${cleanName}" (${id})`);
    return {
      id,
      name: cleanName,
      description: cleanDesc,
      color: cleanColor,
      created_at: now,
      updated_at: now,
      item_count: 0
    };
  }

  function renameCollection({ id, name, description, color }) {
    if (!id || typeof id !== 'string') throw new Error('Collection ID is required');
    const existing = getCollection(id);
    if (!existing) throw new Error('Collection not found');

    const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : existing.name;
    const cleanDesc = description !== undefined ? String(description).trim().slice(0, 500) : existing.description;
    const cleanColor =
      typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : existing.color;

    // Check name collision with another collection
    const duplicate = db()
      .prepare('SELECT id FROM collections WHERE LOWER(name) = LOWER(?) AND id != ?')
      .get(cleanName, id);
    if (duplicate) {
      throw new Error(`Another collection is already named "${cleanName}"`);
    }

    const now = Date.now();
    db()
      .prepare(
        `UPDATE collections
         SET name = ?, description = ?, color = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(cleanName, cleanDesc, cleanColor, now, id);

    logger.info('collections', `Renamed collection ${id} to "${cleanName}"`);
    return getCollection(id);
  }

  function deleteCollection(idOrOpts) {
    const id = typeof idOrOpts === 'object' && idOrOpts !== null ? idOrOpts.id : idOrOpts;
    if (!id || typeof id !== 'string') throw new Error('Collection ID is required');
    const existing = getCollection(id);
    if (!existing) return { deleted: false };

    // Transaction ensures item relations and collection record are purged atomically
    const deleteTx = db().transaction(() => {
      db().prepare('DELETE FROM collection_items WHERE collection_id = ?').run(id);
      db().prepare('DELETE FROM collections WHERE id = ?').run(id);
    });

    deleteTx();
    logger.info('collections', `Deleted collection "${existing.name}" (${id})`);
    return { deleted: true, id };
  }

  function addItemsToCollection({ collectionId, itemPaths }) {
    if (!collectionId || typeof collectionId !== 'string') throw new Error('Collection ID is required');
    if (!Array.isArray(itemPaths)) throw new Error('Item paths must be an array');
    if (!itemPaths.length) return { added: 0, addedCount: 0, collectionId };

    const col = getCollection(collectionId);
    if (!col) throw new Error('Collection does not exist');

    const now = Date.now();
    let added = 0;

    const addTx = db().transaction(() => {
      const stmt = db().prepare(
        `INSERT OR IGNORE INTO collection_items (collection_id, item_path, added_at)
         VALUES (?, ?, ?)`
      );
      for (const p of itemPaths) {
        if (typeof p === 'string' && p.trim()) {
          const res = stmt.run(collectionId, path.resolve(p.trim()), now);
          if (res.changes > 0) added++;
        }
      }
      db().prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(now, collectionId);
    });

    addTx();
    logger.info('collections', `Added ${added} items to collection "${col.name}" (${collectionId})`);
    return { added: added, addedCount: added, collectionId };
  }

  function removeItemsFromCollection({ collectionId, itemPaths }) {
    if (!collectionId || typeof collectionId !== 'string') throw new Error('Collection ID is required');
    if (!Array.isArray(itemPaths)) throw new Error('Item paths must be an array');
    if (!itemPaths.length) return { removed: 0, removedCount: 0, collectionId };

    let removed = 0;
    const removeTx = db().transaction(() => {
      const stmt = db().prepare('DELETE FROM collection_items WHERE collection_id = ? AND item_path = ?');
      for (const p of itemPaths) {
        if (typeof p === 'string' && p.trim()) {
          const res = stmt.run(collectionId, path.resolve(p.trim()));
          removed += res.changes;
        }
      }
      db().prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(Date.now(), collectionId);
    });

    removeTx();
    logger.info('collections', `Removed ${removed} items from collection ${collectionId}`);
    return { removed: removed, removedCount: removed, collectionId };
  }

  function getCollectionItemPaths(collectionId) {
    if (!collectionId || typeof collectionId !== 'string') return [];
    const rows = db()
      .prepare('SELECT item_path, added_at FROM collection_items WHERE collection_id = ? ORDER BY added_at DESC')
      .all(collectionId);
    return rows.map((r) => r.item_path);
  }

  function getCollectionsForItem(itemPath) {
    if (!itemPath || typeof itemPath !== 'string') return [];
    const rows = db()
      .prepare(
        `SELECT c.id, c.name, c.color
         FROM collections c
         JOIN collection_items ci ON c.id = ci.collection_id
         WHERE ci.item_path = ?
         ORDER BY c.name ASC`
      )
      .all(itemPath);
    return rows;
  }

  return {
    listCollections,
    getCollection,
    createCollection,
    renameCollection,
    deleteCollection,
    addItemsToCollection,
    removeItemsFromCollection,
    getCollectionItemPaths,
    getCollectionsForItem
  };
}

let _defaultMgr = null;
function getDefaultMgr() {
  if (!_defaultMgr) _defaultMgr = createCollectionsManager();
  return _defaultMgr;
}

export function listCollections(db = null) {
  if (db) return createCollectionsManager({ getDbInstance: () => db }).listCollections();
  return getDefaultMgr().listCollections();
}

export function getCollection(id, db = null) {
  if (db) return createCollectionsManager({ getDbInstance: () => db }).getCollection(id);
  return getDefaultMgr().getCollection(id);
}

export function createCollection(nameOrOpts, description, color, db = null) {
  const opts = typeof nameOrOpts === 'object' ? nameOrOpts : { name: nameOrOpts, description, color };
  const dbInst = db || (nameOrOpts && nameOrOpts.db);
  if (dbInst) return createCollectionsManager({ getDbInstance: () => dbInst }).createCollection(opts);
  return getDefaultMgr().createCollection(opts);
}

export function renameCollection(id, name, db = null) {
  const opts = typeof id === 'object' ? id : { id, name };
  if (db) return createCollectionsManager({ getDbInstance: () => db }).renameCollection(opts);
  return getDefaultMgr().renameCollection(opts);
}

export function deleteCollection(id, db = null) {
  if (db) return createCollectionsManager({ getDbInstance: () => db }).deleteCollection(id);
  return getDefaultMgr().deleteCollection(id);
}

export function addItemsToCollection(collectionId, itemPaths, db = null) {
  const opts = typeof collectionId === 'object' ? collectionId : { collectionId, itemPaths };
  if (db) return createCollectionsManager({ getDbInstance: () => db }).addItemsToCollection(opts);
  return getDefaultMgr().addItemsToCollection(opts);
}

export function removeItemsFromCollection(collectionId, itemPaths, db = null) {
  const opts = typeof collectionId === 'object' ? collectionId : { collectionId, itemPaths };
  if (db) return createCollectionsManager({ getDbInstance: () => db }).removeItemsFromCollection(opts);
  return getDefaultMgr().removeItemsFromCollection(opts);
}

export function getCollectionItemPaths(collectionId, db = null) {
  if (db) return createCollectionsManager({ getDbInstance: () => db }).getCollectionItemPaths(collectionId);
  return getDefaultMgr().getCollectionItemPaths(collectionId);
}

export function getCollectionsForItem(itemPath, db = null) {
  if (db) return createCollectionsManager({ getDbInstance: () => db }).getCollectionsForItem(itemPath);
  return getDefaultMgr().getCollectionsForItem(itemPath);
}
