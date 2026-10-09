import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Page } from 'puppeteer-core';
import { secondsRemaining, totp } from '../src/lib/totp.ts';
import {
  type Extension,
  currentView,
  fill,
  formError,
  launch,
  openOptions,
  openPopup,
  storage,
  visibleIssuers,
  waitForToast,
  waitForView,
} from './helpers.ts';

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'staple and pony';
const SECRET = 'JBSWY3DPEHPK3PXP';
const IMPORT = [
  'otpauth://totp/GitHub:octo?secret=GEZDGNBVGY3TQOJQ&issuer=GitHub',
  'otpauth://totp/Google:me%40gmail.com?secret=MFRGGZDFMZTWQ2LK&issuer=Google',
  'otpauth://totp/Stripe:me%40example.com?secret=ONSWG4TFORZWK4TF&issuer=Stripe&digits=8',
].join('\n');

/** Waits until a code is not about to roll over, so the page and the test agree. */
async function steadyClock(): Promise<void> {
  while (secondsRemaining(30) < 4) await new Promise((r) => setTimeout(r, 250));
}

function codeFor(page: Page, issuer: string): Promise<string> {
  return page.$$eval(
    '#entries .entry',
    (rows, name) => {
      const row = rows.find((r) => r.querySelector('.issuer')?.textContent === name);
      return row?.querySelector('.code')?.textContent?.replace(/\s/g, '') ?? '';
    },
    issuer,
  );
}

async function unlockWith(page: Page, password: string): Promise<void> {
  await fill(page, '#unlock-form [name=password]', password);
  await page.click('#unlock-form button[type=submit]');
}

describe('popup', () => {
  let ext: Extension;
  let page: Page;
  let recoveryCode = '';

  before(async () => {
    ext = await launch();
    page = await openPopup(ext);
  });

  after(() => ext?.browser.close());

  test('first run asks for a master password', async () => {
    assert.equal(await currentView(page), 'setup');
  });

  test('rejects mismatched or short passwords', async () => {
    await fill(page, '#setup-form [name=password]', PASSWORD);
    await fill(page, '#setup-form [name=confirm]', 'something else');
    await page.click('#setup-form button[type=submit]');
    await page.waitForFunction(() => document.querySelector('#setup-form .error')?.textContent);
    assert.equal(await formError(page, '#setup-form'), 'Passwords do not match');
    assert.equal(await currentView(page), 'setup');
  });

  test('creating a vault shows the recovery code once', async () => {
    await fill(page, '#setup-form [name=confirm]', PASSWORD);
    await page.click('#setup-form button[type=submit]');
    await waitForView(page, 'recovery');

    recoveryCode = await page.$eval('#recovery-code', (el) => el.textContent ?? '');
    assert.match(recoveryCode, /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);

    const continueButton = '#recovery-done';
    assert.equal(await page.$eval(continueButton, (b) => (b as HTMLButtonElement).disabled), true);
    await page.click('#recovery-ack');
    await page.click(continueButton);
    await waitForView(page, 'list');
    assert.equal(await page.$eval('#empty', (el) => (el as HTMLElement).hidden), false);

    // The recovery code is not kept anywhere in plain text.
    const local = JSON.stringify(await storage(page, 'local'));
    assert.ok(!local.includes(recoveryCode.replaceAll('-', '')));
    assert.ok(!local.includes(recoveryCode));
  });

  test('adds an account and shows its current code', async () => {
    await page.click('#btn-add');
    await waitForView(page, 'edit');
    await page.type('#edit-form [name=issuer]', 'Example');
    await page.type('#edit-form [name=account]', 'me@example.com');
    await page.type('#edit-form [name=secret]', SECRET.toLowerCase().replace(/(.{4})/g, '$1 '));
    await page.click('#edit-form button[type=submit]');
    await waitForView(page, 'list');
    await waitForToast(page, 'Account added');

    await steadyClock();
    assert.equal(await codeFor(page, 'Example'), await totp({ secret: SECRET }));
  });

  test('refuses to add the same account twice', async () => {
    await page.click('#btn-add');
    await page.type('#edit-form [name=issuer]', 'Example');
    await page.type('#edit-form [name=account]', 'me@example.com');
    await page.type('#edit-form [name=secret]', SECRET);
    await page.click('#edit-form button[type=submit]');
    await page.waitForFunction(() => document.querySelector('#edit-form .error')?.textContent);
    assert.equal(await formError(page, '#edit-form'), 'This account is already added');
    await page.click('#edit-back');
    await waitForView(page, 'list');
  });

  test('imports several otpauth links at once', async () => {
    await page.click('#btn-add');
    await page.click('#import-tools summary');
    await page.$eval('#uri-input', (el, v) => ((el as HTMLTextAreaElement).value = v), IMPORT);
    await page.click('#uri-apply');
    await waitForView(page, 'list');
    assert.match(await waitForToast(page, 'Imported'), /Imported 3 of 3 accounts/);
    assert.deepEqual(await visibleIssuers(page), ['Example', 'GitHub', 'Google', 'Stripe']);

    await steadyClock();
    const stripe = await codeFor(page, 'Stripe');
    assert.equal(stripe, await totp({ secret: 'ONSWG4TFORZWK4TF', digits: 8 }));
  });

  test('search filters accounts', async () => {
    await page.type('#search', 'goo');
    assert.deepEqual(await visibleIssuers(page), ['Google']);
    await fill(page, '#search', 'nothing like this');
    assert.deepEqual(await visibleIssuers(page), []);
    assert.equal(await page.$eval('#no-results', (el) => (el as HTMLElement).hidden), false);
    await fill(page, '#search', '');
    assert.equal((await visibleIssuers(page)).length, 4);
  });

  test('clicking an account copies its code', async () => {
    await ext.browser
      .defaultBrowserContext()
      .overridePermissions(ext.url(''), ['clipboard-read', 'clipboard-sanitized-write']);
    await page.bringToFront();
    await steadyClock();
    const rows = await page.$$('#entries .entry');
    await rows[0]!.click();
    await waitForToast(page, 'Copied to clipboard');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied, await totp({ secret: SECRET }));
  });

  test('suggests the account for the site in the current tab', async () => {
    const popup = await openPopup(ext, { tabUrl: 'https://github.com/sessions/two-factor/app' });
    await waitForView(popup, 'list');
    const sections = await popup.$$eval('#entries .section', (els) =>
      els.map((el) => el.textContent),
    );
    assert.deepEqual(sections, ['Suggested for github.com', 'All accounts']);
    assert.equal((await visibleIssuers(popup))[0], 'GitHub');
    assert.equal(await popup.$$eval('#entries .fill', (els) => els.length), 1);
    await popup.close();
  });

  test('warns when the computer clock is off', async () => {
    await page.evaluate(() =>
      chrome.storage.local.set({ clockCheck: { at: Date.now(), offsetMs: 125_000 } }),
    );
    const popup = await openPopup(ext);
    await popup.waitForSelector('#clock-warning:not([hidden])');
    const warning = await popup.$eval('#clock-warning', (el) => el.textContent ?? '');
    assert.match(warning, /2 min 5 s behind/);
    await popup.close();
    await page.evaluate(() =>
      chrome.storage.local.set({ clockCheck: { at: Date.now(), offsetMs: 0 } }),
    );
  });

  test('locks, and only the right password unlocks', async () => {
    await page.click('#btn-lock');
    await waitForView(page, 'unlock');
    assert.deepEqual(await storage(page, 'session'), {});

    await unlockWith(page, 'wrong password');
    await page.waitForFunction(() => document.querySelector('#unlock-form .error')?.textContent);
    assert.equal(await currentView(page), 'unlock');

    await unlockWith(page, PASSWORD);
    await waitForView(page, 'list');
    assert.equal((await visibleIssuers(page)).length, 4);
  });

  test('a new popup opens unlocked while the session lasts', async () => {
    const popup = await openPopup(ext);
    assert.equal(await currentView(popup), 'list');
    await popup.close();
  });

  test('the recovery code resets a forgotten password', async () => {
    await page.click('#btn-lock');
    await waitForView(page, 'unlock');
    await page.click('#unlock-forgot');
    await waitForView(page, 'recover');

    await page.type('#recover-form [name=code]', recoveryCode.toLowerCase());
    await page.type('#recover-form [name=password]', NEW_PASSWORD);
    await page.type('#recover-form [name=confirm]', NEW_PASSWORD);
    await page.click('#recover-form button[type=submit]');
    await waitForView(page, 'list');
    await waitForToast(page, 'Password reset');
    assert.equal((await visibleIssuers(page)).length, 4);

    await page.click('#btn-lock');
    await waitForView(page, 'unlock');
    await unlockWith(page, PASSWORD);
    await page.waitForFunction(() => document.querySelector('#unlock-form .error')?.textContent);
    await unlockWith(page, NEW_PASSWORD);
    await waitForView(page, 'list');
  });

  test('deleting an account asks first', async () => {
    const dialogs: string[] = [];
    const onDialog = (dialog: { message(): string; accept(): Promise<void> }) => {
      dialogs.push(dialog.message());
      void dialog.accept();
    };
    page.on('dialog', onDialog);
    const edit = await page.$$('#entries .entry .edit');
    await edit[3]!.click(); // Stripe
    await waitForView(page, 'edit');
    await page.click('#btn-delete');
    await waitForView(page, 'list');
    page.off('dialog', onDialog);

    assert.match(dialogs[0] ?? '', /^Delete Stripe\?/);
    assert.deepEqual(await visibleIssuers(page), ['Example', 'GitHub', 'Google']);
  });

  test('settings show sync providers and save auto-lock', async () => {
    const options = await openOptions(ext);
    await options.waitForSelector('#view-main:not([hidden])');
    const providers = await options.$$eval('#providers .provider', (cards) =>
      cards.map((card) => ({
        name: card.querySelector('h2')?.textContent,
        on: card.querySelector('.switch')?.getAttribute('aria-checked'),
        available: !(card.querySelector('.switch') as HTMLButtonElement | null)?.disabled,
      })),
    );
    assert.deepEqual(providers, [
      { name: 'Chrome sync', on: 'true', available: true },
      { name: 'Google Drive', on: 'false', available: true },
    ]);

    await options.select('#auto-lock', '5');
    await options.waitForFunction(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      return (settings as { autoLockMinutes?: number }).autoLockMinutes === 5;
    });
    await options.close();
  });
});
