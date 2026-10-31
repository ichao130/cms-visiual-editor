import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { getBytes, ref, uploadString } from "firebase/storage";
import { PROJECT_ID, STORAGE_PORT, emulatorReachable } from "./emulator.js";

const rulesPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../storage.rules");
const up = await emulatorReachable(STORAGE_PORT);

// Skips when the Storage emulator is not reachable (see emulator.ts).
describe.skipIf(!up)("storage.rules", () => {
  let env: RulesTestEnvironment;

  const OWNER = "owner-1";
  const OTHER = "other-2";

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      storage: { rules: readFileSync(rulesPath, "utf8"), host: "127.0.0.1", port: STORAGE_PORT },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), "users/owner-1/backup.enc"), "seed");
    });
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it("lets a user read and write only under their own uid", async () => {
    const owner = env.authenticatedContext(OWNER).storage();
    await assertSucceeds(uploadString(ref(owner, "users/owner-1/media.webp"), "x"));
    await assertSucceeds(getBytes(ref(owner, "users/owner-1/backup.enc")));
    // The backup store writes nested paths (users/{uid}/backups/<id>.json) —
    // the {allPaths=**} glob must cover those too.
    await assertSucceeds(
      uploadString(ref(owner, "users/owner-1/backups/20260101120000-abc.json"), "{}"),
    );
  });

  it("blocks access to another user's files", async () => {
    const other = env.authenticatedContext(OTHER).storage();
    await assertFails(getBytes(ref(other, "users/owner-1/backup.enc")));
    await assertFails(uploadString(ref(other, "users/owner-1/evil.txt"), "x"));
    // Another user cannot read someone's encrypted backups either.
    await assertFails(getBytes(ref(other, "users/owner-1/backups/20260101120000-abc.json")));
  });

  it("blocks unauthenticated access", async () => {
    const anon = env.unauthenticatedContext().storage();
    await assertFails(getBytes(ref(anon, "users/owner-1/backup.enc")));
  });
});

if (!up) {
  describe("storage.rules (skipped)", () => {
    it.skip("requires the Storage emulator (no JRE on this machine)", () => {
      expect(true).toBe(true);
    });
  });
}
