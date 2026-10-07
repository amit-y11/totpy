// Shared data shapes.

export type Bytes = Uint8Array<ArrayBuffer>;

export type Algorithm = 'SHA1' | 'SHA256' | 'SHA512';

/** The parts of an account that come from the service (otpauth:// fields). */
export interface EntryFields {
  issuer: string;
  account: string;
  /** Base32, normalized (uppercase, no spaces or padding). */
  secret: string;
  algorithm: Algorithm;
  digits: number;
  period: number;
}

export interface Entry extends EntryFields {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface VaultData {
  version: 1;
  entries: Entry[];
  /** Deleted entry id -> deletion time, so deletions sync between devices. */
  tombstones: Record<string, number>;
}

export interface KdfParams {
  name: 'PBKDF2';
  hash: 'SHA-256' | 'SHA-512';
  iterations: number;
  /** Base64. */
  salt: string;
}

/** The vault secret, encrypted with a key derived from a password or recovery code. */
export interface Wrap {
  kdf: KdfParams;
  iv: string;
  ct: string;
}

export interface VaultKeys {
  password: Wrap;
  recovery: Wrap | null;
  updatedAt: number;
  /** HMAC over the wraps, keyed from the vault secret. */
  mac: string;
}

/** Encrypted vault as stored locally, in sync providers and in backup files. */
export interface Envelope {
  format: 'otp-vault';
  version: 2;
  keyId: string;
  keys: VaultKeys;
  iv: string;
  ct: string;
}

export interface Session {
  keyId: string;
  secret: Bytes;
}

export type ProviderId = 'chrome-sync' | 'google-drive';

export interface Settings {
  autoLockMinutes: number;
  providers: Record<ProviderId, boolean>;
}

export type SyncState = 'ok' | 'error' | 'needs-password';

export interface ProviderStatus {
  state: SyncState;
  at: number;
  error?: string;
}

export type SyncStatus = Partial<Record<ProviderId, ProviderStatus | null>>;

export interface Availability {
  ok: boolean;
  reason?: string;
}

/** A place to store the encrypted envelope. Providers never see plaintext. */
export interface SyncProvider {
  id: ProviderId;
  name: string;
  description: string;
  availability(): Availability;
  /** May show UI (e.g. Google sign-in), so call it from a user action. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  read(): Promise<Envelope | null>;
  write(envelope: Envelope): Promise<void>;
  remove(): Promise<void>;
}
