import { describe, expect, it } from "vitest";
import { withTimeout } from "../src/timeout.js";

describe("withTimeout", () => {
  it("resolves when the work finishes in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "接続")).resolves.toBe(42);
  });

  it("rejects with a timeout error and runs cleanup when the work hangs", async () => {
    let cleaned = false;
    await expect(
      withTimeout(new Promise<never>(() => {}), 20, "サーバーへの接続", () => {
        cleaned = true;
      }),
    ).rejects.toThrow(/timeout/i);
    expect(cleaned).toBe(true);
  });

  it("surfaces a Japanese message for the user-facing diagnosis", async () => {
    await expect(withTimeout(new Promise<never>(() => {}), 20, "サーバーへの接続")).rejects.toThrow(
      /サーバーへの接続がタイムアウトしました/,
    );
  });

  it("waits for the work when the guard is disabled (ms <= 0)", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 0, "接続")).resolves.toBe("ok");
  });
});
