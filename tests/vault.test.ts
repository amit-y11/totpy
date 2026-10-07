import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TOMBSTONE_TTL_MS,
  canonicalize,
  createEntry,
  deleteEntry,
  emptyData,
  importEntries,
  mergeData,
  pruneTombstones,
  upsertEntry,
} from '../src/lib/vault.ts';
import type { EntryFields } from '../src/lib/types.ts';

const fields = (name: string): EntryFields => ({
  issuer: name,
  account: `${name}@x`,
  secret: 'JBSWY3DPEHPK3PXP',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
});

test('merge unions entries added on different devices', () => {
  const a = upsertEntry(emptyData(), createEntry(fields('A'), 1), 1);
  const b = upsertEntry(emptyData(), createEntry(fields('B'), 2), 2);
  assert.equal(mergeData(a, b).entries.length, 2);
});

test('newest edit wins regardless of merge order', () => {
  const entry = createEntry(fields('A'), 1);
  const base = upsertEntry(emptyData(), entry, 1);
  const left = upsertEntry(base, { ...entry, issuer: 'Left' }, 5);
  const right = upsertEntry(base, { ...entry, issuer: 'Right' }, 9);
  assert.equal(canonicalize(mergeData(left, right)), canonicalize(mergeData(right, left)));
  assert.equal(mergeData(left, right).entries[0]?.issuer, 'Right');
});

test('deletions propagate but a later edit survives', () => {
  const entry = createEntry(fields('A'), 1);
  const base = upsertEntry(emptyData(), entry, 1);
  const deleted = deleteEntry(base, entry.id, 10);
  assert.equal(mergeData(base, deleted).entries.length, 0);

  const editedLater = upsertEntry(base, { ...entry, issuer: 'Edited' }, 20);
  assert.equal(mergeData(deleted, editedLater).entries.length, 1);
});

test('merge is idempotent', () => {
  const a = upsertEntry(emptyData(), createEntry(fields('A'), 1), 1);
  const merged = mergeData(a, a);
  assert.equal(canonicalize(merged), canonicalize(mergeData(merged, a)));
});

test('old tombstones are pruned', () => {
  const data = { ...emptyData(), tombstones: { old: 0, recent: TOMBSTONE_TTL_MS } };
  assert.deepEqual(Object.keys(pruneTombstones(data, TOMBSTONE_TTL_MS + 1).tombstones), ['recent']);
});

test('import skips duplicates', () => {
  const start = upsertEntry(emptyData(), createEntry(fields('A')));
  const { data, added } = importEntries(start, [fields('A'), fields('B'), fields('B')]);
  assert.equal(added, 1);
  assert.equal(data.entries.length, 2);
});
