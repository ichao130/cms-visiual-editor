import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { validateSubmission, captchaToken, type FormConfig } from "./validate.js";
import { composeAutoReply, composeNotification } from "./mail/compose.js";
import { makeMailer } from "./mail/mailer.js";
import { makeCaptchaVerifier } from "./captcha/verify.js";

/**
 * Contact-form receiver for static sites (no PHP). CLAUDE.md: 静的サイトからの送信は
 * Cloud Functions で受け取る、受信データはサイト所有者以外が読めないこと. The form
 * config lives at sites/{siteId}/forms/{formId}; submissions are written by this
 * function only, and the security rules keep them readable by the owner alone.
 */
export const submitForm = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const siteId = String(body.siteId ?? "");
  const formId = String(body.formId ?? "");
  if (!siteId || !formId) {
    res.status(400).json({ ok: false, error: "siteId/formId" });
    return;
  }

  const db = getFirestore();
  const formSnap = await db.doc(`sites/${siteId}/forms/${formId}`).get();
  if (!formSnap.exists) {
    res.status(404).json({ ok: false, error: "form" });
    return;
  }
  const config = formSnap.data() as FormConfig;

  const result = validateSubmission(body.data as Record<string, unknown>, config);

  // A bot (filled honeypot) gets a success response but nothing is stored.
  if ("spam" in result) {
    res.json({ ok: true });
    return;
  }
  if (!result.ok) {
    res.status(400).json({ ok: false, errors: result.errors });
    return;
  }

  // Real captcha verification (スパム対策) when a secret is configured; the
  // presence check above is the offline fallback. A verification failure or a
  // provider outage rejects the submission rather than letting spam through.
  const verifier = makeCaptchaVerifier();
  if (verifier && config.requireToken) {
    const token = captchaToken(body.data as Record<string, unknown>);
    const remoteIp = (req.headers["cf-connecting-ip"] as string | undefined) ?? req.ip;
    let verified = false;
    try {
      verified = (await verifier.verify(token, remoteIp)).ok;
    } catch (err) {
      console.error("captcha verify failed", err);
    }
    if (!verified) {
      res.status(400).json({ ok: false, error: "captcha" });
      return;
    }
  }

  // Store the submission unless the form is set to forward-only (保存せずメール
  // 転送だけ — CLAUDE.md privacy option).
  const stored = config.storeSubmission !== false;
  if (stored) {
    await db.collection(`sites/${siteId}/submissions`).add({
      formId,
      fields: result.fields,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  // Notification mail (複数宛先) + auto-reply (自動返信). A mail failure must not
  // fail the submission the visitor just made, so each send is best-effort.
  const siteName = (formSnap.get("siteName") as string | undefined) ?? undefined;
  const mailer = makeMailer();
  const messages = [
    composeNotification(config, result.fields, { siteName }),
    composeAutoReply(config, result.fields),
  ];
  for (const message of messages) {
    if (!message) continue;
    try {
      await mailer.send(message);
    } catch (err) {
      console.error("form mail failed", err);
    }
  }

  res.json({ ok: true, stored });
});
