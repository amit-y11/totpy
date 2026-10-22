# Security design

This document describes how Totpy protects your 2FA secrets. To report a vulnerability, see
[SECURITY.md](../SECURITY.md).

## Goals

- Secrets are never stored or transmitted unencrypted, except in the plain-text export the user
  explicitly asks for.
- Sync providers (Chrome sync, Google Drive) learn nothing beyond the vault's size and when it
  changes.
- A tampered sync copy or backup file cannot read secrets, weaken the encryption or lock the
  user out.
- Forgetting the master password is recoverable with the recovery code.

## Keys

```
            master password ──PBKDF2──▶ wrapping key ─┐
                                                       ├─▶ unwraps ─▶ vault secret (256-bit, random)
            recovery code ───PBKDF2──▶ wrapping key ─┘                        │
                                                                    HKDF ─────┴───── HKDF
                                                                     │                  │
                                                               data key (AES-GCM)   MAC key (HMAC)
```

| Item            | Algorithm and parameters                                                      |
| --------------- | ----------------------------------------------------------------------------- |
| Vault secret    | 32 random bytes from `crypto.getRandomValues`                                 |
| Data encryption | AES-256-GCM, 96-bit random IV per write, gzip before encryption               |
| Key separation  | HKDF-SHA-256 from the vault secret, distinct `info` for data and MAC keys     |
| Password wrap   | PBKDF2-SHA-256, 600,000 iterations, 128-bit random salt, then AES-256-GCM     |
| Recovery wrap   | PBKDF2-SHA-256, 100,000 iterations (the code itself has 160 bits of entropy)  |
| Wrap integrity  | HMAC-SHA-256 over both wraps and their timestamp, keyed from the vault secret |
| Recovery code   | 20 random bytes, shown as 32 base32 characters in groups of four              |
| Passkey wrap    | HKDF-SHA-256 from the passkey's WebAuthn PRF output, then AES-256-GCM         |

The vault secret is wrapped twice, once per credential, plus once per device that turns on passkey
unlock (see below). Changing the password re-wraps the same
secret, so the data and every synced copy stay readable on all devices.

## Envelope format

The local vault, sync copies, automatic copies and backup files all use one JSON format:

```json
{
  "format": "otp-vault",
  "version": 2,
  "keyId": "random id of the vault secret",
  "keys": {
    "password": { "kdf": { "...": "..." }, "iv": "...", "ct": "..." },
    "recovery": { "kdf": { "...": "..." }, "iv": "...", "ct": "..." },
    "updatedAt": 1791390000000,
    "mac": "HMAC over the wraps"
  },
  "iv": "...",
  "ct": "AES-GCM ciphertext of the gzip-compressed vault"
}
```

- Each wrap's AES-GCM associated data binds its purpose, the `keyId` and its KDF parameters, so
  wraps can't be swapped between vaults or have their parameters changed.
- The data ciphertext's associated data binds the format version and `keyId`.
- KDF parameters below 100,000 iterations or with salts under 128 bits are rejected, so a
  tampered file can't downgrade key derivation.

## Sync

Copies are matched by `keyId`:

- **Same vault:** the copy is decrypted with the vault secret already in memory, then merged.
  Each account carries `updatedAt`; deletions leave a tombstone (kept 180 days). The merge is
  commutative and idempotent, so devices converge regardless of order.
- **Newer password or recovery wraps** from another device are adopted only after their HMAC
  verifies. Someone who can write to the sync storage but doesn't know the vault secret can't
  forge wraps that would lock the user out.
- **Different vault** (created separately): the user must enter that vault's password to join
  it. Totpy never merges silently across vaults.

## Passkey unlock

Passkey unlock is optional and per device. It only replaces typing the master password on the
device where it was set up.

- Turning it on requires the master password, so someone using an already unlocked browser
  can't add their own passkey.
- Totpy creates a passkey (user verification required) with the WebAuthn `prf` extension and a
  random 32-byte PRF input. The authenticator turns that input into 32 secret bytes, which are
  only released after Touch ID, Windows Hello, a PIN or similar.
- Those bytes go through HKDF-SHA-256 to an AES-256-GCM key that wraps the vault secret. The
  associated data binds the `keyId` and the credential id.
- The wrap is stored in `chrome.storage.local` only. It is not part of the envelope, so it never
  reaches sync providers, automatic copies or backup files, and older versions of Totpy are
  unaffected.
- After unwrapping, the secret must decrypt the vault (including its HMAC) before Totpy treats
  itself as unlocked. A wrap for a vault this device no longer uses is ignored.
- Passkeys without PRF support are refused. Totpy never stores the vault secret in a form that
  only needs a "user verified" flag.
- Turning it off deletes the wrap. The passkey itself stays in the password manager until the
  user deletes it, but without the wrap it can't open anything.

## Unlocked state

- The master password is never stored.
- While unlocked, the vault secret is kept in `chrome.storage.session`. It is held in memory,
  is only available to the extension's own pages, and is cleared on auto-lock or when Chrome
  exits.
- All vault reads and writes are serialized with the Web Locks API across the popup, settings
  page and service worker.

## Web pages

- Totpy has no host permissions for websites and no content scripts.
- Fill and Insert use `activeTab` and `chrome.scripting` only at the moment of a user click.
  Only the six-to-eight-digit code is passed to the page; secrets never are.
- User data is only ever inserted into extension pages as text, never as HTML.

## Threat model

Totpy protects against:

- Theft of sync data or backup files (attacker needs the master password or recovery code)
- A malicious or compromised sync provider tampering with the vault
- Someone using your computer while Totpy is locked, including with passkey unlock on, as long
  as they can't pass the passkey's user verification

Totpy does not protect against:

- Malware running on your computer, or a browser profile that is already unlocked
- A weak master password combined with stolen sync data (use a long passphrase)
- Phishing sites that ask you to type a code (Totpy's site suggestions help you notice)

2FA codes are a second factor. Keeping them in the same browser as your passwords is convenient
but means one compromised device exposes both. For your most important accounts, consider a
hardware security key.
