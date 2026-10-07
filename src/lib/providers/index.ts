// Registry of sync providers. To add one (e.g. WebDAV, Dropbox), implement
// the SyncProvider interface from ../types.ts and add it here. Providers only
// ever see the encrypted envelope.

import type { ProviderId, SyncProvider } from '../types.ts';
import chromeSync from './chrome-sync.ts';
import googleDrive from './google-drive.ts';

export const providers: SyncProvider[] = [chromeSync, googleDrive];

export function getProvider(id: ProviderId): SyncProvider {
  const provider = providers.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown sync provider: ${id}`);
  return provider;
}
