// Unlock with a passkey. The passkey's PRF output (WebAuthn "prf" extension)
// wraps the vault secret. The wrap stays in this device's chrome.storage.local
// and is never synced; the master password is still needed to turn it on and
// to set up other devices.

import {
  DecryptError,
  decryptVault,
  fromBase64,
  newPrfSalt,
  toBase64,
  unwrapSecret,
  unwrapWithPasskey,
  wrapWithPasskey,
} from './crypto.ts';
import { getEnvelope, getSession, setSession } from './store.ts';
import type { Bytes, PasskeyWrap } from './types.ts';

const PASSKEY_KEY = 'passkey';

type Capabilities = Record<string, boolean>;
type WithCapabilities = typeof PublicKeyCredential & {
  getClientCapabilities?: () => Promise<Capabilities>;
};

/** Whether this browser can create PRF passkeys. Unknown counts as yes. */
export async function passkeysSupported(): Promise<boolean> {
  if (typeof PublicKeyCredential === 'undefined') return false;
  const api = PublicKeyCredential as WithCapabilities;
  const caps = await api.getClientCapabilities?.().catch(() => null);
  return caps?.['extension:prf'] ?? true;
}

/** The passkey wrap for the current vault, if this device has one. */
export async function getPasskeyWrap(): Promise<PasskeyWrap | null> {
  const [{ [PASSKEY_KEY]: raw }, env] = await Promise.all([
    chrome.storage.local.get(PASSKEY_KEY),
    getEnvelope(),
  ]);
  const wrap = raw as PasskeyWrap | undefined;
  // A wrap for a vault this device no longer uses (restored, replaced) is stale.
  return wrap && env && wrap.keyId === env.keyId ? wrap : null;
}

export function removePasskey(): Promise<void> {
  return chrome.storage.local.remove(PASSKEY_KEY);
}

function prfOutput(credential: PublicKeyCredential): Bytes | null {
  const first = credential.getClientExtensionResults().prf?.results?.first;
  if (!first) return null;
  const view = ArrayBuffer.isView(first)
    ? new Uint8Array(first.buffer, first.byteOffset, first.byteLength)
    : new Uint8Array(first);
  return new Uint8Array(view);
}

async function evaluatePrf(credentialId: Bytes, salt: Bytes): Promise<Bytes | null> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: salt } } },
    },
  })) as PublicKeyCredential | null;
  return credential ? prfOutput(credential) : null;
}

const UNSUPPORTED = new Error(
  'This passkey provider does not support unlocking. Try a different one, such as Google Password Manager, iCloud Keychain or Windows Hello. You can delete the passkey it just created.',
);

/**
 * Creates a passkey for this device and wraps the vault secret with it.
 * Asks for the master password so an unlocked browser alone can't add one.
 */
export async function enablePasskey(password: string): Promise<void> {
  const env = await getEnvelope();
  if (!env) throw new Error('No vault on this device');
  await registerPasskey(
    env.keyId,
    await unwrapSecret(env.keys.password, env.keyId, 'password', password),
  );
}

/**
 * Same, using the unlocked session. Only for onboarding, right after the
 * master password was entered to create or restore the vault.
 */
export async function enablePasskeyAfterSetup(): Promise<void> {
  const [session, env] = await Promise.all([getSession(), getEnvelope()]);
  if (!session || !env || session.keyId !== env.keyId) throw new Error('Vault is locked');
  await registerPasskey(env.keyId, session.secret);
}

async function registerPasskey(keyId: string, secret: Bytes): Promise<void> {
  const salt = newPrfSalt();
  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Totpy' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'Totpy vault',
        displayName: 'Totpy vault',
      },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      extensions: { prf: { eval: { first: salt } } },
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('No passkey was created');
  const id = new Uint8Array(credential.rawId);
  // Some authenticators (security keys) only evaluate the PRF when signing in.
  let output = prfOutput(credential);
  if (!output) {
    if (credential.getClientExtensionResults().prf?.enabled === false) throw UNSUPPORTED;
    output = await evaluatePrf(id, salt);
  }
  if (!output) throw UNSUPPORTED;
  const wrap = await wrapWithPasskey(secret, keyId, toBase64(id), salt, output);
  await chrome.storage.local.set({ [PASSKEY_KEY]: wrap });
}

export async function unlockWithPasskey(): Promise<void> {
  const [wrap, env] = await Promise.all([getPasskeyWrap(), getEnvelope()]);
  if (!wrap || !env) throw new Error('Passkey unlock is not set up on this device');
  const output = await evaluatePrf(fromBase64(wrap.credentialId), fromBase64(wrap.prfSalt));
  if (!output) throw new DecryptError('This passkey cannot unlock the vault');
  const secret = await unwrapWithPasskey(wrap, output);
  // Proves the secret opens the vault before treating it as unlocked.
  await decryptVault(secret, env);
  await setSession({ keyId: env.keyId, secret });
}
