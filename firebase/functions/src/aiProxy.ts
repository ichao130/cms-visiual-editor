import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { checkQuota, usagePeriod, DEFAULT_AI_LIMIT } from "./quota.js";
import { makeProvider, type AiOp, type AiRequest } from "./ai/provider.js";

const OPS: AiOp[] = ["themeify", "draft", "rewrite", "seo"];

/**
 * AI proxy. CLAUDE.md: AIの呼び出しは必ずプロキシ経由、APIキーはアプリに埋め込まない、
 * ユーザーごとの利用量を記録し上限を超えたら止める. Only the op + content args are
 * forwarded to the provider — never server connection info or form data.
 */
export const aiProxy = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "ログインが必要です。");

  const data = (request.data ?? {}) as Partial<AiRequest>;
  if (!data.op || !OPS.includes(data.op)) {
    throw new HttpsError("invalid-argument", "対応していない操作です。");
  }

  const db = getFirestore();
  const period = usagePeriod();
  const usageRef = db.doc(`users/${uid}/usage/${period}`);
  const snap = await usageRef.get();
  const count = (snap.get("count") as number | undefined) ?? 0;
  const limit = (snap.get("limit") as number | undefined) ?? DEFAULT_AI_LIMIT;

  const quota = checkQuota({ count, limit });
  if (!quota.allowed) {
    throw new HttpsError("resource-exhausted", "今月のAI利用上限に達しました。");
  }

  const provider = makeProvider();
  const result = await provider.run({ op: data.op, args: data.args ?? {} });

  await usageRef.set({ count: FieldValue.increment(1), limit }, { merge: true });

  return { result, provider: provider.name, remaining: Math.max(0, quota.remaining - 1) };
});
