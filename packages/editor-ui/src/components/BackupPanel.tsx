import { useEffect, useRef, useState } from "react";
import type { BackupRef, EncryptedBackup } from "@pcms/engine";
import { useSiteWorkspace } from "../state/SiteWorkspace.js";
import { useToast } from "../state/ToastContext.js";
import { t } from "../i18n.js";

/**
 * Encrypted backup / restore. The passphrase encrypts all site data on this
 * machine before anything is written out, so a backup file (or, later, the
 * cloud copy) is ciphertext only. Server connection info is never part of a
 * backup (CLAUDE.md).
 */
export function BackupPanel() {
  const { api } = useSiteWorkspace();
  const toast = useToast();
  const [pass, setPass] = useState("");
  const [restorePass, setRestorePass] = useState("");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<BackupRef[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshList = () => {
    void api.listBackups().then(setList).catch(() => setList([]));
  };
  useEffect(refreshList, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveToStore = async () => {
    if (pass.trim() === "") {
      toast(t("backup.needPass"), "error");
      return;
    }
    setBusy(true);
    try {
      await api.uploadBackup(pass);
      toast(t("backup.saved"));
      setPass("");
      refreshList();
    } catch (e) {
      toast((e as Error).message || t("backup.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const restoreStored = async (ref: BackupRef) => {
    const phrase = window.prompt(t("backup.passphrase"));
    if (phrase == null || phrase.trim() === "") return;
    if (!window.confirm(t("backup.restoreConfirm"))) return;
    setBusy(true);
    try {
      await api.restoreFromBackup(ref.id, phrase);
      toast(t("backup.restored"));
      window.setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      toast((e as Error).message || t("backup.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const removeStored = async (ref: BackupRef) => {
    if (!window.confirm(t("backup.deleteConfirm"))) return;
    try {
      await api.deleteBackup(ref.id);
      refreshList();
    } catch (e) {
      toast((e as Error).message || t("backup.failed"), "error");
    }
  };

  const create = async () => {
    if (pass.trim() === "") {
      toast(t("backup.needPass"), "error");
      return;
    }
    setBusy(true);
    try {
      const blob = await api.createBackup(pass);
      const text = JSON.stringify(blob);
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `kumito-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${t("backup.created")}（${Math.ceil(text.length / 1024)}KB）`);
      setPass("");
    } catch (e) {
      toast((e as Error).message || t("backup.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast(t("backup.pickFile"), "error");
      return;
    }
    if (restorePass.trim() === "") {
      toast(t("backup.needPass"), "error");
      return;
    }
    if (!window.confirm(t("backup.restoreConfirm"))) return;
    setBusy(true);
    try {
      const blob = JSON.parse(await file.text()) as EncryptedBackup;
      await api.restoreBackup(blob, restorePass);
      toast(t("backup.restored"));
      window.setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      toast((e as Error).message || t("backup.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pcms-backup">
      <h3 className="pcms-types__fieldshead">{t("backup.title")}</h3>
      <p className="pcms-field__hint">{t("backup.hint")}</p>

      <div className="pcms-backup__row">
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder={t("backup.passphrase")}
          aria-label={t("backup.passphrase")}
        />
        <button type="button" onClick={create} disabled={busy}>
          {t("backup.create")}
        </button>
        <button type="button" onClick={saveToStore} disabled={busy}>
          {t("backup.save")}
        </button>
      </div>

      {list.length > 0 && (
        <div className="pcms-backup__list">
          <h4 className="pcms-backup__listhead">{t("backup.history")}</h4>
          <ul>
            {list.map((ref) => (
              <li key={ref.id} className="pcms-backup__item">
                <span className="pcms-backup__when">
                  {new Date(ref.createdAt).toLocaleString()}（{Math.ceil(ref.size / 1024)}KB）
                </span>
                <span className="pcms-backup__itemactions">
                  <button type="button" onClick={() => restoreStored(ref)} disabled={busy}>
                    {t("backup.restore")}
                  </button>
                  <button
                    type="button"
                    className="pcms-danger"
                    onClick={() => removeStored(ref)}
                    disabled={busy}
                  >
                    {t("content.delete")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pcms-backup__row">
        <input ref={fileRef} type="file" accept="application/json,.json" aria-label={t("backup.restoreFile")} />
        <input
          type="password"
          value={restorePass}
          onChange={(e) => setRestorePass(e.target.value)}
          placeholder={t("backup.passphrase")}
          aria-label={t("backup.passphrase")}
        />
        <button type="button" onClick={restore} disabled={busy}>
          {t("backup.restore")}
        </button>
      </div>
    </section>
  );
}
