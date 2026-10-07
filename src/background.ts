import { maybeBackup } from './lib/backups.ts';
import { handleMenuClick, refreshMenus } from './lib/menus.ts';
import { META_KEY } from './lib/providers/chrome-sync.ts';
import { AUTO_LOCK_ALARM, SESSION_KEY, lock } from './lib/store.ts';
import { type SyncResult, syncNow } from './lib/sync.ts';
import type { Envelope } from './lib/types.ts';

const SYNC_ALARM = 'periodic-sync';
let pending: ReturnType<typeof setTimeout> | undefined;

async function safeSync(): Promise<SyncResult | { error: string }> {
  try {
    return await syncNow();
  } catch (err) {
    console.warn('Sync failed', err);
    return { error: (err as Error).message };
  }
}

async function setup(): Promise<void> {
  if (!(await chrome.alarms.get(SYNC_ALARM))) {
    await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 15 });
  }
  await refreshMenus();
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) {
    await lock();
  } else if (alarm.name === SYNC_ALARM) {
    await maybeBackup().catch(() => {});
    await safeSync();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  // Another device pushed a new copy through Chrome sync.
  if (area === 'sync' && META_KEY in changes) {
    clearTimeout(pending);
    pending = setTimeout(safeSync, 2000);
  }
  if (area === 'session' && SESSION_KEY in changes) refreshMenus();
  if (area === 'local' && changes.vault) {
    // Keep the state from before the change, so today's first edit can be undone.
    const previous = changes.vault.oldValue as Envelope | undefined;
    if (previous) maybeBackup(previous).catch(() => {});
    refreshMenus();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleMenuClick(info, tab).catch((err: unknown) => console.warn('Insert failed', err));
});

chrome.runtime.onMessage.addListener((message: { type?: string }, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'sync') return false;
  safeSync().then(sendResponse);
  return true;
});
