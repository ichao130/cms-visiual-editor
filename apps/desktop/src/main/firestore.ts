import { getIdToken } from "./auth.js";
import { loadFirebaseConfig } from "./cloud.js";
import { NotSignedInError } from "./functions.js";

/**
 * Tiny Firestore REST client for the main process. The signed-in operator reads
 * and writes their own data directly — the security rules enforce ownership
 * (sites/{siteId}.ownerId == uid), so no server round-trip is needed for the
 * owner's own site/forms/submissions. We send only the Firebase ID token; no
 * service-account key ever touches the app (CLAUDE.md).
 */

type FsValue = Record<string, unknown>;

function encodeValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === "object") return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } };
  return { stringValue: String(v) };
}

function encodeFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue; // omit absent fields rather than writing null
    out[k] = encodeValue(v);
  }
  return out;
}

function decodeValue(v: FsValue): unknown {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue; // ISO 8601 string
  if ("arrayValue" in v) {
    const values = (v.arrayValue as { values?: FsValue[] } | undefined)?.values ?? [];
    return values.map(decodeValue);
  }
  if ("mapValue" in v) {
    const fields = (v.mapValue as { fields?: Record<string, FsValue> } | undefined)?.fields ?? {};
    return decodeFields(fields);
  }
  return null;
}

function decodeFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

async function connect(): Promise<{ base: string; token: string }> {
  const config = loadFirebaseConfig();
  if (!config) throw new Error("クラウド設定（firebase.config.json）が見つかりません。");
  const token = await getIdToken();
  if (!token) throw new NotSignedInError();
  const base = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
  return { base, token };
}

/** Create or replace the document at `path` with `data` (plain JSON). */
export async function patchDocument(path: string, data: Record<string, unknown>): Promise<void> {
  const { base, token } = await connect();
  const res = await fetch(`${base}/${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: encodeFields(data) }),
  });
  if (!res.ok) {
    throw new Error(`Firestoreへの書き込みに失敗しました（${res.status}）。`);
  }
}

/**
 * Run a single-field equality query over a subcollection and return the matching
 * documents (no orderBy, so no composite index is needed; callers sort in JS).
 */
export async function runQuery(
  parentPath: string,
  collectionId: string,
  field: string,
  value: unknown,
): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const { base, token } = await connect();
  const res = await fetch(`${base}/${parentPath}:runQuery`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: encodeValue(value) } },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Firestoreの読み取りに失敗しました（${res.status}）。`);
  }
  const rows = (await res.json()) as Array<{ document?: { name: string; fields?: Record<string, FsValue> } }>;
  return rows
    .filter((r) => r.document)
    .map((r) => ({
      id: r.document!.name.split("/").pop() ?? "",
      data: decodeFields(r.document!.fields ?? {}),
    }));
}
