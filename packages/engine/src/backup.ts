import type {
  ContentItem,
  ContentTypeDef,
  MediaItem,
  MenuItem,
  Redirect,
  SiteConfig,
  SiteSettings,
  TaxonomyDef,
} from "@pcms/shared";

/**
 * Encrypted, zero-knowledge site backup. CLAUDE.md: クラウドに置くのは暗号化
 * バックアップ、サーバー接続情報はクラウドに送らない・保存しない. The whole site
 * data (JSON + media) is serialized and encrypted with the operator's passphrase
 * BEFORE it ever leaves the machine, so the cloud only ever holds ciphertext —
 * and the deploy/connection config is deliberately never part of the payload.
 *
 * Isomorphic: uses the Web Crypto API (globalThis.crypto.subtle), which exists
 * in both Node (18+) and the browser, so no fs/electron/window dependency.
 */

/** Everything a site backup captures. Server connection info is NOT included. */
export interface BackupData {
  site: SiteConfig;
  settings: SiteSettings;
  content: ContentItem[];
  contentTypes: ContentTypeDef[];
  taxonomies: TaxonomyDef[];
  menus: Record<string, MenuItem[]>;
  redirects: Redirect[];
  /** Media including data URLs, so a restore is complete. */
  media: MediaItem[];
}

export interface BackupManifest {
  /** Schema version, for forward migration. */
  version: number;
  /** ISO timestamp the backup was taken. */
  createdAt: string;
  data: BackupData;
}

const BACKUP_VERSION = 1;

/** Build a manifest from the site data (drops nothing it is given; adds meta). */
export function buildBackup(data: BackupData, now: Date = new Date()): BackupManifest {
  return { version: BACKUP_VERSION, createdAt: now.toISOString(), data };
}

/** Parse a decrypted manifest, rejecting anything that is not a known backup. */
export function parseBackup(json: string): BackupManifest {
  const obj = JSON.parse(json) as Partial<BackupManifest>;
  if (!obj || typeof obj !== "object" || obj.version !== BACKUP_VERSION || obj.data == null) {
    throw new Error("対応していないバックアップ形式です。");
  }
  return obj as BackupManifest;
}

/* --------------------------------------------------------------- crypto */

// Minimal structural types for the Web Crypto API, so the engine needs no DOM
// lib (it must type-check isomorphically). The runtime object is the standard
// globalThis.crypto in both Node 18+ and the browser.
interface SubtleLike {
  importKey(
    format: string,
    keyData: ArrayBufferView,
    algorithm: string,
    extractable: boolean,
    usages: string[],
  ): Promise<unknown>;
  deriveKey(
    algorithm: object,
    baseKey: unknown,
    derivedKeyType: object,
    extractable: boolean,
    usages: string[],
  ): Promise<unknown>;
  encrypt(algorithm: object, key: unknown, data: ArrayBufferView): Promise<ArrayBuffer>;
  decrypt(algorithm: object, key: unknown, data: ArrayBufferView): Promise<ArrayBuffer>;
}
interface CryptoLike {
  subtle: SubtleLike;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

function getCrypto(): CryptoLike {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c?.subtle) throw new Error("この環境では暗号化を利用できません。");
  return c;
}
const subtle = (): SubtleLike => getCrypto().subtle;

const enc = new TextEncoder();
const dec = new TextDecoder();
/** PBKDF2 work factor. High enough to slow brute force on a weak passphrase. */
const ITERATIONS = 210000;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<unknown> {
  const base = await subtle().importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** The on-disk / in-cloud shape of an encrypted backup (all base64). */
export interface EncryptedBackup {
  v: number;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

/** Encrypt a plaintext backup (JSON) under a passphrase → an EncryptedBackup. */
export async function encryptBackup(plaintext: string, passphrase: string): Promise<EncryptedBackup> {
  if (passphrase === "") throw new Error("パスフレーズを入力してください。");
  const c = getCrypto();
  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const ct = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)),
  );
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ct),
  };
}

/** Decrypt an EncryptedBackup. A wrong passphrase fails the GCM auth → throws. */
export async function decryptBackup(blob: EncryptedBackup, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromB64(blob.salt), blob.iter);
  try {
    const pt = await subtle().decrypt(
      { name: "AES-GCM", iv: fromB64(blob.iv) },
      key,
      fromB64(blob.ct),
    );
    return dec.decode(pt);
  } catch {
    throw new Error("復号できませんでした。パスフレーズが正しいか確認してください。");
  }
}

/** Serialize + encrypt site data in one step. */
export async function createEncryptedBackup(
  data: BackupData,
  passphrase: string,
  now?: Date,
): Promise<EncryptedBackup> {
  return encryptBackup(JSON.stringify(buildBackup(data, now)), passphrase);
}

/** Decrypt + parse an encrypted backup back into a manifest. */
export async function openEncryptedBackup(
  blob: EncryptedBackup,
  passphrase: string,
): Promise<BackupManifest> {
  return parseBackup(await decryptBackup(blob, passphrase));
}
