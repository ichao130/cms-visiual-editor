import { useEffect, useState, type ReactNode } from "react";
import { diagnoseDeployError } from "@pcms/engine";
import type {
  DeployConfigView,
  FtpSecurity,
  PcmsApi,
  PublishHistoryEntry,
  PublishIssue,
  PublishPreview,
  PublishReport,
  ServerBrowse,
} from "../api/types.js";
import { t } from "../i18n.js";
import { useToast } from "../state/ToastContext.js";
import { Icon } from "./Icon.js";

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
  // Force a full re-publish (upload every file, not just the diff) — for when
  // the destination changed or its listing can't be trusted.
  const [fullUpload, setFullUpload] = useState(false);

  const [type, setType] = useState<"local" | "sftp" | "ftp" | "s3">("local");
  const [dir, setDir] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [remoteDir, setRemoteDir] = useState("");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [security, setSecurity] = useState<FtpSecurity>("ftps");
  // S3 fields.
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("ap-northeast-1");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [prefix, setPrefix] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [hasSecret, setHasSecret] = useState(false);

  // File listings: local output (what a publish would send) vs. the files on
  // the destination. `serverFiles === null` means not connected (offline).
  const [localFiles, setLocalFiles] = useState<string[] | null>(null);
  const [serverFiles, setServerFiles] = useState<string[] | null>(null);
  const [serverTarget, setServerTarget] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverDetail, setServerDetail] = useState<string | null>(null);
  const [serverTruncated, setServerTruncated] = useState(false);
  const [fileBusy, setFileBusy] = useState<"" | "local" | "server">("");

  // Server folder browser: walk the server and pick the publish path, instead
  // of having to know it up front. `browseOpen` shows the panel; `browse` holds
  // the current directory level (or an error).
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browse, setBrowse] = useState<ServerBrowse | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);

  useEffect(() => {
    void api.getDeployConfig().then((c) => {
      setConfig(c);
      setType(c.type);
      if (c.type === "local") setDir(c.dir);
      else if (c.type === "s3") {
        setBucket(c.bucket);
        setRegion(c.region);
        setAccessKeyId(c.accessKeyId);
        setPrefix(c.prefix);
        setEndpoint(c.endpoint);
        setHasSecret(c.hasSecret);
      } else {
        setHost(c.host);
        setPort(String(c.port));
        setUsername(c.username);
        setRemoteDir(c.remoteDir);
        setHasPassword(c.hasPassword);
        if (c.type === "ftp") setSecurity(c.security);
      }
    });
    void api.listPublishHistory().then(setHistory);
    void api.listLocalFiles().then(setLocalFiles);
  }, [api]);

  // Switch the default port with the target type, unless the operator has typed
  // a non-default value for the other type.
  const pickType = (next: "local" | "sftp" | "ftp" | "s3") => {
    if (next !== type) {
      // The pre-check / publish result and the fetched server listing belong to
      // the previously selected target, so clear them when switching — otherwise
      // a stale「公開しました」, diff or file list follows the operator onto a
      // different destination (confusing).
      setReport(null);
      setPreview(null);
      setServerFiles(null);
      setServerError(null);
      setServerDetail(null);
      setServerTruncated(false);
      setServerTarget("");
      setBrowseOpen(false);
      setBrowse(null);
    }
    if (next === "sftp" && (port === "" || port === "21" || port === "990")) setPort("22");
    if (next === "ftp" && (port === "" || port === "22")) {
      setPort(security === "ftps-implicit" ? "990" : "21");
    }
    setType(next);
  };

  const saveTarget = async () => {
    if (type === "local") await api.setDeployConfig({ type: "local", dir });
    else if (type === "s3") {
      await api.setDeployConfig({
        type: "s3",
        bucket,
        region,
        accessKeyId,
        prefix: prefix || undefined,
        endpoint: endpoint || undefined,
        secretAccessKey: secret || undefined,
      });
      setSecret("");
      setConfig(await api.getDeployConfig());
      return;
    } else if (type === "ftp")
      await api.setDeployConfig({
        type: "ftp",
        host,
        port: Number(port) || undefined,
        username,
        remoteDir,
        security,
        password: password || undefined,
      });
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
      const p = await api.previewPublish(fullUpload);
      setPreview(p);
      if (p.error) toast(t("publish.failed"), "error");
      else toast(t("publish.checkDone"));
    } catch (err) {
      // Shouldn't happen (main returns errors in-band), but never let a failed
      // check crash the screen — surface it like any other publish error.
      setPreview({
        issues: [],
        upload: 0,
        delete: 0,
        unchanged: 0,
        uploadPaths: [],
        deletePaths: [],
        target: "",
        error: err instanceof Error ? err.message : String(err),
      });
      toast(t("publish.failed"), "error");
    } finally {
      setBusy("");
    }
  };

  const runPublish = async () => {
    if (!window.confirm(t("publish.confirmRun"))) return;
    // Decide whether to force a full upload. The explicit checkbox always wins.
    // Otherwise, if the most recent pre-check could not read the destination
    // (serverListed === false), the diff may be missing files that aren't on the
    // server — ask whether to upload everything (the operator's described flow).
    let full = fullUpload;
    if (!full && preview && preview.serverListed === false) {
      full = window.confirm(t("publish.fullUploadAsk"));
    }
    setBusy("publish");
    try {
      const r = await api.publishSite(full);
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

  const refreshLocal = async () => {
    setFileBusy("local");
    try {
      setLocalFiles(await api.listLocalFiles());
    } finally {
      setFileBusy("");
    }
  };

  const connectServer = async () => {
    setFileBusy("server");
    setServerError(null);
    setServerDetail(null);
    setServerTruncated(false);
    try {
      const r = await api.listServerFiles();
      setServerTarget(r.target);
      if (r.error) {
        setServerError(r.error);
        setServerDetail(r.detail ?? null);
        setServerFiles(null);
      } else {
        setServerFiles(r.files);
        setServerTruncated(r.truncated ?? false);
      }
    } finally {
      setFileBusy("");
    }
  };

  const disconnectServer = () => {
    setServerFiles(null);
    setServerError(null);
    setServerDetail(null);
    setServerTruncated(false);
  };

  const closeBrowser = () => {
    setBrowseOpen(false);
    setBrowse(null);
  };

  const browseTo = async (path: string) => {
    setBrowseBusy(true);
    try {
      setBrowse(await api.browseServer(path));
    } finally {
      setBrowseBusy(false);
    }
  };

  // Open the folder browser. Save the target first so the typed host / password
  // are persisted (the browse connects with the saved details, which stay on
  // this machine — CLAUDE.md), then list the login directory ("").
  const openBrowser = async () => {
    setBrowseOpen(true);
    setBrowse(null);
    setBrowseBusy(true);
    try {
      await saveTarget();
      setBrowse(await api.browseServer(""));
    } finally {
      setBrowseBusy(false);
    }
  };

  // "このフォルダに公開する": adopt the browsed path as the remote dir and save
  // it, so the choice sticks without a second trip to 公開先を保存.
  const chooseHere = async () => {
    if (!browse?.path) return;
    setRemoteDir(browse.path);
    const input =
      type === "ftp"
        ? ({ type: "ftp", host, port: Number(port) || undefined, username, remoteDir: browse.path, security, password: password || undefined } as const)
        : ({ type: "sftp", host, port: Number(port) || 22, username, remoteDir: browse.path, password: password || undefined } as const);
    await api.setDeployConfig(input);
    setPassword("");
    setConfig(await api.getDeployConfig());
    closeBrowser();
    // The previously fetched server listing was for the old path — drop it so
    // it doesn't look like it belongs to the newly chosen folder.
    setServerFiles(null);
    setServerTruncated(false);
    toast(t("publish.browse.picked"));
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
            <input type="radio" checked={type === "local"} onChange={() => pickType("local")} />
            {t("publish.type.local")}
          </label>
          <label>
            <input type="radio" checked={type === "ftp"} onChange={() => pickType("ftp")} />
            {t("publish.type.ftp")}
          </label>
          <label>
            <input type="radio" checked={type === "sftp"} onChange={() => pickType("sftp")} />
            {t("publish.type.sftp")}
          </label>
          <label>
            <input type="radio" checked={type === "s3"} onChange={() => pickType("s3")} />
            {t("publish.type.s3")}
          </label>
        </div>

        {type === "local" ? (
          <Field label={t("publish.dir")}>
            <input value={dir} onChange={(e) => setDir(e.target.value)} />
          </Field>
        ) : type === "s3" ? (
          <>
            <Field label={t("publish.s3.bucket")}>
              <input value={bucket} onChange={(e) => setBucket(e.target.value)} />
            </Field>
            <Field label={t("publish.s3.region")}>
              <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="ap-northeast-1" />
            </Field>
            <Field label={t("publish.s3.accessKeyId")}>
              <input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} />
            </Field>
            <Field label={t("publish.s3.secretKey")}>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={hasSecret ? t("publish.s3.secretKept") : ""}
              />
            </Field>
            <Field label={t("publish.s3.prefix")}>
              <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="（任意）" />
            </Field>
            <Field label={t("publish.s3.endpoint")}>
              <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="（任意：R2/MinIO など）" />
            </Field>
            <p className="pcms-publish__hint">{t("publish.s3.hint")}</p>
          </>
        ) : (
          <>
            {type === "ftp" && (
              <Field label={t("publish.security")}>
                <select
                  value={security}
                  onChange={(e) => {
                    const next = e.target.value as FtpSecurity;
                    setSecurity(next);
                    if (port === "" || port === "21" || port === "990") {
                      setPort(next === "ftps-implicit" ? "990" : "21");
                    }
                  }}
                >
                  <option value="ftps">{t("publish.security.ftps")}</option>
                  <option value="ftps-implicit">{t("publish.security.ftpsImplicit")}</option>
                  <option value="ftp">{t("publish.security.ftp")}</option>
                </select>
              </Field>
            )}
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
              <input
                value={remoteDir}
                onChange={(e) => setRemoteDir(e.target.value)}
                placeholder="例: /example.com/public_html/"
              />
            </Field>
            <button
              type="button"
              className="pcms-publish__browsebtn"
              onClick={openBrowser}
              disabled={browseBusy || host.trim() === ""}
            >
              <Icon name="folder" size={14} />
              {t("publish.remoteDirBrowse")}
            </button>
            {remoteDir.trim() === "" && (
              <p className="pcms-publish__hint">{t("publish.remoteDirEmptyWarn")}</p>
            )}
            {browseOpen && (
              <ServerBrowser
                browse={browse}
                busy={browseBusy}
                onUp={() => browse?.parent != null && void browseTo(browse.parent)}
                onEnter={(p) => void browseTo(p)}
                onChoose={() => void chooseHere()}
                onClose={closeBrowser}
              />
            )}
            <Field label={t("publish.password")}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={hasPassword ? t("publish.passwordKept") : ""}
              />
            </Field>
            {type === "ftp" && security === "ftp" && (
              <p className="pcms-publish__hint">{t("publish.ftpPlainWarn")}</p>
            )}
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
        <label className="pcms-publish__fulltoggle" title={t("publish.fullUploadHint")}>
          <input
            type="checkbox"
            checked={fullUpload}
            onChange={(e) => setFullUpload(e.target.checked)}
            disabled={busy !== ""}
          />
          {t("publish.fullUpload")}
        </label>
        {config && <span className="pcms-publish__targetlabel">{targetLabel(config)}</span>}
      </section>

      {preview && (
        <section className="pcms-publish__result">
          {preview.error ? (
            <DeployErrorDiagnosis message={preview.error} />
          ) : (
            <>
              <p className="pcms-publish__counts">
                {t("publish.changes")}: {t("publish.willUpload")} {preview.upload} /{" "}
                {t("publish.willDelete")} {preview.delete} / {t("publish.unchanged")}{" "}
                {preview.unchanged}
              </p>
              {preview.serverListed === false && (
                <p className="pcms-filebrowser__warn" role="status">
                  {t("publish.serverUnknownWarn")}
                </p>
              )}
              {(preview.deletePaths ?? []).length > 0 && (
                <PathList
                  label={`${t("publish.willDelete")}（${preview.deletePaths.length}）`}
                  paths={preview.deletePaths}
                  danger
                  open
                />
              )}
              {(preview.uploadPaths ?? []).length > 0 && (
                <PathList
                  label={`${t("publish.willUpload")}（${preview.uploadPaths.length}）`}
                  paths={preview.uploadPaths}
                />
              )}
              <IssueList issues={preview.issues} />
            </>
          )}
        </section>
      )}

      {report && (
        <section className="pcms-publish__result">
          <p className={`pcms-publish__status${report.ok ? " is-ok" : " is-bad"}`}>
            {report.blocked
              ? t("publish.blocked")
              : report.ok
                ? `${t("publish.done")}（${t("publish.willUpload")} ${report.uploaded} / ${t("publish.willDelete")} ${report.deleted}）`
                : `${t("publish.failed")}${report.rolledBack ? " — " + t("publish.rolledBack") : ""}`}
          </p>
          {!report.ok && !report.blocked && report.error && <DeployErrorDiagnosis message={report.error} />}
          <IssueList issues={report.issues} />
        </section>
      )}

      <section className="pcms-publish__filebrowser">
        <h3 className="pcms-types__fieldshead">{t("publish.files.title")}</h3>
        <p className="pcms-filebrowser__hint">{t("publish.files.hint")}</p>
        <div className="pcms-filebrowser">
          <div className="pcms-filebrowser__pane">
            <div className="pcms-filebrowser__head">
              <span className="pcms-filebrowser__title">
                <Icon name="folder" size={15} />
                {t("publish.files.local")}
                {localFiles && <span className="pcms-filebrowser__count">（{localFiles.length}）</span>}
              </span>
              <button type="button" onClick={refreshLocal} disabled={fileBusy !== ""}>
                {t("publish.files.refresh")}
              </button>
            </div>
            <FileColumn files={localFiles} other={serverFiles} markClass="is-new" />
          </div>

          <div className="pcms-filebrowser__pane">
            <div className="pcms-filebrowser__head">
              <span className="pcms-filebrowser__title">
                <Icon name="publish" size={15} />
                {t("publish.files.server")}
                {serverFiles && <span className="pcms-filebrowser__count">（{serverFiles.length}）</span>}
              </span>
              {serverFiles === null ? (
                <button
                  type="button"
                  className="pcms-primary"
                  onClick={connectServer}
                  disabled={fileBusy !== ""}
                >
                  {fileBusy === "server" ? t("publish.files.loading") : t("publish.files.connect")}
                </button>
              ) : (
                <button type="button" onClick={disconnectServer} disabled={fileBusy !== ""}>
                  {t("publish.files.disconnect")}
                </button>
              )}
            </div>
            {serverTarget && <p className="pcms-filebrowser__target">{serverTarget}</p>}
            {serverError ? (
              <DeployErrorDiagnosis message={serverError} detail={serverDetail} />
            ) : serverFiles === null ? (
              <p className="pcms-empty">{t("publish.files.offline")}</p>
            ) : (
              <>
                {serverTruncated && (
                  <p className="pcms-filebrowser__warn" role="status">
                    {t("publish.files.truncated")}
                  </p>
                )}
                <FileColumn files={serverFiles} other={localFiles} markClass="is-orphan" />
              </>
            )}
          </div>
        </div>
      </section>

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

/**
 * One side of the file browser: a scrollable list of paths. Paths that are not
 * present on the other side are flagged (`markClass`) — on the local side these
 * are files not yet on the server (will upload); on the server side they are
 * files not in the current output (orphans this app did not place).
 */
function FileColumn({
  files,
  other,
  markClass,
}: {
  files: string[] | null;
  other: string[] | null;
  markClass: string;
}) {
  if (files === null) return <p className="pcms-empty">{t("publish.files.loading")}</p>;
  if (files.length === 0) return <p className="pcms-empty">{t("publish.files.empty")}</p>;
  const otherSet = other ? new Set(other) : null;
  return (
    <ul className="pcms-filebrowser__list">
      {files.map((p) => (
        <li
          key={p}
          className={`pcms-filebrowser__item${otherSet && !otherSet.has(p) ? " " + markClass : ""}`}
        >
          {p}
        </li>
      ))}
    </ul>
  );
}

/** Join an absolute posix dir with a child name (root-safe). */
function joinPath(base: string, name: string): string {
  return base.replace(/\/+$/, "") + "/" + name;
}

/**
 * The server folder browser: walk the destination one directory at a time and
 * pick where the site is published, the way a desktop FTP client does — so the
 * operator doesn't have to know the remote path up front. Navigation is by
 * absolute path; files are shown (greyed) only for recognition ("ここだ！").
 */
function ServerBrowser({
  browse,
  busy,
  onUp,
  onEnter,
  onChoose,
  onClose,
}: {
  browse: ServerBrowse | null;
  busy: boolean;
  onUp: () => void;
  onEnter: (path: string) => void;
  onChoose: () => void;
  onClose: () => void;
}) {
  return (
    <section className="pcms-serverbrowse" role="group" aria-label={t("publish.browse.title")}>
      <div className="pcms-serverbrowse__head">
        <span className="pcms-serverbrowse__title">
          <Icon name="folder" size={15} />
          {t("publish.browse.title")}
        </span>
        <button type="button" onClick={onClose}>
          {t("publish.browse.cancel")}
        </button>
      </div>
      <p className="pcms-filebrowser__hint">{t("publish.browse.hint")}</p>
      {browse?.error ? (
        <DeployErrorDiagnosis message={browse.error} detail={browse.detail} />
      ) : (
        <>
          <div className="pcms-serverbrowse__path">
            <button type="button" onClick={onUp} disabled={busy || !browse?.parent}>
              <Icon name="chevron-up" size={14} />
              {t("publish.browse.up")}
            </button>
            <code className="pcms-serverbrowse__cwd">{browse?.path || "…"}</code>
          </div>
          <ul className="pcms-serverbrowse__list">
            {busy ? (
              <li className="pcms-empty">{t("publish.browse.loading")}</li>
            ) : !browse || browse.entries.length === 0 ? (
              <li className="pcms-empty">{t("publish.browse.empty")}</li>
            ) : (
              browse.entries.map((e) =>
                e.isDirectory ? (
                  <li key={e.name} className="pcms-serverbrowse__item is-dir">
                    <button type="button" onClick={() => onEnter(joinPath(browse.path, e.name))}>
                      <Icon name="folder" size={15} />
                      <span>{e.name}</span>
                    </button>
                  </li>
                ) : (
                  <li key={e.name} className="pcms-serverbrowse__item is-file">
                    <span>{e.name}</span>
                  </li>
                ),
              )
            )}
            {browse?.truncated && (
              <li className="pcms-filebrowser__warn" role="status">
                {t("publish.browse.truncated")}
              </li>
            )}
          </ul>
          <div className="pcms-serverbrowse__foot">
            <span className="pcms-serverbrowse__current">
              {t("publish.browse.selected")}
              <code>{browse?.path || "…"}</code>
            </span>
            <button
              type="button"
              className="pcms-primary"
              onClick={onChoose}
              disabled={busy || !browse?.path}
            >
              {t("publish.browse.here")}
            </button>
          </div>
        </>
      )}
    </section>
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

/**
 * Plain-Japanese diagnosis of a failed publish: what went wrong and how to fix
 * it, derived from the raw transport error. The raw message is kept in a
 * collapsible for support. CLAUDE.md phase 6: エラー診断.
 */
function DeployErrorDiagnosis({ message, detail }: { message: string; detail?: string | null }) {
  const d = diagnoseDeployError(message);
  // Diagnosis is derived from `message` only; `detail` (e.g. the FTP dialogue)
  // is shown verbatim in the technical detail without affecting the friendly text.
  const raw = detail ? `${message}\n\n--- 通信ログ ---\n${detail}` : message;
  return (
    <div className="pcms-publish__diagnosis" role="alert">
      <p className="pcms-publish__diagmsg">{d.message}</p>
      <p className="pcms-publish__diagfix">
        <span className="pcms-publish__diaglabel">{t("publish.diagFix")}</span>
        {d.fix}
      </p>
      <details className="pcms-publish__diagraw">
        <summary>{t("publish.diagDetail")}</summary>
        <pre>{raw}</pre>
      </details>
    </div>
  );
}

function IssueList({ issues }: { issues: PublishIssue[] }) {
  if (issues.length === 0) return <p className="pcms-empty">{t("publish.noIssues")}</p>;
  return (
    <ul className="pcms-publish__issues">
      {issues.map((i, idx) => (
        <li key={idx} className={`pcms-publish__issue is-${i.level}`}>
          [{i.level === "error" ? t("issue.error") : t("issue.warning")}] {i.message}
          {i.path ? `（${i.path}）` : ""}
        </li>
      ))}
    </ul>
  );
}

function targetLabel(config: DeployConfigView): string {
  if (config.type === "local") return `${t("publish.type.local")}: ${config.dir}`;
  if (config.type === "s3") {
    const where = config.prefix ? `${config.bucket}/${config.prefix}` : config.bucket;
    return `S3: ${where}（${config.region}）`;
  }
  const proto =
    config.type === "sftp" ? "SFTP" : config.security === "ftp" ? "FTP" : "FTPS";
  return `${proto}: ${config.username}@${config.host}:${config.remoteDir}`;
}
