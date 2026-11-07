import { describe, expect, it } from "vitest";
import {
  assetContentType,
  bytesToDataUrl,
  dataUrlToBytes,
  isBinaryAsset,
} from "../src/index.js";

describe("theme asset helpers", () => {
  it("classifies binary vs text assets by extension", () => {
    expect(isBinaryAsset("assets/bg.png")).toBe(true);
    expect(isBinaryAsset("assets/hero.JPG")).toBe(true);
    expect(isBinaryAsset("assets/font.woff2")).toBe(true);
    expect(isBinaryAsset("assets/app.js")).toBe(false);
    expect(isBinaryAsset("assets/extra.css")).toBe(false);
    // SVG is XML text, not binary
    expect(isBinaryAsset("assets/logo.svg")).toBe(false);
  });

  it("maps paths to content types", () => {
    expect(assetContentType("x.png")).toBe("image/png");
    expect(assetContentType("x.jpg")).toBe("image/jpeg");
    expect(assetContentType("x.css")).toBe("text/css");
    expect(assetContentType("x.js")).toBe("text/javascript");
    expect(assetContentType("x.svg")).toBe("image/svg+xml");
    expect(assetContentType("x.unknown")).toBe("application/octet-stream");
  });

  it("round-trips bytes through a data URL", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 42]);
    const url = bytesToDataUrl(bytes, "image/png");
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect([...dataUrlToBytes(url)]).toEqual([...bytes]);
  });

  it("decodes a bare base64 string too", () => {
    const url = bytesToDataUrl(new Uint8Array([65, 66, 67]), "text/plain");
    const b64 = url.slice(url.indexOf(",") + 1);
    expect([...dataUrlToBytes(b64)]).toEqual([65, 66, 67]);
  });
});
