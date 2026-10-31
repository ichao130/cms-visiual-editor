import { describe, expect, it } from "vitest";
import {
  buildBackup,
  createEncryptedBackup,
  decryptBackup,
  encryptBackup,
  openEncryptedBackup,
  parseBackup,
  type BackupData,
} from "../src/backup.js";

const data: BackupData = {
  site: { name: "テスト珈琲店", baseUrl: "https://example.test" },
  settings: { pages: {} },
  content: [{ type: "post", slug: "open", fields: { title: "開店しました" }, body: "<p>a</p>" }],
  contentTypes: [{ name: "post", label: "記事", fields: [] }],
  taxonomies: [],
  menus: { menu: [{ label: "ホーム", url: "/" }] },
  redirects: [],
  media: [{ path: "media/a.svg", type: "image/svg+xml", dataUrl: "data:image/svg+xml,x" }],
};

describe("buildBackup / parseBackup", () => {
  it("adds version + timestamp and round-trips the data", () => {
    const m = buildBackup(data, new Date("2026-02-01T00:00:00Z"));
    expect(m.version).toBe(1);
    expect(m.createdAt).toBe("2026-02-01T00:00:00.000Z");
    expect(parseBackup(JSON.stringify(m)).data).toEqual(data);
  });

  it("rejects a non-backup JSON", () => {
    expect(() => parseBackup(JSON.stringify({ hello: 1 }))).toThrow(/対応していない/);
    expect(() => parseBackup(JSON.stringify({ version: 99, data: {} }))).toThrow(/対応していない/);
  });
});

describe("encrypt / decrypt", () => {
  it("round-trips plaintext under the right passphrase", async () => {
    const blob = await encryptBackup("秘密のデータ", "correct horse");
    expect(blob.kdf).toBe("PBKDF2-SHA256");
    expect(blob.ct).not.toContain("秘密"); // ciphertext does not leak plaintext
    expect(await decryptBackup(blob, "correct horse")).toBe("秘密のデータ");
  });

  it("fails to decrypt with a wrong passphrase", async () => {
    const blob = await encryptBackup("x", "right");
    await expect(decryptBackup(blob, "wrong")).rejects.toThrow(/復号できませんでした/);
  });

  it("uses a fresh salt and IV each time (ciphertext differs)", async () => {
    const a = await encryptBackup("same", "pass");
    const b = await encryptBackup("same", "pass");
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("rejects an empty passphrase", async () => {
    await expect(encryptBackup("x", "")).rejects.toThrow(/パスフレーズ/);
  });
});

describe("createEncryptedBackup / openEncryptedBackup", () => {
  it("round-trips the full site data through encryption", async () => {
    const blob = await createEncryptedBackup(data, "pass-123");
    const restored = await openEncryptedBackup(blob, "pass-123");
    expect(restored.data).toEqual(data);
  });

  it("surfaces a decryption failure from the open helper", async () => {
    const blob = await createEncryptedBackup(data, "pass-123");
    await expect(openEncryptedBackup(blob, "nope")).rejects.toThrow(/復号できませんでした/);
  });
});
