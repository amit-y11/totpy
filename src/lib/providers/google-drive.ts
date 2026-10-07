// Sync provider backed by Google Drive's hidden appDataFolder. The
// drive.appdata scope only grants access to files this extension created;
// it cannot see the rest of the user's Drive.

import type { Envelope, SyncProvider } from '../types.ts';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'otp-vault.json';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

function isConfigured(): boolean {
  const clientId = chrome.runtime.getManifest().oauth2?.client_id ?? '';
  return clientId !== '' && !clientId.startsWith('YOUR_');
}

async function getToken(interactive: boolean): Promise<string> {
  let result: chrome.identity.GetAuthTokenResult | string | undefined;
  try {
    result = await chrome.identity.getAuthToken({ interactive, scopes: [SCOPE] });
  } catch (err) {
    if (!interactive) throw new Error('Google Drive is disconnected. Reconnect it in settings.');
    throw err;
  }
  // Older Chrome versions resolve with the token string itself.
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new Error('Google sign-in was cancelled');
  return token;
}

async function request(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getToken(false);
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && retry) {
    await chrome.identity.removeCachedAuthToken({ token });
    return request(url, init, false);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {}
    throw new Error(`Google Drive error ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res;
}

async function findFileId(): Promise<string | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${FILE_NAME}' and trashed = false`,
    fields: 'files(id)',
    orderBy: 'modifiedTime desc',
    pageSize: '1',
  });
  const { files } = (await (await request(`${API}/files?${params}`)).json()) as {
    files?: { id: string }[];
  };
  return files?.[0]?.id ?? null;
}

const googleDrive: SyncProvider = {
  id: 'google-drive',
  name: 'Google Drive',
  description:
    'Stores the encrypted vault in a hidden app folder in your Google Drive. No size limit, and Drive keeps earlier versions.',

  availability() {
    if (!chrome.identity?.getAuthToken) {
      return {
        ok: false,
        reason: 'Google sign-in for extensions is only available in Google Chrome.',
      };
    }
    if (!isConfigured()) {
      return {
        ok: false,
        reason: 'This build has no Google OAuth client ID. See docs/google-drive.md to set one up.',
      };
    }
    return { ok: true };
  },

  async connect() {
    await getToken(true);
  },

  async disconnect() {
    let token: string;
    try {
      token = await getToken(false);
    } catch {
      return;
    }
    await chrome.identity.removeCachedAuthToken({ token });
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    }).catch(() => {});
  },

  async read() {
    const id = await findFileId();
    if (!id) return null;
    return (await (await request(`${API}/files/${id}?alt=media`)).json()) as Envelope;
  },

  async write(env) {
    const body = JSON.stringify(env);
    const id = await findFileId();
    if (id) {
      await request(`${UPLOAD_API}/files/${id}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      return;
    }
    const boundary = `otpvault-${crypto.randomUUID()}`;
    const metadata = { name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' };
    const multipart = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      body,
      `--${boundary}--`,
    ].join('\r\n');
    await request(`${UPLOAD_API}/files?uploadType=multipart`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
  },

  async remove() {
    const id = await findFileId();
    if (id) await request(`${API}/files/${id}`, { method: 'DELETE' });
  },
};

export default googleDrive;
