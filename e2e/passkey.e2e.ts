import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { CDPSession, Page } from 'puppeteer-core';
import {
  type Extension,
  currentView,
  fill,
  formError,
  launch,
  openPopup,
  storage,
  waitForToast,
  waitForView,
} from './helpers.ts';

const PASSWORD = 'correct horse battery';

/**
 * Adds a virtual authenticator that approves every request with user
 * verification. Credentials live with this page, across navigations.
 */
async function addAuthenticator(cdp: CDPSession, hasPrf: boolean): Promise<string> {
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf,
      automaticPresenceSimulation: true,
    },
  });
  return authenticatorId;
}

async function goto(page: Page, ext: Extension, path: string): Promise<void> {
  await page.goto(ext.url(path));
  await page.waitForSelector('#view-loading', { hidden: true });
}

async function openPasskeySettings(page: Page): Promise<void> {
  await page.$eval('#passkey-form', (el) => el.closest('details')!.setAttribute('open', ''));
}

async function setUpPasskey(page: Page, password: string): Promise<void> {
  await fill(page, '#passkey-form [name=password]', password);
  await page.click('#passkey-form button[type=submit]');
}

/** Creates a vault in the popup and stops at the passkey offer. */
async function createVault(page: Page): Promise<void> {
  await fill(page, '#setup-form [name=password]', PASSWORD);
  await fill(page, '#setup-form [name=confirm]', PASSWORD);
  await page.click('#setup-form button[type=submit]');
  await waitForView(page, 'recovery');
  await page.click('#recovery-ack');
  await page.click('#recovery-done');
  await waitForView(page, 'passkey');
}

describe('passkey during onboarding', () => {
  let ext: Extension;
  let page: Page;

  before(async () => {
    ext = await launch();
    page = await openPopup(ext);
  });

  after(() => ext?.browser.close());

  test('is offered after the recovery code and can be set up there', async () => {
    await addAuthenticator(await page.createCDPSession(), true);
    await createVault(page);
    await page.click('#passkey-form button[type=submit]');
    await waitForView(page, 'list');
    await waitForToast(page, 'Passkey unlock is on');

    await page.click('#btn-lock');
    await waitForView(page, 'unlock');
    await page.click('#unlock-passkey');
    await waitForView(page, 'list');
  });
});

describe('passkey unlock', () => {
  let ext: Extension;
  let page: Page;
  let cdp: CDPSession;

  before(async () => {
    ext = await launch();
    page = await openPopup(ext);
    cdp = await page.createCDPSession();
    await createVault(page);
    await page.click('#passkey-skip');
    await waitForView(page, 'list');
  });

  after(() => ext?.browser.close());

  test('the popup offers no passkey until one is set up', async () => {
    await page.click('#btn-lock');
    await waitForView(page, 'unlock');
    assert.equal(await page.$eval('#unlock-passkey', (el) => (el as HTMLElement).hidden), true);
    await fill(page, '#unlock-form [name=password]', PASSWORD);
    await page.click('#unlock-form button[type=submit]');
    await waitForView(page, 'list');
  });

  test('refuses a passkey without PRF support', async () => {
    const id = await addAuthenticator(cdp, false);
    await goto(page, ext, 'options/options.html');
    await openPasskeySettings(page);
    await setUpPasskey(page, PASSWORD);
    await page.waitForFunction(() => document.querySelector('#passkey-form .error')?.textContent);
    assert.match(await formError(page, '#passkey-form'), /does not support unlocking/);
    assert.equal((await storage(page, 'local', 'passkey')).passkey, undefined);
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: id });
  });

  test('setting up needs the master password', async () => {
    await addAuthenticator(cdp, true);
    await setUpPasskey(page, 'wrong password');
    await page.waitForFunction(
      () => document.querySelector('#passkey-form .error')?.textContent === 'Incorrect password',
    );

    await setUpPasskey(page, PASSWORD);
    await waitForToast(page, 'Passkey unlock is on');
    assert.equal(await page.$eval('#passkey-form', (el) => (el as HTMLElement).hidden), true);
    const { passkey } = await storage<{ passkey: Record<string, unknown> }>(
      page,
      'local',
      'passkey',
    );
    assert.deepEqual(Object.keys(passkey).sort(), [
      'createdAt',
      'credentialId',
      'ct',
      'iv',
      'keyId',
      'prfSalt',
    ]);
    // Only the encrypted vault goes to Chrome sync, never the passkey wrap.
    assert.ok(!JSON.stringify(await storage(page, 'sync')).includes(passkey.ct as string));
  });

  test('a locked popup asks for the passkey right away', async () => {
    await page.click('#lock-now');
    await goto(page, ext, 'popup/popup.html');
    await waitForView(page, 'list');
  });

  test('after locking, the passkey button unlocks', async () => {
    await page.click('#btn-lock');
    await waitForView(page, 'unlock');
    assert.equal(await page.$eval('#unlock-passkey', (el) => (el as HTMLElement).hidden), false);
    assert.equal(await currentView(page), 'unlock');
    await page.click('#unlock-passkey');
    await waitForView(page, 'list');
  });

  test('turning it off removes the passkey option', async () => {
    await goto(page, ext, 'options/options.html');
    await openPasskeySettings(page);
    await page.click('#passkey-remove');
    await waitForToast(page, 'Passkey unlock is off');
    await page.click('#lock-now');
    await goto(page, ext, 'popup/popup.html');
    assert.equal(await currentView(page), 'unlock');
    assert.equal(await page.$eval('#unlock-passkey', (el) => (el as HTMLElement).hidden), true);
  });
});
