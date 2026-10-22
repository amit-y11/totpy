import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VaultData } from '../src/lib/types.ts';
import {
  DecryptError,
  decryptVault,
  encryptVault,
  generateRecoveryCode,
  newVaultSecret,
  openVault,
  newPrfSalt,
  sealKeys,
  unwrapWithPasskey,
  wrapSecret,
  wrapWithPasskey,
} from '../src/lib/crypto.ts';

const data: VaultData = {
  version: 1,
  entries: [
    {
      id: '1',
      issuer: 'GitHub',
      account: 'octocat',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  tombstones: {},
};

async function makeVault(password = 'correct horse', recoveryCode = generateRecoveryCode()) {
  const { keyId, secret } = newVaultSecret();
  const keys = await sealKeys(secret, keyId, {
    password: await wrapSecret(secret, keyId, 'password', password),
    recovery: await wrapSecret(secret, keyId, 'recovery', recoveryCode),
    updatedAt: 1,
  });
  return { env: await encryptVault(secret, keyId, keys, data), secret, keyId, recoveryCode };
}

test('opens with the password or the recovery code', async () => {
  const { env, recoveryCode } = await makeVault();
  assert.ok(!JSON.stringify(env).includes('JBSWY3DP'));
  assert.deepEqual((await openVault(env, { password: 'correct horse' })).data, data);
  // Recovery codes are accepted in any case, with or without dashes.
  const sloppy = recoveryCode.toLowerCase().replaceAll('-', ' ');
  assert.deepEqual((await openVault(env, { recoveryCode: sloppy })).data, data);
});

test('recovery codes are 32 base32 characters in groups of 4', () => {
  assert.match(generateRecoveryCode(), /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
});

test('wrong password or recovery code fails', async () => {
  const { env } = await makeVault();
  await assert.rejects(openVault(env, { password: 'wrong' }), DecryptError);
  await assert.rejects(openVault(env, { recoveryCode: generateRecoveryCode() }), DecryptError);
});

test('a passkey wrap opens with the same PRF output only', async () => {
  const { secret, keyId } = newVaultSecret();
  const output = crypto.getRandomValues(new Uint8Array(32));
  const wrap = await wrapWithPasskey(secret, keyId, 'cred-1', newPrfSalt(), output);
  assert.deepEqual(await unwrapWithPasskey(wrap, output), secret);
  const other = crypto.getRandomValues(new Uint8Array(32));
  await assert.rejects(unwrapWithPasskey(wrap, other), DecryptError);
  // The wrap is bound to its vault and credential.
  await assert.rejects(unwrapWithPasskey({ ...wrap, keyId: 'other' }, output), DecryptError);
  await assert.rejects(
    unwrapWithPasskey({ ...wrap, credentialId: 'cred-2' }, output),
    DecryptError,
  );
});

test('swapping in wraps from another vault is detected', async () => {
  const a = await makeVault('a-password');
  const b = await makeVault('b-password');
  const tampered = { ...a.env, keys: { ...a.env.keys, password: b.env.keys.password } };
  await assert.rejects(decryptVault(a.secret, tampered), /tampered/);
});

test('tampering with the ciphertext or key id is detected', async () => {
  const { env, secret } = await makeVault();
  const flipped = env.ct.startsWith('A') ? `B${env.ct.slice(1)}` : `A${env.ct.slice(1)}`;
  await assert.rejects(decryptVault(secret, { ...env, ct: flipped }), DecryptError);
  await assert.rejects(
    decryptVault(secret, { ...env, keyId: 'AAAAAAAAAAAAAAAAAAAAAA==' }),
    DecryptError,
  );
});

test('refuses weak KDF parameters', async () => {
  const { env } = await makeVault();
  const weak = structuredClone(env);
  weak.keys.password.kdf.iterations = 1000;
  await assert.rejects(openVault(weak, { password: 'correct horse' }), /unsafe/);
});
