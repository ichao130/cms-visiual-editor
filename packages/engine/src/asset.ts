/**
 * Theme-asset helpers shared by the editor (mock) and the desktop main process.
 *
 * Operator-added theme assets (images, fonts, and any file dropped into the
 * theme `assets/` directory) live in the string-only theme working copy, so
 * binary assets are stored as `data:` URL strings. These helpers classify a
 * path and convert between bytes and data URLs. Pure and isomorphic — they use
 * only the global `atob`/`btoa`, available in both Node and the browser.
 */

const BINARY_EXT: Record<string, string> = {
  // images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  // fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
};

const TEXT_CONTENT_TYPE: Record<string, string> = {
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  html: "text/html",
  htm: "text/html",
  json: "application/json",
  svg: "image/svg+xml",
  txt: "text/plain",
  xml: "application/xml",
  webmanifest: "application/manifest+json",
};

function ext(path: string): string {
  const i = path.lastIndexOf(".");
  return i < 0 ? "" : path.slice(i + 1).toLowerCase();
}

/**
 * Whether a theme-asset path holds binary data (image/font) that must be stored
 * as a data URL rather than text. SVG is treated as text (it is XML).
 */
export function isBinaryAsset(path: string): boolean {
  return ext(path) in BINARY_EXT;
}

/** A reasonable Content-Type for an asset path (for data URLs / serving). */
export function assetContentType(path: string): string {
  const e = ext(path);
  return BINARY_EXT[e] ?? TEXT_CONTENT_TYPE[e] ?? "application/octet-stream";
}

/** Encode bytes as a `data:<type>;base64,…` URL. */
export function bytesToDataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

/** Decode a `data:…;base64,…` URL (or a bare base64 string) back to bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 && dataUrl.startsWith("data:") ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
