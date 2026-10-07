import { describeBackups, restoreBackup } from '../lib/backups.ts';
import { normalizeBase32 } from '../lib/base32.ts';
import { DecryptError, openVault, validateEnvelope } from '../lib/crypto.ts';
import { buildOtpauthUri, parseAccountLinks } from '../lib/otpauth.ts';
import { getProvider, providers } from '../lib/providers/index.ts';
import {
  changePassword,
  getEnvelope,
  getSession,
  getSettings,
  getSyncStatus,
  isInitialized,
  lock,
  readVault,
  regenerateRecoveryCode,
  scheduleAutoLock,
  setSyncStatus,
  unlock,
  updateSettings,
  updateVault,
} from '../lib/store.ts';
import {
  type SyncOptions,
  recoverFromProvider,
  restoreFromProvider,
  syncNow,
  unlockRemote,
} from '../lib/sync.ts';
import type {
  EntryFields,
  ProviderId,
  ProviderStatus,
  SyncProvider,
  VaultData,
} from '../lib/types.ts';
import { importEntries } from '../lib/vault.ts';
import {
  $,
  download,
  errorMessage,
  field,
  fieldValue,
  h,
  onSubmit,
  recoveryCodeFile,
  setError,
  timeAgo,
  toast,
} from '../ui/dom.ts';

const VIEWS = ['loading', 'empty', 'unlock', 'main'] as const;
type View = (typeof VIEWS)[number];
const syncing = new Set<ProviderId>();

const isVisible = (view: View) => !$(`#view-${view}`).hidden;

function show(name: View): void {
  for (const view of VIEWS) $(`#view-${view}`).hidden = view !== name;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function init(): Promise<void> {
  $('#version').textContent = `Version ${chrome.runtime.getManifest().version}`;
  if (!(await isInitialized())) {
    const drive = getProvider('google-drive').availability();
    $('#drive-unavailable').hidden = drive.ok;
    $('#drive-unavailable').textContent = drive.reason ?? '';
    $<HTMLButtonElement>('#drive-restore-connect').disabled = !drive.ok;
    show('empty');
    return;
  }
  if (!(await getSession())) {
    show('unlock');
    return;
  }
  await renderMain();
  show('main');
}

async function renderMain(): Promise<void> {
  const settings = await getSettings();
  $<HTMLSelectElement>('#auto-lock').value = String(settings.autoLockMinutes);
  await Promise.all([renderProviders(), renderBackups()]);
}

function passwordPair(form: HTMLFormElement): string {
  const password = fieldValue(form, 'password');
  if (password.length < 8) throw new Error('Use at least 8 characters');
  if (password !== fieldValue(form, 'confirm')) throw new Error('Passwords do not match');
  return password;
}

// ---- Sync providers -------------------------------------------------------

function statusText(enabled: boolean, status: ProviderStatus | null | undefined): [string, string] {
  if (!enabled) return ['off', 'Off'];
  if (!status) return ['pending', 'Waiting for first sync'];
  if (status.state === 'ok') return ['ok', `Synced ${timeAgo(status.at)}`];
  if (status.state === 'needs-password') return ['needs-password', 'This is a different vault'];
  return ['error', status.error || 'Sync failed'];
}

async function runSync(providerId: ProviderId, options: SyncOptions = {}): Promise<void> {
  syncing.add(providerId);
  await renderProviders();
  try {
    const result = await syncNow({ only: [providerId], ...options });
    const status = 'status' in result ? result.status[providerId] : null;
    if (status?.state === 'ok') toast('Synced');
    else if (status?.state === 'error')
      toast(status.error ?? 'Sync failed', { error: true, duration: 4000 });
  } finally {
    syncing.delete(providerId);
    await renderProviders();
  }
}

function joinVaultForm(provider: SyncProvider): HTMLElement {
  const form = h(
    'form',
    { class: 'stack' },
    h('input', {
      type: 'password',
      name: 'password',
      placeholder: 'Master password of that vault',
      'aria-label': 'Master password of that vault',
      autocomplete: 'off',
      required: true,
    }),
    h('p', { class: 'error', role: 'alert' }),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'primary', type: 'submit' }, 'Merge'),
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'link danger',
          type: 'button',
          onclick: async () => {
            const ok = confirm(
              `Replace the copy in ${provider.name} with this device's vault?\n\nAccounts that exist only in that copy will be lost.`,
            );
            if (ok) await runSync(provider.id, { overwrite: provider.id });
          },
        },
        'Overwrite it instead',
      ),
    ),
  );
  onSubmit(form, async () => {
    let adopt;
    try {
      adopt = await unlockRemote(provider.id, fieldValue(form, 'password'));
    } catch {
      throw new Error('Incorrect password');
    }
    await runSync(provider.id, { adopt });
    toast('Merged. This device now uses that vault’s password and recovery code.', {
      duration: 4000,
    });
  });
  return h(
    'div',
    { class: 'callout stack' },
    h(
      'p',
      {},
      `${provider.name} holds a different vault, for example one created separately on another device. Enter its master password to merge both. Afterwards this device uses that vault’s password and recovery code.`,
    ),
    form,
  );
}

async function toggleProvider(provider: SyncProvider, enable: boolean): Promise<void> {
  try {
    if (enable) {
      await provider.connect();
      await updateSettings({ providers: { [provider.id]: true } });
      await runSync(provider.id);
      return;
    }
    const removeRemote = confirm(
      `Stop syncing with ${provider.name}.\n\nAlso delete the encrypted copy stored there? Choose Cancel to keep it.`,
    );
    if (removeRemote) await provider.remove().catch(() => {});
    await provider.disconnect();
    await updateSettings({ providers: { [provider.id]: false } });
    await setSyncStatus({ [provider.id]: null });
    await renderProviders();
  } catch (err) {
    toast(errorMessage(err), { error: true, duration: 4000 });
  }
}

async function renderProviders(): Promise<void> {
  const [settings, status] = await Promise.all([getSettings(), getSyncStatus()]);
  const cards = providers.map((provider) => {
    const available = provider.availability();
    const enabled = settings.providers[provider.id] && available.ok;
    const busy = syncing.has(provider.id);
    const [state, text] = busy ? ['pending', 'Syncing…'] : statusText(enabled, status[provider.id]);

    return h(
      'div',
      { class: 'card provider' },
      h(
        'div',
        { class: 'provider-head' },
        h('div', {}, h('h2', {}, provider.name), h('p', { class: 'muted' }, provider.description)),
        h('button', {
          class: 'switch',
          type: 'button',
          role: 'switch',
          'aria-checked': String(enabled),
          'aria-label': `Sync with ${provider.name}`,
          disabled: !available.ok || busy,
          onclick: () => void toggleProvider(provider, !enabled),
        }),
      ),
      available.ok
        ? h(
            'div',
            { class: 'row' },
            h('span', { class: 'status', 'data-state': state }, text),
            h('span', { class: 'spacer' }),
            enabled
              ? h(
                  'button',
                  { type: 'button', disabled: busy, onclick: () => void runSync(provider.id) },
                  'Sync now',
                )
              : null,
          )
        : h('p', { class: 'hint' }, available.reason ?? ''),
      enabled && status[provider.id]?.state === 'needs-password' && !busy
        ? joinVaultForm(provider)
        : null,
    );
  });
  $('#providers').replaceChildren(...cards);
}

// ---- Restore on a fresh device -------------------------------------------

$('#drive-restore-connect').addEventListener('click', async () => {
  const drive = getProvider('google-drive');
  try {
    await drive.connect();
    if (!(await drive.read())) {
      toast('No vault found in this Google account', { error: true, duration: 4000 });
      return;
    }
    $('#drive-restore-connect').hidden = true;
    const form = $<HTMLFormElement>('#drive-restore-form');
    form.hidden = false;
    field(form, 'password').focus();
  } catch (err) {
    toast(errorMessage(err), { error: true, duration: 4000 });
  }
});

onSubmit($<HTMLFormElement>('#drive-restore-form'), async (form) => {
  try {
    await restoreFromProvider('google-drive', fieldValue(form, 'password'));
  } catch (err) {
    throw err instanceof DecryptError ? new Error('Incorrect password') : err;
  }
  form.reset();
  await renderMain();
  show('main');
  toast('Vault restored');
});

$('#drive-forgot').addEventListener('click', () => {
  $('#drive-restore-form').hidden = true;
  const form = $<HTMLFormElement>('#drive-recover-form');
  form.hidden = false;
  field(form, 'code').focus();
});

onSubmit($<HTMLFormElement>('#drive-recover-form'), async (form) => {
  const password = passwordPair(form);
  await recoverFromProvider('google-drive', normalizeBase32(fieldValue(form, 'code')), password);
  form.reset();
  await renderMain();
  show('main');
  toast('Password reset and vault restored');
});

// ---- Unlock / security ----------------------------------------------------

onSubmit($<HTMLFormElement>('#unlock-form'), async (form) => {
  try {
    await unlock(fieldValue(form, 'password'));
  } catch {
    throw new Error('Incorrect password');
  }
  form.reset();
  await renderMain();
  show('main');
});

$<HTMLSelectElement>('#auto-lock').addEventListener('change', async (event) => {
  await updateSettings({ autoLockMinutes: Number((event.target as HTMLSelectElement).value) });
  await scheduleAutoLock();
  toast('Saved');
});

$('#lock-now').addEventListener('click', async () => {
  await lock();
  show('unlock');
});

onSubmit($<HTMLFormElement>('#password-form'), async (form) => {
  const next = fieldValue(form, 'next');
  if (next.length < 8) throw new Error('Use at least 8 characters');
  if (next !== fieldValue(form, 'confirm')) throw new Error('New passwords do not match');
  try {
    await changePassword(fieldValue(form, 'current'), next);
  } catch (err) {
    throw err instanceof DecryptError ? new Error('Current password is incorrect') : err;
  }
  form.reset();
  form.closest('details')?.removeAttribute('open');
  toast('Password changed');
  await syncNow();
  await renderProviders();
});

$('#new-recovery').addEventListener('click', async () => {
  const ok = confirm('Create a new recovery code? Your current recovery code will stop working.');
  if (!ok) return;
  try {
    $('#recovery-code').textContent = await regenerateRecoveryCode();
    $('#recovery-panel').hidden = false;
    void syncNow().then(renderProviders);
  } catch (err) {
    toast(errorMessage(err), { error: true, duration: 4000 });
  }
});

$('#recovery-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#recovery-code').textContent ?? '');
  toast('Recovery code copied');
});

$('#recovery-download').addEventListener('click', () => {
  download(
    'totpy-recovery-code.txt',
    recoveryCodeFile($('#recovery-code').textContent ?? ''),
    'text/plain',
  );
});

$('#recovery-hide').addEventListener('click', () => {
  $('#recovery-code').textContent = '';
  $('#recovery-panel').hidden = true;
});

// ---- Backup ---------------------------------------------------------------

async function renderBackups(): Promise<void> {
  const list = $('#backup-list');
  let copies: { at: number; count: number | null }[] = [];
  try {
    copies = await describeBackups();
  } catch {
    // Locked: nothing to show.
  }
  if (!copies.length) {
    list.replaceChildren(
      h('li', { class: 'muted' }, 'No copies yet. The first one is made today.'),
    );
    return;
  }
  list.replaceChildren(
    ...copies.map(({ at, count }) =>
      h(
        'li',
        {},
        h(
          'span',
          {},
          new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
          h(
            'span',
            { class: 'muted' },
            count == null ? ' · different vault' : ` · ${plural(count, 'account')}`,
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            disabled: count == null,
            onclick: async () => {
              try {
                const added = await restoreBackup(at);
                if (added) void syncNow().then(renderProviders);
                toast(
                  added
                    ? `Restored ${plural(added, 'account')}`
                    : 'Nothing is missing. All accounts from this copy are already here.',
                  { duration: 3000 },
                );
              } catch (err) {
                toast(errorMessage(err), { error: true, duration: 4000 });
              }
            },
          },
          'Restore',
        ),
      ),
    ),
  );
}

const today = () => new Date().toISOString().slice(0, 10);

$('#export-encrypted').addEventListener('click', async () => {
  await readVault();
  const env = await getEnvelope();
  download(`totpy-backup-${today()}.json`, JSON.stringify(env, null, 2));
});

$('#export-plain').addEventListener('click', async () => {
  const ok = confirm(
    'This file will contain your 2FA secrets in plain text. Anyone who gets it can generate your codes.\n\nExport anyway?',
  );
  if (!ok) return;
  const { data } = await readVault();
  const lines = data.entries.map(buildOtpauthUri).join('\n');
  download(`totpy-export-${today()}.txt`, `${lines}\n`, 'text/plain');
});

async function addEntries(incoming: EntryFields[]): Promise<number> {
  let added = 0;
  await updateVault((data) => {
    const result = importEntries(data, incoming);
    added = result.added;
    return added ? result.data : null;
  });
  if (added) void syncNow().then(renderProviders);
  return added;
}

onSubmit($<HTMLFormElement>('#import-encrypted-form'), async (form) => {
  const file = field(form, 'file').files?.[0];
  if (!file) throw new Error('Choose a backup file');
  let env: unknown;
  try {
    env = JSON.parse(await file.text());
    validateEnvelope(env);
  } catch (err) {
    throw err instanceof SyntaxError ? new Error('Not a valid backup file') : err;
  }
  let backup: VaultData;
  try {
    ({ data: backup } = await openVault(env, { password: fieldValue(form, 'password') }));
  } catch {
    throw new Error('Incorrect password for this backup');
  }
  const added = await addEntries(backup.entries);
  form.reset();
  toast(added ? `Imported ${plural(added, 'account')}` : 'Nothing new to import');
});

onSubmit($<HTMLFormElement>('#import-uri-form'), async (form) => {
  const { entries: parsed, skipped, errors } = parseAccountLinks(fieldValue(form, 'uris'));
  const added = parsed.length ? await addEntries(parsed) : 0;
  if (skipped) errors.push(`${skipped} unsupported account(s) skipped (only TOTP is supported)`);
  if (errors.length) setError(form, errors.join('\n'));
  else form.reset();
  toast(added ? `Imported ${plural(added, 'account')}` : 'Nothing new to import');
});

// ---- External changes -----------------------------------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.vaultKey && !changes.vaultKey.newValue) {
    if (isVisible('main')) show('unlock');
  }
  if (area !== 'local' || !isVisible('main')) return;
  if (changes.syncStatus || changes.settings) void renderProviders();
  if (changes.autoBackups) void renderBackups();
});

init().catch((err: unknown) => {
  console.error(err);
  toast(errorMessage(err), { error: true, duration: 5000 });
});
