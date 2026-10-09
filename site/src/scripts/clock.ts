// One real-time clock drives every dial, ring and code on the page.
// Codes are computed with the same TOTP implementation the extension ships.
import { totp } from '../../../src/lib/totp.ts';

const PERIOD = 30;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const clocks = [...document.querySelectorAll<HTMLElement>('[data-clock]')];
const secondsEls = [...document.querySelectorAll<HTMLElement>('[data-live-seconds]')];
const codes = new Map<string, string>();

export function currentCode(secret: string): string | undefined {
  return codes.get(secret);
}

function renderCode(el: HTMLElement, code: string): void {
  if (el.hasAttribute('data-odo')) {
    el.querySelectorAll<HTMLElement>('.odo-strip').forEach((strip, i) => {
      strip.style.setProperty('--d', code.charAt(i));
    });
    return;
  }
  if (el.hasAttribute('data-split')) {
    const nodes: HTMLElement[] = [];
    [...code].forEach((ch, i) => {
      if (i === 3) {
        const gap = document.createElement('span');
        gap.className = 'gap';
        nodes.push(gap);
      }
      const digit = document.createElement('span');
      digit.className = 'digit';
      digit.textContent = ch;
      nodes.push(digit);
    });
    el.replaceChildren(...nodes);
    return;
  }
  el.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
}

async function refresh(now: number, initial: boolean): Promise<void> {
  const targets = [...document.querySelectorAll<HTMLElement>('[data-code]')];
  const secrets = new Set(targets.map((el) => el.dataset.code ?? ''));
  await Promise.all(
    [...secrets].map(async (secret) => codes.set(secret, await totp({ secret }, now))),
  );
  for (const el of targets) {
    const code = codes.get(el.dataset.code ?? '');
    if (code) renderCode(el, code);
  }
  if (initial) {
    // Show the first code instantly, then let later codes roll.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document.querySelectorAll('.odo.no-anim').forEach((el) => el.classList.remove('no-anim'));
      }),
    );
  } else {
    for (const clock of clocks) {
      clock.classList.remove('is-rollover');
      void clock.offsetWidth;
      clock.classList.add('is-rollover');
    }
  }
  window.dispatchEvent(new CustomEvent('totpy:tick', { detail: { initial } }));
}

let lastCounter = -1;
let lastRemaining = -1;

function frame(): void {
  const now = Date.now();
  const elapsed = (now / 1000) % PERIOD;
  const remaining = Math.ceil(PERIOD - elapsed);

  // With reduced motion the dials step once per second instead of gliding.
  const t = reduceMotion ? (PERIOD - remaining) / PERIOD : elapsed / PERIOD;
  for (const clock of clocks) clock.style.setProperty('--t', t.toFixed(5));

  if (remaining !== lastRemaining) {
    lastRemaining = remaining;
    for (const el of secondsEls) el.textContent = String(remaining);
    for (const clock of clocks) clock.classList.toggle('is-ending', remaining <= 5);
  }

  const counter = Math.floor(now / 1000 / PERIOD);
  if (counter !== lastCounter) {
    const initial = lastCounter === -1;
    lastCounter = counter;
    void refresh(now, initial);
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
