import { onCall, HttpsError } from "firebase-functions/v2/https";
import { makeStatsProvider } from "./analytics/stats.js";

/**
 * Visit-stats proxy. Reads real visit numbers from the configured analytics
 * provider (GA4 Data API / MOKKEDA) so the dashboard can show them without the
 * app ever holding reporting-API credentials (CLAUDE.md). Only the siteId and
 * the window are forwarded to the provider.
 */
export const visitStats = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "ログインが必要です。");

  const data = (request.data ?? {}) as { siteId?: unknown; days?: unknown };
  const siteId = typeof data.siteId === "string" ? data.siteId.trim() : "";
  if (siteId === "") throw new HttpsError("invalid-argument", "サイトIDが必要です。");

  const requested = Number(data.days);
  const days = Number.isFinite(requested) ? Math.min(90, Math.max(1, Math.trunc(requested))) : 14;

  const provider = makeStatsProvider();
  try {
    return await provider.fetch({ siteId, days });
  } catch (err) {
    // Never leak provider/credential details to the client.
    console.error("visitStats failed", err);
    throw new HttpsError("unavailable", "アクセス数を取得できませんでした。");
  }
});
