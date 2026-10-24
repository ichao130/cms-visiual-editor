import { useCallback, useEffect, useState } from "react";
import type { PcmsApi, ThemeFileNode } from "../../api/types.js";
import { CodeEditor } from "../../components/CodeEditor.js";
import { t } from "../../i18n.js";

interface Props {
  api: PcmsApi;
}

const NEW_PART_TEMPLATE = (name: string) =>
  `<section data-section="${name}" data-label="${name}">
  <h2 data-field="heading" data-label="見出し">見出し</h2>
  <p data-field="text" data-type="richtext" data-label="本文">本文をここに入力します。</p>
</section>
`;

/**
 * VSCode-style code editor for theme development / part authoring. Edits a theme
 * working copy (never the original theme files — CLAUDE.md); "新しいパーツ" scaffolds
 * a reusable section under sections/.
 */
export function CodeEditorView({ api }: Props) {
  const [files, setFiles] = useState<ThemeFileNode[]>([]);
  const [active, setActive] = useState<ThemeFileNode | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);

  const refreshFiles = useCallback(async () => {
    const list = await api.listThemeFiles();
    setFiles(list);
    return list;
  }, [api]);

  useEffect(() => {
    void refreshFiles().then((list) => {
      const first = list.find((f) => f.path === "layout.html") ?? list[0] ?? null;
      setActive(first);
    });
  }, [refreshFiles]);

  useEffect(() => {
    if (!active) return;
    let ok = true;
    void api.readThemeFile(active.path).then((text) => {
      if (!ok) return;
      setContent(text);
      setDirty(false);
    });
    return () => {
      ok = false;
    };
  }, [api, active]);

  const onSave = () => {
    if (!active) return;
    void api.writeThemeFile(active.path, content).then(() => setDirty(false));
  };

  const onNewPart = async () => {
    const name = window.prompt(t("code.newPartPrompt"), "feature");
    if (!name) return;
    const safe = name.trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    if (!safe) return;
    const path = `sections/${safe}.html`;
    await api.writeThemeFile(path, NEW_PART_TEMPLATE(safe));
    const list = await refreshFiles();
    setActive(list.find((f) => f.path === path) ?? null);
  };

  const grouped = groupByDir(files);

  return (
    <div className="pcms-codelayout">
      <aside className="pcms-filetree">
        <div className="pcms-filetree__head">
          <span>{t("code.files")}</span>
          <button className="pcms-filetree__new" onClick={onNewPart} title={t("code.newPart")}>
            ＋
          </button>
        </div>
        {grouped.map(([dir, nodes]) => (
          <div key={dir} className="pcms-filetree__group">
            {dir && <div className="pcms-filetree__dir">{dir}/</div>}
            {nodes.map((f) => (
              <button
                key={f.path}
                className={`pcms-filetree__file${active?.path === f.path ? " is-active" : ""}`}
                onClick={() => setActive(f)}
                style={{ paddingLeft: dir ? "1.4rem" : "0.6rem" }}
              >
                {basename(f.path)}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <div className="pcms-codemain">
        <div className="pcms-codemain__bar">
          <span className="pcms-codemain__path">{active?.path ?? ""}</span>
          <button className="pcms-primary" onClick={onSave} disabled={!active || !dirty}>
            {dirty ? t("common.save") : t("common.saved")}
          </button>
        </div>
        {active ? (
          <CodeEditor
            key={active.path}
            value={content}
            kind={active.kind}
            onChange={(v) => {
              setContent(v);
              setDirty(true);
            }}
          />
        ) : (
          <p className="pcms-empty">{t("code.pickHint")}</p>
        )}
      </div>
    </div>
  );
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

function groupByDir(files: ThemeFileNode[]): [string, ThemeFileNode[]][] {
  const map = new Map<string, ThemeFileNode[]>();
  for (const f of files) {
    const i = f.path.lastIndexOf("/");
    const dir = i < 0 ? "" : f.path.slice(0, i);
    const list = map.get(dir) ?? [];
    list.push(f);
    map.set(dir, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
