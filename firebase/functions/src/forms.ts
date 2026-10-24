import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { validateSubmission, type FormConfig } from "./validate.js";

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

  await db.collection(`sites/${siteId}/submissions`).add({
    formId,
    fields: result.fields,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Notification mail / auto-reply (複数宛先・自動返信) are a later step; the
  // foundation stores the submission and the owner reads it in the app.
  res.json({ ok: true });
});
