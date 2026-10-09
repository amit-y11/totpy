// Drives the built extension (dist/) in a real, headless Google Chrome.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

function chromePath(): string {
  const path = [process.env.CHROME_PATH, ...CHROME_PATHS].find((p) => p && existsSync(p));
  if (!path) throw new Error('Google Chrome not found. Set CHROME_PATH to its executable.');
  return path;
}

export interface Extension {
  browser: Browser;
  id: string;
  url(path: string): string;
}

export async function launch({ extension = true } = {}): Promise<Extension> {
  const dist = resolve(import.meta.dirname, '../dist');
  if (extension && !existsSync(`${dist}/manifest.json`)) {
    throw new Error('dist/ is missing. Run `npm run build` first.');
  }
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    pipe: true,
    enableExtensions: extension,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const id = extension ? await browser.installExtension(dist) : '';
  return { browser, id, url: (path) => `chrome-extension://${id}/${path}` };
}

export interface PopupOptions {
  /** URL of the "current tab" the popup should see, for site suggestions. */
  tabUrl?: string;
}

/** Opens the popup as a page. Chrome would show it attached to the toolbar button. */
export async function openPopup(ext: Extension, { tabUrl }: PopupOptions = {}): Promise<Page> {
  const page = await ext.browser.newPage();
  await page.setViewport({ width: 360, height: 600 });
  if (tabUrl) {
    await page.evaluateOnNewDocument((url: string) => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (async (info: chrome.tabs.QueryInfo) =>
        info.active ? [{ id: 1, url, active: true }] : query(info)) as typeof chrome.tabs.query;
    }, tabUrl);
  }
  await page.goto(ext.url('popup/popup.html'));
  await page.waitForSelector('#view-loading', { hidden: true });
  return page;
}

export async function openOptions(ext: Extension): Promise<Page> {
  const page = await ext.browser.newPage();
  await page.goto(ext.url('options/options.html'));
  await page.waitForSelector('#view-loading', { hidden: true });
  return page;
}

/** Name of the popup view that is showing, e.g. "setup" or "list". */
export function currentView(page: Page): Promise<string> {
  return page.$$eval('body > section.view', (views) =>
    views
      .filter((v) => !(v as HTMLElement).hidden)
      .map((v) => v.id.replace('view-', ''))
      .join(),
  );
}

export async function waitForView(page: Page, view: string): Promise<void> {
  await page.waitForSelector(`#view-${view}:not([hidden])`);
}

/** Waits for a toast containing `text` and returns its full message. */
export async function waitForToast(page: Page, text: string): Promise<string> {
  const handle = await page.waitForFunction(
    (t: string) => {
      const el = document.querySelector<HTMLElement>('#toast');
      return el && !el.hidden && el.textContent?.includes(t) ? el.textContent : null;
    },
    {},
    text,
  );
  return (await handle.jsonValue()) as string;
}

export function formError(page: Page, form: string): Promise<string> {
  return page.$eval(`${form} .error`, (el) => el.textContent ?? '');
}

/** Replaces a field's value the way a user would: select everything, then type over it. */
export async function fill(page: Page, selector: string, value: string): Promise<void> {
  await page.focus(selector);
  await page.$eval(selector, (el) => (el as HTMLInputElement).select());
  if (value) await page.keyboard.type(value);
  else await page.keyboard.press('Backspace');
}

/** Issuers of the visible account rows, in display order. */
export function visibleIssuers(page: Page): Promise<string[]> {
  return page.$$eval('#entries .entry:not([hidden]) .issuer', (els) =>
    els.map((el) => el.textContent ?? ''),
  );
}

/** Reads storage through an extension page, as the extension sees it. */
export function storage<T = Record<string, unknown>>(
  page: Page,
  area: 'local' | 'session' | 'sync',
  keys?: string | string[],
): Promise<T> {
  return page.evaluate((a, k) => chrome.storage[a].get(k ?? null), area, keys) as Promise<T>;
}
