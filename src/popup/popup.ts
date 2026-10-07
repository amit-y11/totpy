import { normalizeBase32 } from '../lib/base32.ts';
import { DRIFT_WARNING_MS, checkClock, describeOffset } from '../lib/clock.ts';
import { displayHost, matchEntries } from '../lib/match.ts';
import { parseAccountLinks, validateEntryFields } from '../lib/otpauth.ts';
import { fillCode } from '../lib/page.ts';
import chromeSync from '../lib/providers/chrome-sync.ts';
import {
  createVault,
  getEnvelope,
  getSession,
  getSettings,
  getSyncStatus,
  isInitialized,
  lock,
  readVault,
  recoverVault,
  scheduleAutoLock,
  unlock,
  updateSettings,
  updateVault,
} from '../lib/store.ts';
import { recoverFromProvider, requestBackgroundSync, restoreFromProvider } from '../lib/sync.ts';
import { isAlgorithm, secondsRemaining, timeCounter, totp } from '../lib/totp.ts';
import type { Entry, EntryFields, ProviderId } from '../lib/types.ts';
import {
  createEntry,
  deleteEntry,
  importEntries,
  isDuplicate,
  sortForDisplay,
  upsertEntry,
} from '../lib/vault.ts';
import {
  $,
  $$,
  download,
  errorMessage,
  field,
  fieldValue,
  formatCode,
  h,
  hydrateIcons,
  icon,
  onSubmit,
  recoveryCodeFile,
  setError,
  toast,
} from '../ui/dom.ts';
import { readAccountQr } from '../ui/qr.ts';

const VIEWS = [
  'loading',
  'setup',
  'recovery',
  'restore',
  'unlock',
  'recover',
  'list',
  'edit',
] as const;
type View = (typeof VIEWS)[number];
const RING = 2 * Math.PI * 7;

interface Row {
  li: HTMLLIElement;
  code: HTMLSpanElement;
  progress: SVGCircleElement;
  counter: number | null;
  value: string;
}

let entries: Entry[] = [];
let rows = new Map<string, Row>();
let ticker: ReturnType<typeof setInterval> | undefined;
let activeTab: chrome.tabs.Tab | undefined;
// Where "Forgot password?" was clicked: the local vault or a synced one.
let recoverSource: 'local' | ProviderId = 'local';

const isVisible = (view: View) => !$(`#view-${view}`).hidden;

function show(name: View): void {
  for (const view of VIEWS) $(`#view-${view}`).hidden = view !== name;
  const focusable = document.querySelector<HTMLInputElement>(
    `#view-${name} input:not([type="hidden"]):not([type="checkbox"])`,
  );
  if (focusable && name !== 'list') focusable.focus();
}

async function init(): Promise<void> {
  hydrateIcons();
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (!(await isInitialized())) {
    const synced = await chromeSync.read().catch(() => null);
    show(synced ? 'restore' : 'setup');
    return;
  }
  if (!(await getSession())) {
    show('unlock');
    return;
  }
  await openList();
  void requestBackgroundSync();
}

async function openList(): Promise<void> {
  await scheduleAutoLock();
  await loadEntries();
  await renderSyncState();
  show('list');
  $('#search').focus();
  void renderClockWarning();
}

function passwordPair(form: HTMLFormElement): string {
  const password = fieldValue(form, 'password');
  if (password.length < 8) throw new Error('Use at least 8 characters');
  if (password !== fieldValue(form, 'confirm')) throw new Error('Passwords do not match');
  return password;
}

// ---- Onboarding -----------------------------------------------------------

onSubmit($<HTMLFormElement>('#setup-form'), async (form) => {
  const password = passwordPair(form);
  const recoveryCode = await createVault(password);
  await updateSettings({ providers: { 'chrome-sync': field(form, 'chromeSync').checked } });
  form.reset();
  void requestBackgroundSync();
  $('#recovery-code').textContent = recoveryCode;
  $<HTMLInputElement>('#recovery-ack').checked = false;
  $<HTMLButtonElement>('#recovery-done').disabled = true;
  show('recovery');
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

$<HTMLInputElement>('#recovery-ack').addEventListener('change', (event) => {
  $<HTMLButtonElement>('#recovery-done').disabled = !(event.target as HTMLInputElement).checked;
});

$('#recovery-done').addEventListener('click', async () => {
  $('#recovery-code').textContent = '';
  await openList();
});

$('#setup-drive').addEventListener('click', () => chrome.runtime.openOptionsPage());

onSubmit($<HTMLFormElement>('#restore-form'), async (form) => {
  await restoreFromProvider('chrome-sync', fieldValue(form, 'password'));
  form.reset();
  await openList();
});

$('#restore-skip').addEventListener('click', () => show('setup'));

onSubmit($<HTMLFormElement>('#unlock-form'), async (form) => {
  try {
    await unlock(fieldValue(form, 'password'));
  } catch {
    throw new Error('Incorrect password. If you changed it on another device, use the new one.');
  }
  form.reset();
  await openList();
  void requestBackgroundSync();
});

function openRecover(source: typeof recoverSource): void {
  recoverSource = source;
  const form = $<HTMLFormElement>('#recover-form');
  form.reset();
  setError(form);
  show('recover');
}

$('#unlock-forgot').addEventListener('click', () => openRecover('local'));
$('#restore-forgot').addEventListener('click', () => openRecover('chrome-sync'));
$('#recover-back').addEventListener('click', () =>
  show(recoverSource === 'local' ? 'unlock' : 'restore'),
);

onSubmit($<HTMLFormElement>('#recover-form'), async (form) => {
  const password = passwordPair(form);
  const code = normalizeBase32(fieldValue(form, 'code'));
  if (recoverSource === 'local') {
    await recoverVault(await getEnvelope(), code, password);
    void requestBackgroundSync();
  } else {
    await recoverFromProvider(recoverSource, code, password);
  }
  form.reset();
  await openList();
  toast('Password reset', { duration: 2500 });
});

// ---- List -----------------------------------------------------------------

function hue(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

function timerSvg(): { svg: SVGSVGElement; progress: SVGCircleElement } {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'timer');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('aria-hidden', 'true');
  const circles = ['track', 'progress'].map((cls) => {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('class', cls);
    circle.setAttribute('cx', '9');
    circle.setAttribute('cy', '9');
    circle.setAttribute('r', '7');
    circle.setAttribute('stroke-dasharray', String(RING));
    svg.append(circle);
    return circle;
  });
  return { svg, progress: circles[1]! };
}

function renderEntry(entry: Entry, suggested: boolean): HTMLLIElement {
  const name = entry.issuer || entry.account || '?';
  const code = h('span', { class: 'code' }, '––– –––');
  const timer = timerSvg();
  const li = h(
    'li',
    {
      class: 'entry',
      tabindex: '0',
      role: 'button',
      'aria-label': `Copy code for ${name}`,
      onclick: () => void copy(entry),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void copy(entry);
        }
      },
    },
    h('span', { class: 'avatar', style: `--hue: ${hue(name)}` }, name.charAt(0).toUpperCase()),
    h(
      'div',
      { class: 'meta' },
      h('div', { class: 'issuer' }, entry.issuer || entry.account),
      entry.issuer && entry.account ? h('div', { class: 'account' }, entry.account) : null,
    ),
    h(
      'button',
      {
        class: 'icon edit',
        type: 'button',
        title: 'Edit',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          openEditor(entry);
        },
      },
      icon('edit'),
    ),
    suggested
      ? h(
          'button',
          {
            class: 'fill',
            type: 'button',
            title: 'Fill the code into the page',
            onclick: (e: MouseEvent) => {
              e.stopPropagation();
              void fill(entry);
            },
          },
          'Fill',
        )
      : null,
    h('div', { class: 'code-wrap' }, code, timer.svg),
  );
  rows.set(entry.id, { li, code, progress: timer.progress, counter: null, value: '' });
  return li;
}

async function loadEntries(): Promise<void> {
  const { data } = await readVault();
  const sorted = sortForDisplay(data.entries);
  const pageUrl = activeTab?.url ?? '';
  const suggested = /^https?:/.test(pageUrl) ? matchEntries(sorted, pageUrl) : [];
  const suggestedIds = new Set(suggested.map((e) => e.id));
  const others = sorted.filter((e) => !suggestedIds.has(e.id));
  entries = [...suggested, ...others];
  rows = new Map();

  const items: HTMLLIElement[] = [];
  if (suggested.length) {
    items.push(h('li', { class: 'section' }, `Suggested for ${displayHost(pageUrl)}`));
    items.push(...suggested.map((e) => renderEntry(e, true)));
    if (others.length) items.push(h('li', { class: 'section' }, 'All accounts'));
  }
  items.push(...others.map((e) => renderEntry(e, false)));
  $('#entries').replaceChildren(...items);
  $('#empty').hidden = entries.length > 0;
  applySearch();
  await tick();
  clearInterval(ticker);
  ticker = setInterval(tick, 250);
}

async function tick(): Promise<void> {
  const now = Date.now();
  await Promise.all(
    entries.map(async (entry) => {
      const row = rows.get(entry.id);
      if (!row) return;
      const counter = timeCounter(entry.period, now);
      if (counter !== row.counter) {
        row.counter = counter;
        try {
          row.value = await totp(entry, now);
          row.code.textContent = formatCode(row.value);
        } catch {
          row.value = '';
          row.code.textContent = 'invalid';
        }
      }
      const remaining = secondsRemaining(entry.period, now);
      row.progress.setAttribute('stroke-dashoffset', String(RING * (1 - remaining / entry.period)));
      row.li.classList.toggle('expiring', remaining <= 5);
    }),
  );
}

async function copy(entry: Entry): Promise<void> {
  const row = rows.get(entry.id);
  if (!row?.value) return;
  await navigator.clipboard.writeText(row.value);
  row.li.classList.add('copied');
  setTimeout(() => row.li.classList.remove('copied'), 900);
  toast('Copied to clipboard');
}

async function fill(entry: Entry): Promise<void> {
  const row = rows.get(entry.id);
  if (!row?.value || activeTab?.id === undefined) return;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: fillCode,
      args: [row.value],
    });
    if (result?.result) {
      window.close();
      return;
    }
  } catch {
    // Pages like chrome:// cannot be scripted; fall back to copying.
  }
  await copy(entry);
  toast('Copied. Click into the code field to fill it.', { duration: 2500 });
}

function applySearch(): void {
  const query = $<HTMLInputElement>('#search').value.trim().toLowerCase();
  let visible = 0;
  for (const entry of entries) {
    const match = !query || `${entry.issuer} ${entry.account}`.toLowerCase().includes(query);
    const row = rows.get(entry.id);
    if (row) row.li.hidden = !match;
    if (match) visible += 1;
  }
  for (const section of $$('#entries .section')) section.hidden = Boolean(query);
  $('#no-results').hidden = !(entries.length > 0 && visible === 0);
}

$('#search').addEventListener('input', applySearch);
$('#search').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const first = entries.find((e) => !rows.get(e.id)?.li.hidden);
  if (first) void copy(first);
});

async function renderClockWarning(): Promise<void> {
  const result = await checkClock();
  const banner = $('#clock-warning');
  const drifting = result !== null && Math.abs(result.offsetMs) > DRIFT_WARNING_MS;
  banner.hidden = !drifting;
  if (result && drifting) {
    banner.replaceChildren(
      h('strong', {}, `Your clock is ${describeOffset(result.offsetMs)}.`),
      ' Codes may be rejected. Turn on automatic date and time in your system settings.',
    );
  }
}

async function renderSyncState(): Promise<void> {
  const button = $('#btn-sync');
  const [settings, status] = await Promise.all([getSettings(), getSyncStatus()]);
  const enabled = (Object.keys(settings.providers) as ProviderId[]).filter(
    (id) => settings.providers[id],
  );
  const states = enabled.map((id) => status[id]?.state).filter(Boolean);
  let state = 'off';
  let title = 'Sync is off. Click to set up.';
  if (states.includes('needs-password')) {
    state = 'needs-password';
    title = 'Sync needs your attention. Click to resolve.';
  } else if (states.includes('error')) {
    state = 'error';
    title = 'Sync error. Click for details.';
  } else if (enabled.length) {
    state = 'ok';
    title = 'Synced. Click to sync now.';
  }
  button.dataset.state = state;
  button.title = title;
}

$('#btn-sync').addEventListener('click', async () => {
  const button = $('#btn-sync');
  if (button.dataset.state !== 'ok') {
    void chrome.runtime.openOptionsPage();
    return;
  }
  button.dataset.state = 'syncing';
  await requestBackgroundSync();
  await renderSyncState();
  const ok = button.dataset.state === 'ok';
  toast(ok ? 'Synced' : 'Sync failed', { error: !ok });
});

$('#btn-add').addEventListener('click', () => openEditor());
$('#empty-add').addEventListener('click', () => openEditor());
$('#btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#btn-lock').addEventListener('click', async () => {
  await lock();
  clearInterval(ticker);
  show('unlock');
});

// ---- Add / edit -----------------------------------------------------------

const editForm = $<HTMLFormElement>('#edit-form');
const editField = (name: string) => field(editForm, name);

function fillForm(fields: Partial<EntryFields>): void {
  for (const name of ['issuer', 'account', 'secret', 'algorithm'] as const) {
    const value = fields[name];
    if (value != null) editField(name).value = value;
  }
  if (fields.digits != null) editField('digits').value = String(fields.digits);
  if (fields.period != null) editField('period').value = String(fields.period);
}

function openEditor(entry: Entry | null = null): void {
  editForm.reset();
  setError(editForm);
  $<HTMLTextAreaElement>('#uri-input').value = '';
  editField('secret').type = 'password';
  editField('id').value = entry?.id ?? '';
  $('#edit-title').textContent = entry ? 'Edit account' : 'Add account';
  $('#btn-delete').hidden = !entry;
  $('#import-tools').hidden = Boolean(entry);
  if (entry) fillForm(entry);
  show('edit');
  editField('issuer').focus();
}

$('#edit-back').addEventListener('click', () => show('list'));

$('#toggle-secret').addEventListener('click', () => {
  const secret = editField('secret');
  secret.type = secret.type === 'password' ? 'text' : 'password';
});

/**
 * A single otpauth:// link fills the form for review; a Google Authenticator
 * export (many accounts) is imported straight away.
 */
async function useAccountLinks(text: string): Promise<void> {
  const { entries: found, skipped, errors } = parseAccountLinks(text);
  const [first] = found;
  if (!first) throw new Error(errors[0] ?? 'No accounts found');
  const isExport = /^otpauth-migration:/i.test(text.trim());
  if (found.length === 1 && !isExport) {
    fillForm(first);
    setError(editForm);
    toast('Details filled in. Review and save.');
    return;
  }
  let added = 0;
  await updateVault((data) => {
    const result = importEntries(data, found);
    added = result.added;
    return added ? result.data : null;
  });
  void requestBackgroundSync();
  await loadEntries();
  show('list');
  const notes = [`Imported ${added} of ${found.length} accounts`];
  if (skipped) notes.push(`${skipped} unsupported skipped`);
  toast(notes.join(' · '), { duration: 3500 });
}

async function runImport(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    setError(editForm, errorMessage(err));
  }
}

$('#uri-apply').addEventListener('click', () =>
  runImport(() => useAccountLinks($<HTMLTextAreaElement>('#uri-input').value)),
);

$('#btn-scan').addEventListener('click', () =>
  runImport(async () => {
    const dataUrl = await chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, {
      format: 'png',
    });
    await useAccountLinks(await readAccountQr(await (await fetch(dataUrl)).blob()));
  }),
);

$<HTMLInputElement>('#qr-file').addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void runImport(async () => useAccountLinks(await readAccountQr(file)));
});

onSubmit(editForm, async () => {
  const id = editField('id').value;
  const algorithm = editField('algorithm').value;
  if (!isAlgorithm(algorithm)) throw new Error(`Unsupported algorithm: ${algorithm}`);
  const fields: EntryFields = {
    issuer: editField('issuer').value.trim(),
    account: editField('account').value.trim(),
    secret: normalizeBase32(editField('secret').value),
    algorithm,
    digits: Number(editField('digits').value),
    period: Number(editField('period').value),
  };
  if (!fields.issuer && !fields.account) throw new Error('Enter an issuer or account name');
  validateEntryFields(fields);
  await updateVault((data) => {
    if (id) {
      const existing = data.entries.find((e) => e.id === id);
      if (!existing) throw new Error('This account was deleted on another device');
      return upsertEntry(data, { ...existing, ...fields });
    }
    if (isDuplicate(data, fields)) throw new Error('This account is already added');
    return upsertEntry(data, createEntry(fields));
  });
  void requestBackgroundSync();
  await loadEntries();
  show('list');
  toast(id ? 'Saved' : 'Account added');
});

$('#btn-delete').addEventListener('click', async () => {
  const id = editField('id').value;
  const entry = entries.find((e) => e.id === id);
  const name = entry?.issuer || entry?.account || 'this account';
  const ok = confirm(
    `Delete ${name}? Make sure 2FA is disabled on the site first, or you may be locked out.`,
  );
  if (!ok) return;
  await updateVault((data) => deleteEntry(data, id));
  void requestBackgroundSync();
  await loadEntries();
  show('list');
  toast('Deleted. Settings → Automatic copies can bring it back.', { duration: 3000 });
});

// ---- External changes -----------------------------------------------------

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'session' && changes.vaultKey && !changes.vaultKey.newValue) {
    clearInterval(ticker);
    if (isVisible('list') || isVisible('edit')) show('unlock');
    return;
  }
  if (area !== 'local' || !isVisible('list')) return;
  if (changes.vault) await loadEntries().catch(() => {});
  if (changes.syncStatus || changes.settings) await renderSyncState();
});

init().catch((err: unknown) => {
  console.error(err);
  toast(errorMessage(err), { error: true, duration: 5000 });
});
