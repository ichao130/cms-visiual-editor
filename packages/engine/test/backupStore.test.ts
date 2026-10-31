import { describe, expect, it } from "vitest";
import { KvBackupStore, type KvAdapter } from "../src/backupStore.js";
import type { EncryptedBackup } from "../src/backup.js";

/** In-memory KvAdapter for tests. */
function memKv(): KvAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(k) {
      return store.get(k) ?? null;
    },
    async set(k, v) {
      store.set(k, v);
    },
    async delete(k) {
      store.delete(k);
    },
    async keys() {
      return [...store.keys()];
    },
  };
}

const blob = (ct: string): EncryptedBackup => ({
  v: 1,
  kdf: "PBKDF2-SHA256",
  iter: 1000,
  salt: "s",
  iv: "i",
  ct,
});

describe("KvBackupStore", () => {
  it("saves and loads a backup round-trip", async () => {
    const kv = memKv();
    const store = new KvBackupStore(kv);
    const ref = await store.save(blob("abc"));
    expect(ref.id).toMatch(/^\d{14}-/);
    expect(ref.size).toBeGreaterThan(0);
    expect(await store.load(ref.id)).toEqual(blob("abc"));
  });

  it("lists backups newest-first", async () => {
    const kv = memKv();
    let t = Date.parse("2026-02-01T00:00:00Z");
    const store = new KvBackupStore(kv, "pcms.backup.", () => new Date((t += 1000)));
    await store.save(blob("one"));
    await store.save(blob("two"));
    const refs = await store.list();
    expect(refs).toHaveLength(2);
    expect(refs[0]!.createdAt > refs[1]!.createdAt).toBe(true);
  });

  it("removes a backup", async () => {
    const kv = memKv();
    const store = new KvBackupStore(kv);
    const ref = await store.save(blob("x"));
    await store.remove(ref.id);
    expect(await store.list()).toEqual([]);
    await expect(store.load(ref.id)).rejects.toThrow(/見つかりません/);
  });

  it("ignores foreign keys and never sees plaintext", async () => {
    const kv = memKv();
    kv.store.set("other.key", "not a backup");
    const store = new KvBackupStore(kv);
    await store.save(blob("cipher-only"));
    const refs = await store.list();
    expect(refs).toHaveLength(1); // the foreign key is skipped
  });

  it("throws loading a missing id", async () => {
    const store = new KvBackupStore(memKv());
    await expect(store.load("nope")).rejects.toThrow(/見つかりません/);
  });
});
