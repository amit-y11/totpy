// Tiny DOM helpers. User data is only ever inserted as text, never as HTML.

/** Returns the element or throws, so a missing element fails loudly. */
export function $<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

export function $$<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

export type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** A named control of a form. */
export function field<T extends FormField = HTMLInputElement>(
  form: HTMLFormElement,
  name: string,
): T {
  const el = form.elements.namedItem(name);
  if (!el) throw new Error(`Missing form field: ${name}`);
  return el as T;
}

export const fieldValue = (form: HTMLFormElement, name: string): string => field(form, name).value;

// Lets handlers declare a specific event type (e.g. KeyboardEvent).
type Handler = { bivarianceHack(event: Event): void }['bivarianceHack'];
type AttrValue = string | number | boolean | null | undefined | Handler;
export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (typeof value === 'function') {
      el.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === 'class') {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(name, '');
    } else if (value !== false && value != null) {
      el.setAttribute(name, String(value));
    }
  }
  const nodes = children.flat().filter((c): c is Node | string => c != null && c !== false);
  el.append(...nodes);
  return el;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, { error = false, duration = 1800 } = {}): void {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), duration);
}

export function setError(form: HTMLFormElement, message = ''): void {
  const el = form.querySelector('.error');
  if (el) el.textContent = message;
}

export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Runs `fn` while disabling the form's submit button and showing errors inline. */
export async function busy<T>(form: HTMLFormElement, fn: () => Promise<T>): Promise<T | undefined> {
  const button = form.querySelector<HTMLButtonElement>('[type="submit"]');
  setError(form);
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    setError(form, errorMessage(err));
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

/** Wires a form's submit event to `fn`, wrapped in busy(). */
export function onSubmit(
  form: HTMLFormElement,
  fn: (form: HTMLFormElement) => Promise<unknown>,
): void {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void busy(form, () => fn(form));
  });
}

export function formatCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function download(filename: string, content: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function recoveryCodeFile(code: string): string {
  return [
    'Totpy recovery code',
    '',
    code,
    '',
    'Use it to reset your master password if you forget it.',
    'Anyone with this code and a copy of your vault can read your 2FA keys.',
    '',
  ].join('\n');
}

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
} as const;

export type IconName = keyof typeof icons;

const isIconName = (name: string): name is IconName => Object.hasOwn(icons, name);

// Icon markup is static and trusted; it never contains user data.
export function icon(name: IconName): SVGElement {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  return span.firstElementChild as SVGElement;
}

/** Replaces <i data-icon="name"></i> placeholders in static markup. */
export function hydrateIcons(root: ParentNode = document): void {
  for (const el of $$('[data-icon]', root)) {
    const name = el.dataset.icon ?? '';
    if (isIconName(name)) el.replaceWith(icon(name));
  }
}
