import { useCallback, useEffect, useMemo, useState } from "react";
import type { FieldValue, SectionSchema } from "@pcms/shared";
import type { PcmsApi, ProjectData } from "../api/types.js";
import { useEditorHistory } from "../state/history.js";
import type { ContentTypeDef } from "@pcms/shared";
import {
  createContent,
  findItem,
  initialState,
  listTargets,
  removeContent,
  setContentField,
  slugExists,
  targetKey,
  typeDef,
  type EditorState,
  type EditorTarget,
} from "../state/editorState.js";
import {
  setField,
  setRepeatRows,
  setSectionOrder,
  toggleSectionHidden,
} from "../state/mutations.js";
import { renderPreview, schemaForPage } from "../preview/render.js";
import { MediaContext, useMediaLibrary } from "../media/MediaContext.js";
import { Toolbar } from "./Toolbar.js";
import { SectionList, type SectionRow } from "./SectionList.js";
import { Preview } from "./Preview.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { ContentForm } from "./ContentForm.js";
import { NewContentModal } from "./NewContentModal.js";
import { ContentTypeManager } from "./ContentTypeManager.js";
import { t } from "../i18n.js";

type Row = Record<string, FieldValue>;

const EMPTY_STATE: EditorState = { settings: { pages: {} }, content: [], contentTypes: [] };

interface AppProps {
  api: PcmsApi;
}

export function App({ api }: AppProps) {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [currentKey, setCurrentKey] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const { doc, commit, undo, redo, reset, canUndo, canRedo } =
    useEditorHistory<EditorState>(EMPTY_STATE);
  const mediaLib = useMediaLibrary(api);

  useEffect(() => {
    let active = true;
    void api.loadProject().then((data) => {
      if (!active) return;
      setProject(data);
      const state = initialState(data);
      reset(state);
      const first = listTargets(state)[0];
      if (first) setCurrentKey(targetKey(first));
      setDirty(false);
    });
    return () => {
      active = false;
    };
  }, [api, reset]);

  const targets = useMemo(() => listTargets(doc), [doc]);
  const target: EditorTarget | undefined =
    targets.find((tg) => targetKey(tg) === currentKey) ?? targets[0];

  const previewHtml = useMemo(
    () =>
      project && target
        ? renderPreview(project, doc, target, mediaLib.value.media)
        : "",
    [project, doc, target, mediaLib.value.media],
  );

  // --- Page-target editing -------------------------------------------------

  const schema = useMemo(
    () =>
      project && target?.kind === "page"
        ? schemaForPage(project, target.id)
        : null,
    [project, target],
  );
  const page = target?.kind === "page" ? doc.settings.pages[target.id] ?? {} : {};

  const sectionRows: SectionRow[] = useMemo(() => {
    if (!schema) return [];
    return orderSections(schema.sections, page.sectionOrder).map((s) => ({
      id: s.id,
      label: s.label ?? s.id,
      hidden: (page.sections ?? []).find((x) => x.id === s.id)?.hidden === true,
    }));
  }, [schema, page.sectionOrder, page.sections]);

  const selectedSection: SectionSchema | null =
    schema?.sections.find((s) => s.id === selectedId) ?? null;

  const pageId = target?.kind === "page" ? target.id : "";

  const onFieldChange = useCallback(
    (path: string, value: string) => {
      commit(
        { ...doc, settings: setField(doc.settings, pageId, path, value) },
        `field:${pageId}:${path}`,
      );
      setDirty(true);
    },
    [commit, doc, pageId],
  );

  const onToggleHidden = useCallback(
    (id: string) => {
      commit({ ...doc, settings: toggleSectionHidden(doc.settings, pageId, id) });
      setDirty(true);
    },
    [commit, doc, pageId],
  );

  const onMove = useCallback(
    (id: string, dir: -1 | 1) => {
      const ids = sectionRows.map((r) => r.id);
      const from = ids.indexOf(id);
      const to = from + dir;
      if (from < 0 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to] as string, ids[from] as string];
      commit({ ...doc, settings: setSectionOrder(doc.settings, pageId, ids) });
      setDirty(true);
    },
    [commit, doc, pageId, sectionRows],
  );

  const onRepeatChange = useCallback(
    (sectionId: string, name: string, rows: Row[]) => {
      commit(
        {
          ...doc,
          settings: setRepeatRows(doc.settings, pageId, sectionId, name, rows),
        },
        `repeat:${pageId}:${sectionId}:${name}`,
      );
      setDirty(true);
    },
    [commit, doc, pageId],
  );

  // --- Content-target editing ----------------------------------------------

  const onContentChange = useCallback(
    (key: string, value: string) => {
      if (target?.kind !== "content") return;
      commit(
        setContentField(doc, target.type, target.slug, key, value),
        `content:${target.type}/${target.slug}:${key}`,
      );
      setDirty(true);
    },
    [commit, doc, target],
  );

  // --- Create / delete / types ---------------------------------------------

  const onCreateContent = useCallback(
    (type: string, title: string, slug: string) => {
      let unique = slug;
      let n = 2;
      while (slugExists(doc, type, unique)) unique = `${slug}-${n++}`;
      commit(createContent(doc, type, title, unique));
      setDirty(true);
      setNewOpen(false);
      setCurrentKey(targetKey({ kind: "content", type, slug: unique, label: "" }));
      setSelectedId(null);
    },
    [commit, doc],
  );

  const onDeleteContent = useCallback(() => {
    if (target?.kind !== "content") return;
    if (!window.confirm(t("content.deleteConfirm"))) return;
    const { type, slug } = target;
    void api.deleteContent(type, slug).then(() => {
      const next = removeContent(doc, type, slug);
      commit(next);
      const first = listTargets(next)[0];
      if (first) setCurrentKey(targetKey(first));
    });
  }, [api, commit, doc, target]);

  const onTypesCommit = useCallback(
    (types: ContentTypeDef[]) => {
      commit({ ...doc, contentTypes: types });
      setDirty(true);
    },
    [commit, doc],
  );

  // --- Save + history ------------------------------------------------------

  const onSave = useCallback(() => {
    void Promise.all([
      api.saveDraft(doc.settings),
      api.saveContent(doc.content),
      api.saveContentTypes(doc.contentTypes),
    ]).then(() => setDirty(false));
  }, [api, doc]);

  const onSelectTarget = useCallback((key: string) => {
    setCurrentKey(key);
    setSelectedId(null);
  }, []);

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

  if (!project || !target) {
    return <div className="pcms-loading">読み込み中…</div>;
  }

  const currentItem =
    target.kind === "content"
      ? findItem(doc, target.type, target.slug)
      : undefined;

  return (
    <MediaContext.Provider value={mediaLib.value}>
      <div className="pcms-app">
        <Toolbar
          targets={targets}
          currentKey={targetKey(target)}
          onSelectTarget={onSelectTarget}
          onNew={() => setNewOpen(true)}
          onManageTypes={() => setTypesOpen(true)}
          onOpenMedia={mediaLib.value.openLibrary}
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
        {target.kind === "page" ? (
          <SectionList
            sections={sectionRows}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggleHidden={onToggleHidden}
            onMove={onMove}
          />
        ) : (
          <nav className="pcms-sections">
            <h2 className="pcms-col__title">{t("content.outline")}</h2>
            <p className="pcms-empty">{t("content.outline.hint")}</p>
          </nav>
        )}

        <Preview html={previewHtml} />

        {target.kind === "page" ? (
          <SettingsPanel
            section={selectedSection}
            page={page}
            onFieldChange={onFieldChange}
            onRepeatChange={onRepeatChange}
          />
        ) : currentItem ? (
          <ContentForm
            item={currentItem}
            def={typeDef(doc, target.type)}
            onChange={onContentChange}
            onDelete={onDeleteContent}
          />
        ) : (
          <aside className="pcms-settings" />
        )}
        </div>
      </div>
      {mediaLib.modal}
      {newOpen && (
        <NewContentModal
          types={doc.contentTypes}
          onCreate={onCreateContent}
          onClose={() => setNewOpen(false)}
        />
      )}
      {typesOpen && (
        <ContentTypeManager
          types={doc.contentTypes}
          onCommit={onTypesCommit}
          onClose={() => setTypesOpen(false)}
        />
      )}
    </MediaContext.Provider>
  );
}

/** Apply the operator's section order; unlisted sections keep template order. */
function orderSections(
  sections: SectionSchema[],
  order: string[] | undefined,
): SectionSchema[] {
  if (!order || order.length === 0) return sections;
  const byId = new Map(sections.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const result: SectionSchema[] = [];
  for (const id of order) {
    const s = byId.get(id);
    if (s && !seen.has(id)) {
      result.push(s);
      seen.add(id);
    }
  }
  for (const s of sections) if (!seen.has(s.id)) result.push(s);
  return result;
}
