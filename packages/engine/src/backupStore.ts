import type { EncryptedBackup } from "./backup.js";

/**
 * Where encrypted backups live. The same interface backs the local history
 * (browser storage in the eval build, an app-data folder on the desktop) and
 * the cloud copy — a Firebase Storage adapter drops in here without the rest of
 * the app changing. CLAUDE.md: the cloud only ever holds ciphertext, so a store
 * never sees the passphrase or the plaintext — it moves opaque EncryptedBackup
 * blobs only.
 */

export interface BackupRef {
  /** Opaque id, also the storage key. Sorts chronologically. */
  id: string;
  /** ISO timestamp the backup was saved. */
  createdAt: string;
  /** Size of the stored ciphertext JSON, in bytes. */
  size: number;
}

export interface BackupStore {
  save(blob: EncryptedBackup): Promise<BackupRef>;
  list(): Promise<BackupRef[]>;
  load(id: string): Promise<EncryptedBackup>;
  remove(id: string): Promise<void>;
}

/** A tiny key/value backend, so one store works over localStorage or the fs. */
export interface KvAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

interface StoredBackup {
  createdAt: string;
  blob: EncryptedBackup;
}

/** A unique, chronologically-sortable id for a new backup. */
function newId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

/**
 * A BackupStore over any KvAdapter. Each backup is one key (`<prefix><id>`)
 * holding the ciphertext + its timestamp; listing reads the stored metadata so
 * no separate index is needed.
 */
export class KvBackupStore implements BackupStore {
  constructor(
    private readonly kv: KvAdapter,
    private readonly prefix = "pcms.backup.",
    private readonly now: () => Date = () => new Date(),
  ) {}

  private key(id: string): string {
    return `${this.prefix}${id}`;
  }

  async save(blob: EncryptedBackup): Promise<BackupRef> {
    const createdAt = this.now().toISOString();
    const id = newId(this.now());
    const payload = JSON.stringify({ createdAt, blob } satisfies StoredBackup);
    await this.kv.set(this.key(id), payload);
    return { id, createdAt, size: payload.length };
  }

  async list(): Promise<BackupRef[]> {
    const keys = (await this.kv.keys()).filter((k) => k.startsWith(this.prefix));
    const refs: BackupRef[] = [];
    for (const key of keys) {
      const raw = await this.kv.get(key);
      if (raw == null) continue;
      try {
        const parsed = JSON.parse(raw) as StoredBackup;
        refs.push({ id: key.slice(this.prefix.length), createdAt: parsed.createdAt, size: raw.length });
      } catch {
        /* skip an unreadable entry rather than failing the whole list */
      }
    }
    // Newest first.
    return refs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  async load(id: string): Promise<EncryptedBackup> {
    const raw = await this.kv.get(this.key(id));
    if (raw == null) throw new Error("バックアップが見つかりません。");
    return (JSON.parse(raw) as StoredBackup).blob;
  }

  async remove(id: string): Promise<void> {
    await this.kv.delete(this.key(id));
  }
}
