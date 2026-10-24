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
import { doc, getDoc, setDoc } from "firebase/firestore";
import { FIRESTORE_PORT, PROJECT_ID, emulatorReachable } from "./emulator.js";

const rulesPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../firestore.rules");
const up = await emulatorReachable(FIRESTORE_PORT);

// Skips when the Firestore emulator is not reachable (see emulator.ts).
describe.skipIf(!up)("firestore.rules", () => {
  let env: RulesTestEnvironment;

  const OWNER = "owner-1";
  const OTHER = "other-2";

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(rulesPath, "utf8"), host: "127.0.0.1", port: FIRESTORE_PORT },
    });
    // Seed docs the rules would otherwise block (owner site, a Functions-written
    // submission, a usage counter) with rules disabled.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "sites/site-1"), { ownerId: OWNER });
      await setDoc(doc(db, "sites/site-1/submissions/sub-1"), { formId: "f1", fields: {} });
      await setDoc(doc(db, "users/owner-1/usage/2026-10"), { count: 3, limit: 100 });
    });
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it("lets the owner read their site but not others", async () => {
    const owner = env.authenticatedContext(OWNER).firestore();
    const other = env.authenticatedContext(OTHER).firestore();
    await assertSucceeds(getDoc(doc(owner, "sites/site-1")));
    await assertFails(getDoc(doc(other, "sites/site-1")));
  });

  it("allows creating a site only with your own ownerId", async () => {
    const other = env.authenticatedContext(OTHER).firestore();
    await assertFails(setDoc(doc(other, "sites/site-2"), { ownerId: OWNER }));
    await assertSucceeds(setDoc(doc(other, "sites/site-2"), { ownerId: OTHER }));
  });

  it("keeps submissions owner-read only and never client-writable", async () => {
    const owner = env.authenticatedContext(OWNER).firestore();
    const other = env.authenticatedContext(OTHER).firestore();
    await assertSucceeds(getDoc(doc(owner, "sites/site-1/submissions/sub-1")));
    await assertFails(getDoc(doc(other, "sites/site-1/submissions/sub-1")));
    // Even the owner cannot write submissions from the client (Functions only).
    await assertFails(setDoc(doc(owner, "sites/site-1/submissions/sub-2"), { formId: "f1" }));
  });

  it("lets a user read their own usage but not write it", async () => {
    const owner = env.authenticatedContext(OWNER).firestore();
    const other = env.authenticatedContext(OTHER).firestore();
    await assertSucceeds(getDoc(doc(owner, "users/owner-1/usage/2026-10")));
    await assertFails(getDoc(doc(other, "users/owner-1/usage/2026-10")));
    await assertFails(setDoc(doc(owner, "users/owner-1/usage/2026-11"), { count: 0 }));
  });
});

if (!up) {
  // Keep the file a valid, non-empty suite when the emulator is absent.
  describe("firestore.rules (skipped)", () => {
    it.skip("requires the Firestore emulator (no JRE on this machine)", () => {
      expect(true).toBe(true);
    });
  });
}
