// Runs the function Chrome injects for Fill and Insert 2FA code against real
// page layouts. Chrome serializes it with toString(), so the test does too.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Page } from 'puppeteer-core';
import { fillCode } from '../src/lib/page.ts';
import { type Extension, launch } from './helpers.ts';

const CODE = '492039';

describe('filling codes into pages', () => {
  let ext: Extension;
  let page: Page;

  before(async () => {
    ext = await launch({ extension: false });
    page = await ext.browser.newPage();
  });

  after(() => ext?.browser.close());

  async function load(html: string, focus?: string): Promise<void> {
    await page.setContent(html);
    if (focus) await page.focus(focus);
  }

  function inject(code = CODE): Promise<boolean> {
    return page.evaluate(`(${fillCode.toString()})(${JSON.stringify(code)})`) as Promise<boolean>;
  }

  const values = (selector: string) =>
    page.$$eval(selector, (els) => els.map((el) => (el as HTMLInputElement).value));

  test('fills a single code field and fires input events', async () => {
    await load(
      `<form><input id="otp" autocomplete="one-time-code"></form>
       <script>
         window.events = [];
         otp.addEventListener('input', () => events.push('input'));
         otp.addEventListener('change', () => events.push('change'));
       </script>`,
      '#otp',
    );
    assert.equal(await inject(), true);
    assert.deepEqual(await values('#otp'), [CODE]);
    assert.deepEqual(await page.evaluate('window.events'), ['input', 'change']);
  });

  test('frameworks that wrap the value setter see the change', async () => {
    // React tracks the last value it set through the instance property, and
    // ignores input events unless the native setter changed it.
    await load(
      `<input id="otp">
       <script>
         const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
         let tracked = '';
         Object.defineProperty(otp, 'value', {
           get() { return native.get.call(this); },
           set(v) { tracked = v; native.set.call(this, v); },
         });
         window.seen = [];
         otp.addEventListener('input', () => { if (otp.value !== tracked) seen.push(otp.value); });
       </script>`,
      '#otp',
    );
    await inject();
    assert.deepEqual(await page.evaluate('window.seen'), [CODE]);
  });

  test('spreads the code over one box per digit', async () => {
    await load(
      `<form>${'<input maxlength="1" inputmode="numeric">'.repeat(6)}</form>`,
      'input:first-child',
    );
    assert.equal(await inject(), true);
    assert.deepEqual(await values('input'), [...CODE]);
  });

  test('digit boxes outside a form are found through their group', async () => {
    await load(
      `<input id="email" value="me@example.com">
       <div role="group"><div>${'<span><input maxlength="1"></span>'.repeat(6)}</div></div>`,
      '[role=group] input',
    );
    await inject();
    assert.deepEqual(await values('[role=group] input'), [...CODE]);
    assert.deepEqual(await values('#email'), ['me@example.com']);
  });

  test('types into rich text editors', async () => {
    await load('<div id="editor" contenteditable="true"></div>', '#editor');
    assert.equal(await inject(), true);
    assert.equal(await page.$eval('#editor', (el) => el.textContent), CODE);
  });

  test('reaches inputs inside shadow DOM', async () => {
    await load(
      `<otp-field></otp-field>
       <script>
         const root = document.querySelector('otp-field').attachShadow({ mode: 'open' });
         root.innerHTML = '<input id="inner">';
         root.getElementById('inner').focus();
       </script>`,
    );
    assert.equal(await inject(), true);
    const value = await page.$eval(
      'otp-field',
      (el) => el.shadowRoot!.querySelector('input')!.value,
    );
    assert.equal(value, CODE);
  });

  test('does nothing when no field is focused', async () => {
    await load('<input id="otp"><button id="go">Go</button>', '#go');
    assert.equal(await inject(), false);
    assert.deepEqual(await values('#otp'), ['']);
  });
});
