import { useEffect, useState, type ReactNode } from "react";
import type {
  DeployConfigView,
  PcmsApi,
  PublishHistoryEntry,
  PublishIssue,
  PublishPreview,
  PublishReport,
} from "../api/types.js";
import { t } from "../i18n.js";
import { useToast } from "../state/ToastContext.js";

/**
 * The publish flow body (target config, pre-check, publish, rollback), without
 * any modal chrome. Reused inline by the site's 公開 tab and inside PublishPanel's
 * modal from the theme editor.
 */
export function PublishFlow({ api }: { api: PcmsApi }) {
  const toast = useToast();
  const [config, setConfig] = useState<DeployConfigView | null>(null);
  const [history, setHistory] = useState<PublishHistoryEntry[]>([]);
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [report, setReport] = useState<PublishReport | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "publish">("");

  const [type, setType] = useState<"local" | "sftp">("local");
  const [dir, setDir] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [remoteDir, setRemoteDir] = useState("");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);

  useEffect(() => {
    void api.getDeployConfig().then((c) => {
      setConfig(c);
      setType(c.type);
      if (c.type === "local") setDir(c.dir);
      else {
        setHost(c.host);
        setPort(String(c.port));
        setUsername(c.username);
        setRemoteDir(c.remoteDir);
        setHasPassword(c.hasPassword);
      }
    });
    void api.listPublishHistory().then(setHistory);
  }, [api]);

  const saveTarget = async () => {
    if (type === "local") await api.setDeployConfig({ type: "local", dir });
    else
      await api.setDeployConfig({
        type: "sftp",
        host,
        port: Number(port) || 22,
        username,
        remoteDir,
        password: password || undefined,
      });
    setPassword("");
    setConfig(await api.getDeployConfig());
  };

  const runPreview = async () => {
    setBusy("check");
    setReport(null);
    try {
      setPreview(await api.previewPublish());
    } finally {
      setBusy("");
    }
  };

  const runPublish = async () => {
    if (!window.confirm(t("publish.confirmRun"))) return;
    setBusy("publish");
    try {
      const r = await api.publishSite();
      setReport(r);
      setPreview(null);
      setHistory(await api.listPublishHistory());
      if (r.blocked) toast(t("publish.blocked"), "error");
      else if (r.ok) toast(t("publish.done"));
      else toast(t("publish.failed"), "error");
    } catch {
      toast(t("publish.failed"), "error");
    } finally {
      setBusy("");
    }
  };

  const rollback = async (id: string) => {
    if (!window.confirm(t("publish.rollback") + "？")) return;
    setBusy("publish");
    try {
      const r = await api.rollbackPublish(id);
      setReport(r);
      setHistory(await api.listPublishHistory());
      toast(r.ok ? t("toast.restored") : t("toast.rollbackFailed"), r.ok ? "info" : "error");
    } catch {
      toast(t("toast.rollbackFailed"), "error");
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <section className="pcms-publish__target">
        <h3 className="pcms-types__fieldshead">{t("publish.target")}</h3>
        <div className="pcms-publish__typerow">
          <label>
            <input type="radio" checked={type === "local"} onChange={() => setType("local")} />
            {t("publish.type.local")}
          </label>
          <label>
            <input type="radio" checked={type === "sftp"} onChange={() => setType("sftp")} />
            {t("publish.type.sftp")}
          </label>
        </div>

        {type === "local" ? (
          <Field label={t("publish.dir")}>
            <input value={dir} onChange={(e) => setDir(e.target.value)} />
          </Field>
        ) : (
          <>
            <Field label={t("publish.host")}>
              <input value={host} onChange={(e) => setHost(e.target.value)} />
            </Field>
            <Field label={t("publish.port")}>
              <input value={port} onChange={(e) => setPort(e.target.value)} />
            </Field>
            <Field label={t("publish.user")}>
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label={t("publish.remoteDir")}>
              <input value={remoteDir} onChange={(e) => setRemoteDir(e.target.value)} />
            </Field>
            <Field label={t("publish.password")}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={hasPassword ? t("publish.passwordKept") : ""}
              />
            </Field>
          </>
        )}
        <button type="button" onClick={saveTarget}>
          {t("publish.saveTarget")}
        </button>
      </section>

      <section className="pcms-publish__actions">
        <button type="button" onClick={runPreview} disabled={busy !== ""}>
          {busy === "check" ? t("publish.checking") : t("publish.preview")}
        </button>
        <button type="button" className="pcms-primary" onClick={runPublish} disabled={busy !== ""}>
          {busy === "publish" ? t("publish.running") : t("publish.run")}
        </button>
        {config && <span className="pcms-publish__targetlabel">{targetLabel(config)}</span>}
      </section>

      {preview && (
        <section className="pcms-publish__result">
          <p className="pcms-publish__counts">
            {t("publish.changes")}: {t("publish.willUpload")} {preview.upload} / {t("publish.willDelete")}{" "}
            {preview.delete} / {t("publish.unchanged")} {preview.unchanged}
          </p>
          {preview.deletePaths.length > 0 && (
            <PathList
              label={`${t("publish.willDelete")}（${preview.deletePaths.length}）`}
              paths={preview.deletePaths}
              danger
              open
            />
          )}
          {preview.uploadPaths.length > 0 && (
            <PathList
              label={`${t("publish.willUpload")}（${preview.uploadPaths.length}）`}
              paths={preview.uploadPaths}
            />
          )}
          <IssueList issues={preview.issues} />
        </section>
      )}

      {report && (
        <section className="pcms-publish__result">
          <p className={`pcms-publish__status${report.ok ? " is-ok" : " is-bad"}`}>
            {report.blocked
              ? t("publish.blocked")
              : report.ok
                ? `${t("publish.done")}（${t("publish.willUpload")} ${report.uploaded} / ${t("publish.willDelete")} ${report.deleted}）`
                : `${t("publish.failed")}${report.rolledBack ? " — " + t("publish.rolledBack") : ""}${report.error ? "：" + report.error : ""}`}
          </p>
          <IssueList issues={report.issues} />
        </section>
      )}

      <section className="pcms-publish__history">
        <h3 className="pcms-types__fieldshead">{t("publish.history")}</h3>
        {history.length === 0 ? (
          <p className="pcms-empty">{t("publish.noHistory")}</p>
        ) : (
          <ul>
            {history.map((h) => (
              <li key={h.id} className="pcms-publish__histitem">
                <span>
                  {new Date(h.publishedAt).toLocaleString()}（{h.fileCount}）
                </span>
                <button type="button" onClick={() => rollback(h.id)} disabled={busy !== ""}>
                  {t("publish.rollback")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="pcms-field">
      <span className="pcms-field__label">{label}</span>
      {children}
    </label>
  );
}

/** A collapsible list of output paths (the diff's upload / delete set). */
function PathList({
  label,
  paths,
  danger,
  open,
}: {
  label: string;
  paths: string[];
  danger?: boolean;
  open?: boolean;
}) {
  return (
    <details className={`pcms-publish__files${danger ? " is-delete" : ""}`} open={open}>
      <summary>{label}</summary>
      <ul className="pcms-publish__filelist">
        {paths.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </details>
  );
}

function IssueList({ issues }: { issues: PublishIssue[] }) {
  if (issues.length === 0) return <p className="pcms-empty">{t("publish.noIssues")}</p>;
  return (
    <ul className="pcms-publish__issues">
      {issues.map((i, idx) => (
        <li key={idx} className={`pcms-publish__issue is-${i.level}`}>
          [{i.level === "error" ? "エラー" : "注意"}] {i.message}
          {i.path ? `（${i.path}）` : ""}
        </li>
      ))}
    </ul>
  );
}

function targetLabel(config: DeployConfigView): string {
  return config.type === "local"
    ? `${t("publish.type.local")}: ${config.dir}`
    : `SFTP: ${config.username}@${config.host}:${config.remoteDir}`;
}
