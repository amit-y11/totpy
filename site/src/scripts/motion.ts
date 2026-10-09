// Scroll reveals, the scroll-driven handoff story, live ciphertext, counters
// and the small interactive touches. Everything respects reduced motion.
import { currentCode } from './clock';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => [
  ...root.querySelectorAll<T>(selector),
];

// ---- Reveal once, and play loops only while visible -------------------------

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      revealObserver.unobserve(entry.target);
    }
  },
  { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
);
$$('[data-reveal]').forEach((el) => revealObserver.observe(el));

const playObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) entry.target.classList.toggle('is-playing', entry.isIntersecting);
  },
  { threshold: 0.1 },
);
$$('[data-play]').forEach((el) => playObserver.observe(el));

const isPlaying = (el: Element | null) => Boolean(el?.classList.contains('is-playing'));

// ---- Fit fixed-size scenes into their container -----------------------------

function fit(el: HTMLElement, width: number, apply: (scale: number) => void): void {
  const parent = el.parentElement;
  if (!parent) return;
  new ResizeObserver(() => apply(Math.min(1, parent.clientWidth / width))).observe(parent);
}

$$('[data-fit]').forEach((scene) => {
  fit(scene, Number(scene.dataset.fit), (scale) => {
    scene.style.zoom = String(scale);
  });
});

// ---- Text scramble ----------------------------------------------------------

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const scrambleTokens = new WeakMap<Element, number>();
const randomGlyph = (set = GLYPHS) => set.charAt(Math.floor(Math.random() * set.length));

function scramble(el: HTMLElement, to: string, duration = 900, glyphs = GLYPHS): void {
  if (reduceMotion) {
    el.textContent = to;
    return;
  }
  const token = (scrambleTokens.get(el) ?? 0) + 1;
  scrambleTokens.set(el, token);
  const start = performance.now();
  const step = (now: number) => {
    if (scrambleTokens.get(el) !== token) return;
    const p = Math.min(1, (now - start) / duration);
    let out = '';
    for (let i = 0; i < to.length; i++) {
      const settleAt = 0.25 + (i / to.length) * 0.75;
      const ch = to.charAt(i);
      out += p >= settleAt || ch === '-' ? ch : randomGlyph(glyphs);
    }
    el.textContent = out;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---- Handoff: scroll story ---------------------------------------------------

const handoff = document.querySelector<HTMLElement>('[data-handoff]');
if (handoff) {
  const stage = handoff.querySelector<HTMLElement>('[data-stage]');
  const stageWrap = handoff.querySelector<HTMLElement>('[data-stage-wrap]');
  const boxes = $$('.otp-box', handoff);
  const source = handoff.querySelector<HTMLElement>('[data-fill-source]');
  const captions = $$('[data-step]', handoff);
  const thresholds = [0.18, 0.44, 0.7];
  let step = -1;
  let flights: Animation[] = [];

  if (stage && stageWrap) {
    fit(stage, 600, (scale) => stageWrap.style.setProperty('--scale', scale.toFixed(4)));
  }

  const clearBoxes = () => {
    flights.forEach((a) => a.cancel());
    flights = [];
    $$('.fly-digit').forEach((el) => el.remove());
    boxes.forEach((box) => {
      box.textContent = '';
      box.classList.remove('is-filled');
    });
  };

  const fillBoxes = (code: string) => {
    boxes.forEach((box, i) => {
      box.textContent = code.charAt(i);
      box.classList.add('is-filled');
    });
  };

  const fly = () => {
    const secret = source?.dataset.code ?? '';
    const code = currentCode(secret);
    const digits = source ? $$('.digit', source) : [];
    if (!code || digits.length !== 6) return;
    if (reduceMotion) {
      fillBoxes(code);
      return;
    }
    window.setTimeout(() => {
      if (step < 2) return;
      digits.forEach((digit, i) => {
        const box = boxes[i];
        if (!box) return;
        const from = digit.getBoundingClientRect();
        const to = box.getBoundingClientRect();
        const el = document.createElement('span');
        el.className = 'fly-digit';
        el.textContent = digit.textContent;
        Object.assign(el.style, {
          left: `${from.left}px`,
          top: `${from.top}px`,
          width: `${from.width}px`,
          height: `${from.height}px`,
          fontSize: `${from.height * 0.82}px`,
        });
        document.body.append(el);
        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        const grow = (to.height * 0.46) / from.height;
        const animation = el.animate(
          [
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
            {
              transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 70}px) scale(${grow * 1.4}) rotate(-8deg)`,
              offset: 0.5,
            },
            { transform: `translate(${dx}px, ${dy}px) scale(${grow})`, opacity: 1 },
          ],
          { duration: 720, delay: i * 75, easing: 'cubic-bezier(.6,0,.2,1)', fill: 'forwards' },
        );
        flights.push(animation);
        animation.finished
          .then(() => {
            // Read the code again on landing: it may have rolled over mid-flight.
            const latest = currentCode(secret) ?? code;
            if (step >= 2) {
              box.textContent = latest.charAt(i);
              box.classList.add('is-filled');
            }
            el.remove();
          })
          .catch(() => el.remove());
      });
    }, 900);
  };

  const setStep = (next: number) => {
    if (next === step) return;
    const prev = step;
    step = next;
    for (let i = 1; i <= 3; i++) handoff.classList.toggle(`is-s${i}`, next >= i);
    // Steps 0–2 each have a caption; the final 'signed in' state keeps the last one.
    const active = Math.min(3, next + 1);
    captions.forEach((c) => c.classList.toggle('is-active', Number(c.dataset.step) === active));
    if (next >= 2 && prev < 2) fly();
    if (next < 2) clearBoxes();
  };

  const onScroll = () => {
    const rect = handoff.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    const p = Math.min(1, Math.max(0, -rect.top / total));
    handoff.style.setProperty('--p', p.toFixed(4));
    setStep(thresholds.filter((t) => p >= t).length);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  window.addEventListener('totpy:tick', () => {
    if (step < 2 || !boxes.some((b) => b.classList.contains('is-filled'))) return;
    const code = currentCode(source?.dataset.code ?? '');
    if (code) fillBoxes(code);
  });
}

// ---- Cipher: real AES-256-GCM ciphertext ------------------------------------

const cipherSection = document.querySelector<HTMLElement>('[data-cipher-section]');
const cipherRows = $$('[data-cipher]');

async function encryptRows(): Promise<void> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  await Promise.all(
    cipherRows.map(async (row, i) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plain = new TextEncoder().encode(`${row.dataset.cipher}|${Date.now()}`);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
      const b64 = btoa(String.fromCharCode(...iv, ...ct));
      window.setTimeout(() => scramble(row, b64.slice(0, 30), 1000), i * 120);
    }),
  );
}

if (cipherSection) {
  let encryptedOnce = false;
  new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting && !encryptedOnce) {
        encryptedOnce = true;
        void encryptRows();
      }
    },
    { threshold: 0.3 },
  ).observe(cipherSection);
  window.addEventListener('totpy:tick', (event) => {
    const { initial } = (event as CustomEvent<{ initial: boolean }>).detail;
    if (!initial && isPlaying(cipherSection)) void encryptRows();
  });
}

// ---- Counters ----------------------------------------------------------------

const counterObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      counterObserver.unobserve(entry.target);
      const el = entry.target as HTMLElement;
      const to = Number(el.dataset.countTo);
      const from = Number(el.dataset.countFrom ?? 0);
      if (reduceMotion) {
        el.textContent = to.toLocaleString('en-US');
        continue;
      }
      const start = performance.now();
      const duration = 1700;
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - p) ** 4;
        el.textContent = Math.round(from + (to - from) * eased).toLocaleString('en-US');
        if (p < 1) requestAnimationFrame(tick);
      };
      el.textContent = from.toLocaleString('en-US');
      requestAnimationFrame(tick);
    }
  },
  { threshold: 0.6 },
);
$$('[data-count-to]').forEach((el) => counterObserver.observe(el));

// ---- Bento: site match, recovery code, spotlight -----------------------------

const bento = document.querySelector<HTMLElement>('[data-bento]');
if (bento) {
  const siteText = bento.querySelector<HTMLElement>('[data-site-text]');
  const siteRows = $$('[data-site-row]', bento);
  const sites = [
    { host: 'orbit.dev', match: 'orbit' },
    { host: 'northwind.io', match: 'northwind' },
    { host: 'console.acme.dev', match: 'acme' },
  ];
  let siteIndex = 0;

  const showSite = async () => {
    const site = sites[siteIndex % sites.length];
    siteIndex += 1;
    if (!site || !siteText) return;
    siteRows.forEach((row) => row.classList.remove('is-match'));
    if (reduceMotion) {
      siteText.textContent = site.host;
    } else {
      for (let i = 0; i <= site.host.length; i++) {
        siteText.textContent = site.host.slice(0, i);
        await new Promise((r) => setTimeout(r, 55));
      }
    }
    siteRows.forEach((row) => row.classList.toggle('is-match', row.dataset.siteRow === site.match));
  };

  const recoveryEls = $$('[data-recovery]', bento);
  const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const newRecoveryLine = () =>
    Array.from({ length: 4 }, () =>
      Array.from({ length: 4 }, () => randomGlyph(BASE32)).join(''),
    ).join('-');

  void showSite();
  window.setInterval(() => {
    if (!isPlaying(bento) || reduceMotion) return;
    void showSite();
  }, 3200);
  window.setInterval(() => {
    if (!isPlaying(bento) || reduceMotion) return;
    recoveryEls.forEach((el, i) =>
      window.setTimeout(() => scramble(el, newRecoveryLine(), 900, BASE32), i * 150),
    );
  }, 3600);

  $$('.card', bento).forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    });
  });
}
