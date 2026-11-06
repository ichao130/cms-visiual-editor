/**
 * Bounds for listing the files at a publish destination (the "server files"
 * pane). The listing is only a convenience for the operator — it must never run
 * away. A destination can hold an entire existing site (e.g. a WordPress install
 * under the account root when no remote path is set): walking all of it over FTP
 * is thousands of round trips and will never finish in a reasonable time.
 */
export const MAX_LISTING_ENTRIES = 500;
export const MAX_LISTING_DEPTH = 25;
export const LISTING_BUDGET_MS = 12000;

/**
 * Tracks whether a directory walk should keep going. A walk stops collecting and
 * descending once it has gathered `maxEntries`, gone past `maxDepth`, or run past
 * its time budget, and remembers that it was cut short so the UI can say so.
 */
export class ListingBudget {
  /** True once the walk was stopped early by any limit. */
  truncated = false;
  private readonly deadline: number;

  constructor(
    readonly maxEntries: number = MAX_LISTING_ENTRIES,
    readonly maxDepth: number = MAX_LISTING_DEPTH,
    budgetMs: number = LISTING_BUDGET_MS,
  ) {
    this.deadline = Date.now() + budgetMs;
  }

  /** True when no more entries should be collected (entry cap or time budget). */
  spent(count: number): boolean {
    if (count >= this.maxEntries || Date.now() > this.deadline) {
      this.truncated = true;
      return true;
    }
    return false;
  }

  /** True when the walk has gone deeper than allowed. */
  tooDeep(depth: number): boolean {
    if (depth > this.maxDepth) {
      this.truncated = true;
      return true;
    }
    return false;
  }
}
