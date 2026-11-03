import { describe, expect, it } from "vitest";
import {
  themeifyHtml,
  validateThemeHtml,
  draftText,
  rewriteText,
  seoSuggest,
  diagnoseThemeHtml,
  diagnoseDeployError,
  parseTemplate,
} from "../src/index.js";

describe("themeifyHtml", () => {
  const raw = `
    <section>
      <h1>ようこそ</h1>
      <p>本文です。</p>
      <img src="a.jpg" alt="">
      <a href="/next">次へ</a>
    </section>
    <section>
      <h2>二つ目</h2>
      <p>段落</p>
    </section>`;
  const out = themeifyHtml(raw);

  it("adds data-section to each section with a label", () => {
    expect(out).toContain('data-section="sec-1"');
    expect(out).toContain('data-section="sec-2"');
    expect(out).toContain('data-label="セクション1"');
  });

  it("annotates fields with inferred types", () => {
    expect(out).toContain('data-field="sec-1.f1"'); // h1
    expect(out).toMatch(/data-field="sec-1\.f3"[^>]*data-type="image"|data-type="image"[^>]*data-field="sec-1\.f3"/);
    expect(out).toContain('data-type="link"'); // the anchor
  });

  it("produces a template the parser can read back", () => {
    const schema = parseTemplate("themed", out);
    expect(schema.sections.map((s) => s.id)).toEqual(["sec-1", "sec-2"]);
    expect(schema.sections[0]!.fields.length).toBeGreaterThanOrEqual(4);
  });
});

describe("validateThemeHtml", () => {
  it("passes well-formed theme HTML", () => {
    const issues = validateThemeHtml('<section data-section="a"><h1 data-field="a.t" data-type="text">x</h1></section>');
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("flags an unknown data-type", () => {
    const issues = validateThemeHtml('<p data-field="x" data-type="bogus">x</p>');
    expect(issues.some((i) => i.level === "error" && i.message.includes("bogus"))).toBe(true);
  });

  it("warns when nothing is editable", () => {
    const issues = validateThemeHtml("<div><p>plain</p></div>");
    expect(issues.some((i) => i.level === "warning")).toBe(true);
  });
});

describe("offline AI heuristics", () => {
  it("drafts a paragraph mentioning the prompt", () => {
    expect(draftText("自家焙煎コーヒー")).toContain("自家焙煎コーヒー");
  });

  it("shortens text on request", () => {
    const out = rewriteText("<p>一文目です。二文目です。三文目です。</p>", "短くして");
    expect(out).toContain("一文目です");
    expect(out).not.toContain("三文目");
  });

  it("builds an SEO description from the body", () => {
    const { title, description } = seoSuggest("お店について", "<p>" + "あ".repeat(200) + "</p>");
    expect(title).toBe("お店について");
    expect(description.length).toBeLessThanOrEqual(120);
    expect(description.endsWith("…")).toBe(true);
  });
});

describe("diagnoseThemeHtml", () => {
  it("flags an unknown data-type with the valid types as the fix", () => {
    const d = diagnoseThemeHtml('<p data-field="x" data-type="wysiwyg" data-label="本文">x</p>');
    const hit = d.find((i) => i.message.includes("data-type"));
    expect(hit?.level).toBe("error");
    expect(hit?.fix).toContain("richtext");
  });

  it("warns when an image type is on a non-img element", () => {
    const d = diagnoseThemeHtml('<p data-field="hero.img" data-type="image">x</p>');
    const hit = d.find((i) => i.message.includes("image"));
    expect(hit?.level).toBe("warning");
    expect(hit?.fix).toContain("<img>");
  });

  it("warns on a duplicate field path within a section", () => {
    const d = diagnoseThemeHtml(
      '<section data-section="s1"><h2 data-field="s1.t">A</h2><p data-field="s1.t">B</p></section>',
    );
    expect(d.some((i) => i.message.includes("重複"))).toBe(true);
  });

  it("warns on a data-repeat with no editable field inside", () => {
    const d = diagnoseThemeHtml('<div data-repeat="items"><span>static</span></div>');
    expect(d.some((i) => i.message.includes("data-repeat"))).toBe(true);
  });

  it("warns when nothing is editable", () => {
    const d = diagnoseThemeHtml("<section><p>ただのHTML</p></section>");
    expect(d.some((i) => i.message.includes("編集できる箇所"))).toBe(true);
  });

  it("returns nothing for a clean fragment", () => {
    const d = diagnoseThemeHtml(
      '<section data-section="s1"><h2 data-field="s1.title" data-type="text">見出し</h2></section>',
    );
    expect(d).toEqual([]);
  });
});

describe("diagnoseDeployError", () => {
  it("maps an SFTP auth failure to a login diagnosis", () => {
    const d = diagnoseDeployError("Error: All configured authentication methods failed");
    expect(d.level).toBe("error");
    expect(d.message).toContain("認証");
    expect(d.fix).toContain("パスワード");
  });

  it("maps a 530 FTP response to a login diagnosis", () => {
    const d = diagnoseDeployError("530 Login incorrect");
    expect(d.message).toContain("認証");
  });

  it("maps host-not-found to a hostname diagnosis", () => {
    const d = diagnoseDeployError("getaddrinfo ENOTFOUND ftp.example.com");
    expect(d.message).toContain("ホスト");
  });

  it("maps a timeout to a timeout diagnosis", () => {
    const d = diagnoseDeployError("connect ETIMEDOUT 203.0.113.1:22");
    expect(d.message).toContain("タイムアウト");
  });

  it("maps connection-refused to a refused diagnosis", () => {
    const d = diagnoseDeployError("connect ECONNREFUSED 127.0.0.1:22");
    expect(d.message).toContain("拒否");
    expect(d.fix).toContain("ポート");
  });

  it("maps a remote permission error to a write-permission diagnosis", () => {
    const d = diagnoseDeployError("EACCES: permission denied, open '/public_html/index.html'");
    expect(d.message).toContain("権限");
    expect(d.fix).toContain("public_html");
  });

  it("maps a missing remote directory to a folder diagnosis", () => {
    const d = diagnoseDeployError("550 /wwwroot: No such file or directory");
    expect(d.message).toContain("フォルダ");
  });

  it("maps disk-full to a capacity diagnosis", () => {
    const d = diagnoseDeployError("ENOSPC: no space left on device");
    expect(d.message).toContain("空き容量");
  });

  it("maps a TLS certificate error to a certificate diagnosis", () => {
    const d = diagnoseDeployError("unable to verify the first certificate");
    expect(d.message).toContain("証明書");
  });

  it("maps the local out-of-root guard to a publish-folder diagnosis", () => {
    const d = diagnoseDeployError("パスがルート外を指しています: ../etc");
    expect(d.message).toContain("公開フォルダ");
  });

  it("maps a missing S3 bucket to a bucket diagnosis", () => {
    const d = diagnoseDeployError("NoSuchBucket: The specified bucket does not exist");
    expect(d.message).toContain("バケット");
  });

  it("maps a bad S3 access key to a credential diagnosis", () => {
    const d = diagnoseDeployError("InvalidAccessKeyId: The AWS Access Key Id you provided does not exist in our records.");
    expect(d.message).toContain("アクセスキー");
  });

  it("echoes an unrecognized message in the fallback", () => {
    const d = diagnoseDeployError("something weird happened");
    expect(d.message).toContain("something weird happened");
    expect(d.fix).not.toBe("");
  });

  it("gives a generic message for an empty error", () => {
    const d = diagnoseDeployError("");
    expect(d.message).toContain("不明なエラー");
  });
});
