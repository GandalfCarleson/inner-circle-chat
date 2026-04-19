import sodium from "libsodium-wrappers";
import { openDB, type IDBPDatabase } from "idb";

let ready: Promise<void> | null = null;
export function initCrypto() {
  if (!ready) ready = sodium.ready.then(() => undefined);
  return ready;
}

const DB_NAME = "halo-keys";
const STORE = "keys";

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    },
  });
}

export async function generateKeypair() {
  await initCrypto();
  const kp = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    privateKey: sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL),
  };
}

export async function storePrivateKey(userId: string, privateKey: string) {
  const d = await db();
  await d.put(STORE, privateKey, `priv:${userId}`);
}

export async function getPrivateKey(userId: string): Promise<string | null> {
  const d = await db();
  const v = await d.get(STORE, `priv:${userId}`);
  return v ?? null;
}

export async function clearKeys(userId: string) {
  const d = await db();
  await d.delete(STORE, `priv:${userId}`);
}

/**
 * Encrypt a message for multiple recipients using sealed-box per recipient
 * for the symmetric key, plus a single secretbox payload.
 *
 * Returns: { ciphertext, nonce, recipientKeys: { userId: encryptedSymKey } }
 */
export async function encryptForRecipients(
  plaintext: Uint8Array | string,
  recipients: { userId: string; publicKey: string }[],
) {
  await initCrypto();
  const data = typeof plaintext === "string" ? sodium.from_string(plaintext) : plaintext;
  const symKey = sodium.crypto_secretbox_keygen();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(data, nonce, symKey);

  const recipientKeys: Record<string, string> = {};
  for (const r of recipients) {
    const pub = sodium.from_base64(r.publicKey, sodium.base64_variants.ORIGINAL);
    const sealed = sodium.crypto_box_seal(symKey, pub);
    recipientKeys[r.userId] = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
  }
  return {
    ciphertext: sodium.to_base64(ct, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
    recipientKeys,
  };
}

export async function decryptForMe(
  ciphertextB64: string,
  nonceB64: string,
  encryptedSymKeyB64: string,
  myPublicKey: string,
  myPrivateKey: string,
): Promise<Uint8Array | null> {
  await initCrypto();
  try {
    const sealed = sodium.from_base64(encryptedSymKeyB64, sodium.base64_variants.ORIGINAL);
    const pub = sodium.from_base64(myPublicKey, sodium.base64_variants.ORIGINAL);
    const priv = sodium.from_base64(myPrivateKey, sodium.base64_variants.ORIGINAL);
    const symKey = sodium.crypto_box_seal_open(sealed, pub, priv);
    const ct = sodium.from_base64(ciphertextB64, sodium.base64_variants.ORIGINAL);
    const nonce = sodium.from_base64(nonceB64, sodium.base64_variants.ORIGINAL);
    return sodium.crypto_secretbox_open_easy(ct, nonce, symKey);
  } catch {
    return null;
  }
}

export async function decryptText(
  ct: string,
  nonce: string,
  encSym: string,
  pub: string,
  priv: string,
): Promise<string | null> {
  const buf = await decryptForMe(ct, nonce, encSym, pub, priv);
  if (!buf) return null;
  return sodium.to_string(buf);
}

export function bytesToBlob(bytes: Uint8Array, mime: string): Blob {
  // Copy into a fresh ArrayBuffer slice to satisfy Blob's BlobPart typing
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Blob([ab], { type: mime });
}

export async function fileToBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
