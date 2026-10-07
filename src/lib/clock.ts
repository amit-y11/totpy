// Checks the computer clock, since TOTP codes are only accepted when the
// clock is within about 30 seconds of real time. It reads the Date header of
// a request to Google (no data is sent) at most every few hours.

const STORAGE_KEY = 'clockCheck';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const DRIFT_WARNING_MS = 30_000;
const TIME_URL = 'https://www.googleapis.com/generate_204';

export interface ClockCheck {
  at: number;
  /** Server time minus local time. */
  offsetMs: number;
}

export async function checkClock({ force = false } = {}): Promise<ClockCheck | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const last = (stored[STORAGE_KEY] as ClockCheck | undefined) ?? null;
  if (!force && last && Math.abs(Date.now() - last.at) < CHECK_EVERY_MS) return last;
  try {
    const sent = Date.now();
    const res = await fetch(TIME_URL, { method: 'HEAD', cache: 'no-store', credentials: 'omit' });
    const received = Date.now();
    const serverTime = Date.parse(res.headers.get('date') ?? '');
    if (Number.isNaN(serverTime)) return last;
    // The header has whole seconds, so assume the middle of that second.
    const offsetMs = serverTime + 500 - (sent + received) / 2;
    const result: ClockCheck = { at: received, offsetMs };
    await chrome.storage.local.set({ [STORAGE_KEY]: result });
    return result;
  } catch {
    return last;
  }
}

export function describeOffset(offsetMs: number): string {
  const total = Math.round(Math.abs(offsetMs) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const amount =
    minutes >= 60
      ? `${Math.round(minutes / 60)} h`
      : minutes
        ? `${minutes} min${seconds ? ` ${seconds} s` : ''}`
        : `${seconds} s`;
  // Positive offset means the local clock is behind.
  return `${amount} ${offsetMs > 0 ? 'behind' : 'ahead'}`;
}
