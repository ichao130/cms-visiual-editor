import type { KvAdapter } from "@pcms/engine";
import { currentUid, getIdToken } from "./auth.js";
import { loadFirebaseConfig } from "./cloud.js";
import { NotSignedInError } from "./functions.js";

/**
 * A KvAdapter over Firebase Cloud Storage, so the encrypted-backup history
 * (KvBackupStore) has an off-machine copy. Objects live at
 * `users/{uid}/backups/{id}.json`; the Storage security rules keep them readable
 * and writable by that owner alone. Only ciphertext passes through here — the
 * store never sees the passphrase or plaintext (CLAUDE.md: クラウドには暗号文だけ).
 * We send only the Firebase ID token; no service-account key is in the app.
 */

const HOST = "https://firebasestorage.googleapis.com/v0/b";

async function connect(): Promise<{ api: string; folder: string; token: string }> {
  const config = loadFirebaseConfig();
  if (!config?.storageBucket) {
    throw new Error("Storageバケットが未設定です（firebase.config.json の storageBucket）。");
  }
  const uid = currentUid();
  const token = await getIdToken();
  if (!uid || !token) throw new NotSignedInError();
  return { api: `${HOST}/${config.storageBucket}/o`, folder: `users/${uid}/backups`, token };
}

/** The full object path for a backup key (the Firebase v0 API wants it URL-encoded). */
function objectName(folder: string, key: string): string {
  return encodeURIComponent(`${folder}/${key}.json`);
}

export function storageBackupKv(): KvAdapter {
  return {
    async get(key) {
      const { api, folder, token } = await connect();
      const res = await fetch(`${api}/${objectName(folder, key)}?alt=media`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Storageの読み取りに失敗しました（${res.status}）。`);
      return await res.text();
    },
    async set(key, value) {
      const { api, folder, token } = await connect();
      const res = await fetch(`${api}?uploadType=media&name=${objectName(folder, key)}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: value,
      });
      if (!res.ok) throw new Error(`Storageへの保存に失敗しました（${res.status}）。`);
    },
    async delete(key) {
      const { api, folder, token } = await connect();
      const res = await fetch(`${api}/${objectName(folder, key)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Storageの削除に失敗しました（${res.status}）。`);
      }
    },
    async keys() {
      const { api, folder, token } = await connect();
      const res = await fetch(`${api}?prefix=${encodeURIComponent(`${folder}/`)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Storageの一覧取得に失敗しました（${res.status}）。`);
      const data = (await res.json()) as { items?: { name: string }[] };
      const base = `${folder}/`;
      return (data.items ?? [])
        .map((i) => i.name)
        .filter((n) => n.startsWith(base) && n.endsWith(".json"))
        .map((n) => n.slice(base.length, -".json".length));
    },
  };
}
