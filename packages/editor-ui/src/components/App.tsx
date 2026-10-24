import { useCallback, useEffect, useMemo, useState } from "react";
import type { FieldValue, SectionSchema, ThemeTemplateSchema } from "@pcms/shared";
import type { PcmsApi, ProjectData } from "../api/types.js";
import { useEditorHistory } from "../state/history.js";
import {
  setField,
  setRepeatRows,
  setSectionOrder,
  toggleSectionHidden,
} from "../state/mutations.js";
import { renderPreview, schemaFor } from "../preview/render.js";
import { Toolbar } from "./Toolbar.js";
import { SectionList, type SectionRow } from "./SectionList.js";
import { Preview } from "./Preview.js";
import { SettingsPanel } from "./SettingsPanel.js";

// MVP edits the home page; multi-page editing comes with content management.
const PAGE_ID = "index";

type Row = Record<string, FieldValue>;

interface AppProps {
  api: PcmsApi;
}

export function App({ api }: AppProps) {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const history = useEditorHistory({ pages: {} });
  const { settings, commit, undo, redo, reset, canUndo, canRedo } = history;

  useEffect(() => {
    let active = true;
    void api.loadProject().then((data) => {
      if (!active) return;
      setProject(data);
      reset(data.settings);
      setDirty(false);
    });
    return () => {
      active = false;
    };
  }, [api, reset]);

  const schema: ThemeTemplateSchema | null = useMemo(
    () => (project ? schemaFor(project, settings, PAGE_ID) : null),
    [project, settings],
  );

  const page = settings.pages[PAGE_ID] ?? {};

  const sectionRows: SectionRow[] = useMemo(
    () => (schema ? orderSections(schema, page.sectionOrder).map(toRow) : []),
    [schema, page.sectionOrder, page.sections],
  );

  const selectedSection: SectionSchema | null =
    schema?.sections.find((s) => s.id === selectedId) ?? null;

  const previewHtml = useMemo(
    () => (project ? renderPreview(project, settings, PAGE_ID) : ""),
    [project, settings],
  );

  function toRow(s: SectionSchema): SectionRow {
    const hidden =
      (page.sections ?? []).find((x) => x.id === s.id)?.hidden === true;
    return { id: s.id, label: s.label ?? s.id, hidden };
  }

  const onFieldChange = useCallback(
    (path: string, value: string) => {
      commit(setField(settings, PAGE_ID, path, value), `field:${path}`);
      setDirty(true);
    },
    [commit, settings],
  );

  const onToggleHidden = useCallback(
    (id: string) => {
      commit(toggleSectionHidden(settings, PAGE_ID, id));
      setDirty(true);
    },
    [commit, settings],
  );

  const onMove = useCallback(
    (id: string, dir: -1 | 1) => {
      const ids = sectionRows.map((r) => r.id);
      const from = ids.indexOf(id);
      const to = from + dir;
      if (from < 0 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to] as string, ids[from] as string];
      commit(setSectionOrder(settings, PAGE_ID, ids));
      setDirty(true);
    },
    [commit, settings, sectionRows],
  );

  const onRepeatChange = useCallback(
    (sectionId: string, name: string, rows: Row[]) => {
      commit(
        setRepeatRows(settings, PAGE_ID, sectionId, name, rows),
        `repeat:${sectionId}:${name}`,
      );
      setDirty(true);
    },
    [commit, settings],
  );

  const onSave = useCallback(() => {
    void api.saveDraft(settings).then(() => setDirty(false));
  }, [api, settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        setDirty(true);
      } else if (key === "s") {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, onSave]);

  if (!project || !schema) {
    return <div className="pcms-loading">読み込み中…</div>;
  }

  return (
    <div className="pcms-app">
      <Toolbar
        canUndo={canUndo}
        canRedo={canRedo}
        dirty={dirty}
        onUndo={() => {
          undo();
          setDirty(true);
        }}
        onRedo={() => {
          redo();
          setDirty(true);
        }}
        onSave={onSave}
      />
      <div className="pcms-columns">
        <SectionList
          sections={sectionRows}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleHidden={onToggleHidden}
          onMove={onMove}
        />
        <Preview html={previewHtml} />
        <SettingsPanel
          section={selectedSection}
          page={page}
          onFieldChange={onFieldChange}
          onRepeatChange={onRepeatChange}
        />
      </div>
    </div>
  );
}

/** Apply the operator's section order; unlisted sections keep template order. */
function orderSections(
  schema: ThemeTemplateSchema,
  order: string[] | undefined,
): SectionSchema[] {
  if (!order || order.length === 0) return schema.sections;
  const byId = new Map(schema.sections.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const result: SectionSchema[] = [];
  for (const id of order) {
    const s = byId.get(id);
    if (s && !seen.has(id)) {
      result.push(s);
      seen.add(id);
    }
  }
  for (const s of schema.sections) if (!seen.has(s.id)) result.push(s);
  return result;
}
