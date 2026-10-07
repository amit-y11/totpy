// Right-click "Insert 2FA code" menu on editable fields. Clicking a menu item
// grants activeTab for that tab, which is all chrome.scripting needs; the
// extension has no standing access to any website.

import { matchEntries } from './match.ts';
import { fillCode, showPageToast } from './page.ts';
import { readVault, scheduleAutoLock } from './store.ts';
import { totp } from './totp.ts';
import type { Entry, VaultData } from './types.ts';
import { sortForDisplay } from './vault.ts';

const PARENT = 'otp';
const UNLOCK = 'otp-unlock';
const BEST_MATCH = 'otp-site';
const ENTRY_PREFIX = 'otp-entry:';
const CONTEXTS: ['editable'] = ['editable'];

let queue = Promise.resolve();

function create(props: chrome.contextMenus.CreateProperties): void {
  chrome.contextMenus.create({ contexts: CONTEXTS, ...props }, () => void chrome.runtime.lastError);
}

// Ampersands mark keyboard accelerators in menu titles.
const menuText = (text: string) => text.replaceAll('&', '&&');

function entryTitle(entry: Entry): string {
  if (entry.issuer && entry.account) return menuText(`${entry.issuer} (${entry.account})`);
  return menuText(entry.issuer || entry.account);
}

async function build(): Promise<void> {
  await chrome.contextMenus.removeAll();
  create({ id: PARENT, title: 'Insert 2FA code' });

  let entries: Entry[];
  try {
    entries = sortForDisplay((await readVault()).data.entries);
  } catch {
    create({ id: UNLOCK, parentId: PARENT, title: 'Unlock Totpy…' });
    return;
  }
  if (!entries.length) {
    create({ id: 'otp-empty', parentId: PARENT, title: 'No accounts yet', enabled: false });
    return;
  }
  create({ id: BEST_MATCH, parentId: PARENT, title: 'Best match for this site' });
  create({ id: 'otp-separator', parentId: PARENT, type: 'separator' });
  for (const entry of entries) {
    create({ id: `${ENTRY_PREFIX}${entry.id}`, parentId: PARENT, title: entryTitle(entry) });
  }
}

/** Rebuilds the menu (after unlock, lock or vault changes). */
export function refreshMenus(): Promise<void> {
  queue = queue.then(build).catch((err: unknown) => console.warn('Menu update failed', err));
  return queue;
}

async function openUnlock(): Promise<void> {
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.windows.create({
      url: chrome.runtime.getURL('popup/popup.html'),
      type: 'popup',
      width: 380,
      height: 600,
    });
  }
}

function inject<A extends unknown[], R>(
  tabId: number,
  frameId: number | undefined,
  func: (...args: A) => R,
  args: A,
) {
  return chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId ?? 0] },
    func,
    args,
  });
}

export async function handleMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  const id = String(info.menuItemId);
  if (!id.startsWith(PARENT) || tab?.id === undefined) return;
  const tabId = tab.id;
  if (id === UNLOCK) return openUnlock();

  let data: VaultData;
  try {
    ({ data } = await readVault());
  } catch {
    return openUnlock();
  }

  let entry: Entry | undefined;
  if (id === BEST_MATCH) {
    [entry] = matchEntries(data.entries, info.frameUrl || info.pageUrl || tab.url || '');
    if (!entry) {
      await inject(tabId, info.frameId, showPageToast, ['No account matches this site']);
      return;
    }
  } else {
    entry = data.entries.find((e) => `${ENTRY_PREFIX}${e.id}` === id);
    if (!entry) return;
  }

  const code = await totp(entry);
  const [result] = await inject(tabId, info.frameId, fillCode, [code]);
  if (!result?.result) {
    await inject(tabId, info.frameId, showPageToast, ['Click into the code field first']);
  }
  await scheduleAutoLock();
}
