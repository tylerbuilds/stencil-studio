/** Preserve exact earlier-format browser data before a migration replaces its key. */
import { VERSION } from './model.js';
export function needsMigration(raw, kind = 'document') {
  if (typeof raw !== 'string') return false;
  let parsed; try { parsed = JSON.parse(raw); } catch { return false; }
  const earlier = document => document?.schema === 'stencil-studio' && Number.isInteger(document.version) && document.version >= 1 && document.version < VERSION;
  return kind === 'library' ? parsed?.schema === 'stencil-studio-library' && Array.isArray(parsed.designs) && parsed.designs.some(record => earlier(record?.document)) : earlier(parsed);
}
export function preserveMigrationSource(storage, key, raw) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof key !== 'string' || typeof raw !== 'string') throw new Error('Migration backup storage is unavailable.');
  let hash = 2166136261; for (let index = 0; index < raw.length; index++) hash = Math.imul(hash ^ raw.charCodeAt(index), 16777619);
  const prefix = `${key}.migration.v${VERSION}.${(hash >>> 0).toString(16)}`;
  let backupKey = prefix, suffix = 0;
  while (true) { const previous = storage.getItem(backupKey); if (previous === raw) return backupKey; if (previous === null) break; backupKey = `${prefix}.${++suffix}`; }
  storage.setItem(backupKey, raw);
  if (storage.getItem(backupKey) !== raw) throw new Error('The original migration backup could not be retained.');
  return backupKey;
}
export function writeWithMigrationBackup(storage, key, payload, kind = 'document') {
  const original = storage.getItem(key);
  if (original !== null && needsMigration(original, kind)) preserveMigrationSource(storage, key, original);
  storage.setItem(key, payload);
}
