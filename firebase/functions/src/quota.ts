/**
 * Pure AI usage-quota logic (no Firebase). CLAUDE.md: ユーザーごとの利用量を記録し、
 * 上限を超えたら止める.
 */

export interface Usage {
  count: number;
  limit: number;
}

export interface QuotaResult {
  allowed: boolean;
  remaining: number;
}

/** Default monthly AI call limit when a user has no explicit limit set. */
export const DEFAULT_AI_LIMIT = 100;

export function checkQuota(usage: Usage): QuotaResult {
  const limit = usage.limit > 0 ? usage.limit : DEFAULT_AI_LIMIT;
  return {
    allowed: usage.count < limit,
    remaining: Math.max(0, limit - usage.count),
  };
}

/** The usage bucket key for a date (per calendar month, UTC). */
export function usagePeriod(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
