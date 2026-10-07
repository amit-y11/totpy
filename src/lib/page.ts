// Functions injected into web pages with chrome.scripting.executeScript.
// Chrome serializes them with toString(), so they must be self-contained:
// no imports, outer variables or helpers the bundler might add.

/** Types `code` into the focused field. Returns false if nothing is focused. */
export function fillCode(code: string): boolean {
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    // Use the native setter so frameworks like React notice the change.
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body) return false;

  if (el instanceof HTMLElement && el.isContentEditable) {
    document.execCommand('insertText', false, code);
    return true;
  }
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;

  // Codes split across one box per digit.
  if (el.maxLength === 1) {
    const scope =
      el.form ?? el.closest('fieldset, [role="group"]') ?? el.parentElement?.parentElement;
    const boxes = [...(scope ?? document).querySelectorAll('input')].filter(
      (input) => input.maxLength === 1 && !input.disabled && input.type !== 'hidden',
    );
    if (boxes.length >= code.length) {
      boxes.slice(0, code.length).forEach((box, i) => {
        box.focus();
        setValue(box, code.charAt(i));
      });
      return true;
    }
  }

  setValue(el, code);
  return true;
}

/** Shows a short message in the corner of the page. */
export function showPageToast(message: string): void {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  const box = document.createElement('div');
  box.textContent = message;
  box.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'right:16px',
    'bottom:16px',
    'padding:10px 14px',
    'border-radius:10px',
    'background:#18181b',
    'color:#fff',
    'font:500 13px/1.4 system-ui,-apple-system,sans-serif',
    'box-shadow:0 6px 24px rgba(0,0,0,.25)',
  ].join(';');
  root.append(box);
  document.documentElement.append(host);
  setTimeout(() => host.remove(), 3000);
}
