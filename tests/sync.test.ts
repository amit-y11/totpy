import { clearSharedSync, createDevice, use } from './helpers/chrome.ts';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { type Backup, maybeBackup, restoreBackup } from '../src/lib/backups.ts';
import chromeSync from '../src/lib/providers/chrome-sync.ts';
import {
  changePassword,
  createVault,
  getEnvelope,
  getSession,
  lock,
  readVault,
  recoverVault,
  regenerateRecoveryCode,
  unlock,
  updateSettings,
  updateVault,
} from '../src/lib/store.ts';
import { type SyncResult, restoreFromProvider, syncNow, unlockRemote } from '../src/lib/sync.ts';
import type { Envelope, ProviderStatus } from '../src/lib/types.ts';
import { createEntry, deleteEntry, upsertEntry } from '../src/lib/vault.ts';

function defined<T>(value: T | null | undefined, what = 'value'): T {
  assert.ok(value != null, `expected ${what}`);
  return value;
}

function chromeSyncStatus(result: SyncResult): ProviderStatus {
  assert.ok('status' in result, 'sync was skipped');
  return defined(result.status['chrome-sync'], 'chrome-sync status');
}

const account = (issuer: string) =>
  createEntry({
    issuer,
    account: `me@${issuer.toLowerCase()}`,
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
const add = (issuer: string) => updateVault((data) => upsertEntry(data, account(issuer)));
const issuers = async () => (await readVault()).data.entries.map((e) => e.issuer).sort();
const envelope = async (): Promise<Envelope> => defined(await getEnvelope(), 'local vault');

async function deleteIssuer(issuer: string): Promise<void> {
  const entry = defined((await readVault()).data.entries.find((e) => e.issuer === issuer));
  await updateVault((data) => deleteEntry(data, entry.id));
}

async function newDevice({ password = 'password-a', sync = true } = {}) {
  const device = createDevice();
  use(device);
  const recoveryCode = await createVault(password);
  await updateSettings({ providers: { 'chrome-sync': sync } });
  return { device, recoveryCode };
}

beforeEach(clearSharedSync);

test('a second device restores, and edits flow both ways', async () => {
  const a = await newDevice();
  await add('GitHub');
  await syncNow();

  use(createDevice());
  await restoreFromProvider('chrome-sync', 'password-a');
  assert.deepEqual(await issuers(), ['GitHub']);

  await add('Google');
  await deleteIssuer('GitHub');
  await syncNow();

  use(a.device);
  assert.equal(chromeSyncStatus(await syncNow()).state, 'ok');
  assert.deepEqual(await issuers(), ['Google']);
});

test('a password change reaches other devices without a prompt', async () => {
  const a = await newDevice();
  await syncNow();
  use(createDevice());
  await restoreFromProvider('chrome-sync', 'password-a');

  await changePassword('password-a', 'password-b');
  await syncNow();

  use(a.device);
  assert.equal(chromeSyncStatus(await syncNow()).state, 'ok');
  // Still unlocked, and the next unlock needs the new password.
  assert.ok(await getSession());
  await lock();
  await assert.rejects(unlock('password-a'));
  await unlock('password-b');
});

test('joining a separately created vault merges both', async () => {
  await newDevice({ password: 'password-a' });
  await add('GitHub');
  await syncNow();

  const c = await newDevice({ password: 'password-c' });
  await add('Stripe');
  assert.equal(chromeSyncStatus(await syncNow()).state, 'needs-password');

  const adopt = await unlockRemote('chrome-sync', 'password-a');
  await syncNow({ adopt });
  assert.deepEqual(await issuers(), ['GitHub', 'Stripe']);
  assert.equal((await envelope()).keyId, adopt.keyId);

  use(c.device);
  await lock();
  await unlock('password-a');
});

test('the recovery code resets the password', async () => {
  const { recoveryCode } = await newDevice({ sync: false });
  await add('GitHub');
  await lock();
  await recoverVault(await getEnvelope(), recoveryCode, 'brand-new-password');
  assert.deepEqual(await issuers(), ['GitHub']);
  await lock();
  await assert.rejects(unlock('password-a'));
  await unlock('brand-new-password');
});

test('a new recovery code replaces the old one', async () => {
  const { recoveryCode } = await newDevice({ sync: false });
  const fresh = await regenerateRecoveryCode();
  await assert.rejects(recoverVault(await getEnvelope(), recoveryCode, 'x-password'));
  await recoverVault(await getEnvelope(), fresh, 'x-password');
});

test('a tampered synced copy is rejected and leaves the local vault alone', async () => {
  const victim = await newDevice();
  await add('GitHub');
  await syncNow();
  const before = await envelope();

  // Someone with access to the sync storage swaps in their own password wrap
  // and marks it as newer, hoping devices adopt it and lock the user out.
  const remote = defined(await chromeSync.read(), 'synced copy');
  use(createDevice());
  await createVault('attacker-password');
  const forged = (await envelope()).keys.password;
  await chromeSync.write({
    ...remote,
    keys: { ...remote.keys, password: forged, updatedAt: Date.now() + 1000 },
  });

  use(victim.device);
  const status = chromeSyncStatus(await syncNow());
  assert.equal(status.state, 'error');
  assert.match(status.error ?? '', /tampered/);
  assert.deepEqual((await envelope()).keys, before.keys);
  await lock();
  await unlock('password-a');

  // A fresh device cannot be set up from it with either password.
  use(createDevice());
  await assert.rejects(restoreFromProvider('chrome-sync', 'attacker-password'));
  await assert.rejects(restoreFromProvider('chrome-sync', 'password-a'));
});

test('automatic copies bring back deleted accounts', async () => {
  await newDevice({ sync: false });
  await add('GitHub');
  await add('Google');
  await maybeBackup();
  await deleteIssuer('GitHub');
  assert.deepEqual(await issuers(), ['Google']);

  const { autoBackups } = await chrome.storage.local.get('autoBackups');
  const [latest] = autoBackups as Backup[];
  assert.equal(await restoreBackup(defined(latest).at), 1);
  assert.deepEqual(await issuers(), ['GitHub', 'Google']);
  // A copy is taken at most once a day.
  assert.equal(await maybeBackup(), false);
});
