import type { MediaUpload } from "../api/types.js";

export interface ImportOptions {
  /** Longest-edge cap in pixels; larger images are scaled down. */
  maxDim: number;
  /** WebP quality 0..1. */
  quality: number;
}

const DEFAULTS: ImportOptions = { maxDim: 1600, quality: 0.82 };

/**
 * Open a file picker and return the processed, WebP-encoded images.
 *
 * Resizing and WebP encoding run in the browser via <canvas>, so no native
 * image library is needed and the exact same code runs in the desktop renderer
 * and the dev harness. Persisting the bytes is the caller's job (window.pcms).
 */
export async function importImages(
  opts: Partial<ImportOptions> = {},
): Promise<MediaUpload[]> {
  const options = { ...DEFAULTS, ...opts };
  const files = await pickImageFiles();
  const out: MediaUpload[] = [];
  for (const file of files) {
    try {
      out.push(await processImage(file, options));
    } catch {
      // Skip files that fail to decode; a per-file error UI can come later.
    }
  }
  return out;
}

function pickImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(files);
    };

    input.addEventListener(
      "change",
      () => finish(input.files ? Array.from(input.files) : []),
      { once: true },
    );

    // If the dialog is cancelled, `change` never fires; detect the window
    // regaining focus and, shortly after, resolve to an empty selection.
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) finish([]);
      }, 350);
    };
    window.addEventListener("focus", onFocus);

    input.click();
  });
}

async function processImage(
  file: File,
  opts: ImportOptions,
): Promise<MediaUpload> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fit(bitmap.width, bitmap.height, opts.maxDim);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", opts.quality),
  );
  if (!blob) throw new Error("WebP encoding failed");

  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { fileName: toWebpName(file.name), bytes, width, height };
}

function fit(w: number, h: number, maxDim: number): { width: number; height: number } {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const scale = maxDim / Math.max(w, h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

function toWebpName(original: string): string {
  const base = original
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "image"}.webp`;
}
