import { useCallback, useEffect, useMemo, useState } from "react";
import type { FieldValue, SectionSchema, SectionStyle } from "@pcms/shared";
import { useSiteWorkspace } from "../state/SiteWorkspace.js";
import type { ContentTypeDef, MenuItem, TaxonomyDef } from "@pcms/shared";
import {
  createContent,
  findItem,
  listTargets,
  removeContent,
  setContentField,
  setContentTerms,
  setMenu,
  setTaxonomies,
  slugExists,
  targetKey,
  taxonomiesFor,
  typeDef,
  type EditorTarget,
} from "../state/editorState.js";
import {
  addInstance,
  duplicateInstance,
  moveInstance,
  removeInstance,
  setField,
  setInstanceField,
  setInstanceRepeat,
  setInstanceStyle,
  setRepeatRows,
  setSectionOrder,
  toggleInstanceHidden,
  toggleSectionHidden,
} from "../state/mutations.js";
import { parseSectionSchema } from "@pcms/engine";
import { renderPreview, schemaForPage } from "../preview/render.js";
import { MediaContext, useMediaLibrary } from "../media/MediaContext.js";
import { Toolbar } from "./Toolbar.js";
import { SectionList, type SectionRow } from "./SectionList.js";
import { Preview } from "./Preview.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { SectionCanvas, type InstanceRow } from "./SectionCanvas.js";
import { InstanceSettings } from "./InstanceSettings.js";
import { InlineEditor, type Anchor } from "./InlineEditor.js";
import { AddSectionModal } from "./AddSectionModal.js";
import { ContentForm } from "./ContentForm.js";
import { NewContentModal } from "./NewContentModal.js";
import { ContentTypeManager } from "./ContentTypeManager.js";
import { MenuManager } from "./MenuManager.js";
import { TaxonomyManager } from "./TaxonomyManager.js";
import { PublishPanel } from "./PublishPanel.js";
import { AiPanel } from "./AiPanel.js";
import { t } from "../i18n.js";

type Row = Record<string, FieldValue>;

/**
 * The theme editor (visual mode). It reads the open site from the shared
 * SiteWorkspace, so content views and this editor stay in sync; the document,
 * history and save all live in the workspace.
 */
export function ThemeEditor() {
  const { api, project, doc, commit, undo, redo, canUndo, canRedo, dirty, setDirty, save: onSave } =
    useSiteWorkspace();
  const [currentKey, setCurrentKey] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [menusOpen, setMenusOpen] = useState(false);
  const [taxOpen, setTaxOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  // The inline card is open per selection; closing it keeps the section
  // selected so its settings fall back to the right panel.
  const [inlineOpen, setInlineOpen] = useState(true);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const mediaLib = useMediaLibrary(api);

  // Select the first target once the project is loaded.
  useEffect(() => {
    const first = listTargets(doc)[0];
    setCurrentKey((cur) => cur || (first ? targetKey(first) : ""));
  }, [doc]);

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

  // --- Composed-page (section instances) editing ---------------------------

  const catalog: SectionSchema[] = useMemo(() => {
    const sections = project?.theme.sections ?? {};
    return Object.entries(sections).map(([type, html]) =>
      parseSectionSchema(type, html),
    );
  }, [project]);

  const schemaByType = useMemo(() => {
    const m = new Map<string, SectionSchema>();
    for (const s of catalog) m.set(s.id, s);
    return m;
  }, [catalog]);

  const composed = target?.kind === "page" && page.instances != null;
  const instances = page.instances ?? [];
  const instanceRows: InstanceRow[] = instances.map((inst) => ({
    id: inst.id,
    type: inst.type,
    label: schemaByType.get(inst.type)?.label ?? inst.type,
    hidden: inst.hidden === true,
  }));
  const selectedInstance = instances.find((i) => i.id === selectedId) ?? null;
  const selectedInstanceSchema = selectedInstance
    ? schemaByType.get(selectedInstance.type) ?? null
    : null;

  // The inline (on-preview) editor is showing — collapse the right panel.
  const inlineActive = Boolean(
    composed && selectedInstance && selectedInstanceSchema && anchor && inlineOpen,
  );

  // Selecting a section (from a list or the preview) opens its inline card.
  const onSelectSection = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setInlineOpen(true);
  }, []);

  const onToggleInstanceHidden = useCallback(
    (id: string) => {
      commit({ ...doc, settings: toggleInstanceHidden(doc.settings, pageId, id) });
      setDirty(true);
    },
    [commit, doc, pageId],
  );

  const onMoveInstance = useCallback(
    (from: number, to: number) => {
      commit({ ...doc, settings: moveInstance(doc.settings, pageId, from, to) });
      setDirty(true);
    },
    [commit, doc, pageId],
  );

  const onDeleteInstance = useCallback(
    (id: string) => {
      commit({ ...doc, settings: removeInstance(doc.settings, pageId, id) });
      setSelectedId((cur) => (cur === id ? null : cur));
      setDirty(true);
    },
    [commit, doc, pageId],
  );

  const onAddInstance = useCallback(
    (type: string, at?: number) => {
      const settings = addInstance(doc.settings, pageId, type, at);
      commit({ ...doc, settings });
      const list = settings.pages[pageId]?.instances ?? [];
      const added = list[at ?? list.length - 1];
      if (added) setSelectedId(added.id);
      setDirty(true);
    },
    [commit, doc, pageId],
  );

  const onInstanceField = useCallback(
    (path: string, value: string) => {
      if (!selectedId) return;
      commit(
        { ...doc, settings: setInstanceField(doc.settings, pageId, selectedId, path, value) },
        `inst:${selectedId}:${path}`,
      );
      setDirty(true);
    },
    [commit, doc, pageId, selectedId],
  );

  const onInstanceRepeat = useCallback(
    (name: string, rows: Row[]) => {
      if (!selectedId) return;
      commit(
        { ...doc, settings: setInstanceRepeat(doc.settings, pageId, selectedId, name, rows) },
        `instrep:${selectedId}:${name}`,
      );
      setDirty(true);
    },
    [commit, doc, pageId, selectedId],
  );

  const onInstanceStyle = useCallback(
    (patch: Partial<SectionStyle>) => {
      if (!selectedId) return;
      commit(
        { ...doc, settings: setInstanceStyle(doc.settings, pageId, selectedId, patch) },
        `inststyle:${selectedId}`,
      );
      setDirty(true);
    },
    [commit, doc, pageId, selectedId, setDirty],
  );

  const onDuplicateInstance = useCallback(
    (id: string) => {
      commit({ ...doc, settings: duplicateInstance(doc.settings, pageId, id) });
      setDirty(true);
    },
    [commit, doc, pageId],
  );

  /** Apply a value to a field (composed instance or fixed page). */
  const applyFieldEdit = useCallback(
    (section: string | null | undefined, field: string, value: string, key?: string) => {
      if (composed && section) {
        commit(
          { ...doc, settings: setInstanceField(doc.settings, pageId, section, field, value) },
          key,
        );
      } else if (!composed) {
        commit({ ...doc, settings: setField(doc.settings, pageId, field, value) }, key);
      }
      setDirty(true);
    },
    [commit, doc, pageId, composed],
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

  const onMenuCommit = useCallback(
    (name: string, items: MenuItem[]) => {
      commit(setMenu(doc, name, items), `menu:${name}`);
      setDirty(true);
    },
    [commit, doc],
  );

  const onTaxCommit = useCallback(
    (taxonomies: TaxonomyDef[]) => {
      commit(setTaxonomies(doc, taxonomies));
      setDirty(true);
    },
    [commit, doc],
  );

  const onTermsChange = useCallback(
    (taxonomy: string, terms: string[]) => {
      if (target?.kind !== "content") return;
      commit(
        setContentTerms(doc, target.type, target.slug, taxonomy, terms),
        `terms:${target.type}/${target.slug}:${taxonomy}`,
      );
      setDirty(true);
    },
    [commit, doc, target],
  );

  // --- Target selection ----------------------------------------------------

  const onSelectTarget = useCallback((key: string) => {
    setCurrentKey(key);
    setSelectedId(null);
  }, []);

  // Messages from the preview runtime: select, reorder (op/move), insert.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as
        | {
            source?: string;
            type?: string;
            section?: string | null;
            field?: string | null;
            value?: string;
            op?: string;
            id?: string;
            toIndex?: number;
            index?: number;
            rect?: Anchor["rect"] | null;
            view?: Anchor["view"];
          }
        | null;
      if (!d || d.source !== "pcms-preview") return;

      if (d.type === "select") {
        if (d.section) {
          setSelectedId(d.section);
          setInlineOpen(true);
        }
        return;
      }
      if (d.type === "rect") {
        setAnchor(d.rect && d.view ? { rect: d.rect, view: d.view } : null);
        return;
      }
      if (d.type === "focusfield" && d.field) {
        // Deferred so a double-click (inline edit) can cancel it first.
        if (d.section) setSelectedId(d.section);
        setFocusTarget(composed ? `inst-${d.section}-${d.field}` : `field-${d.field}`);
        return;
      }
      if (d.type === "edit" && d.field) {
        applyFieldEdit(d.section, d.field, d.value ?? "", `edit:${d.section}:${d.field}`);
        return;
      }
      if (d.type === "pickimage" && d.field) {
        const section = d.section;
        const field = d.field;
        void mediaLib.value.pickImage().then((path) => {
          if (path) applyFieldEdit(section, field, path);
        });
        return;
      }
      if (!composed) return;
      const from = d.id ? instances.findIndex((i) => i.id === d.id) : -1;
      if (d.type === "op" && from >= 0) {
        if (d.op === "up") onMoveInstance(from, from - 1);
        else if (d.op === "down") onMoveInstance(from, from + 1);
        else if (d.op === "dup" && d.id) onDuplicateInstance(d.id);
        else if (d.op === "del" && d.id) onDeleteInstance(d.id);
      } else if (d.type === "move" && from >= 0 && d.toIndex != null) {
        const to = d.toIndex > from ? d.toIndex - 1 : d.toIndex;
        if (to !== from) onMoveInstance(from, to);
      } else if (d.type === "insert" && d.index != null) {
        setInsertAt(d.index);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    composed,
    instances,
    onMoveInstance,
    onDeleteInstance,
    onDuplicateInstance,
    applyFieldEdit,
    mediaLib.value,
  ]);

  // The inline editor only makes sense while a section is selected.
  useEffect(() => {
    if (!selectedId) setAnchor(null);
  }, [selectedId]);

  // Focus a field in the right panel after a field click in the preview.
  useEffect(() => {
    if (!focusTarget) return;
    const el = document.getElementById(focusTarget) as HTMLElement | null;
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest" });
    }
    setFocusTarget(null);
  }, [focusTarget, selectedId]);

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

  if (!target) {
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
          device={device}
          onDevice={setDevice}
          onNew={() => setNewOpen(true)}
          onManageTypes={() => setTypesOpen(true)}
          onManageMenus={() => setMenusOpen(true)}
          onManageTax={() => setTaxOpen(true)}
          onOpenMedia={mediaLib.value.openLibrary}
          onAi={() => setAiOpen(true)}
          onPublish={() => setPublishOpen(true)}
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
      <div className={`pcms-columns${inlineActive ? " pcms-columns--inline" : ""}`}>
        {target.kind !== "page" ? (
          <nav className="pcms-sections">
            <h2 className="pcms-col__title">{t("content.outline")}</h2>
            <p className="pcms-empty">{t("content.outline.hint")}</p>
          </nav>
        ) : composed ? (
          <SectionCanvas
            instances={instanceRows}
            catalog={catalog.map((c) => ({ type: c.id, label: c.label ?? c.id }))}
            selectedId={selectedId}
            onSelect={onSelectSection}
            onToggleHidden={onToggleInstanceHidden}
            onMove={onMoveInstance}
            onDelete={onDeleteInstance}
            onAdd={onAddInstance}
          />
        ) : (
          <SectionList
            sections={sectionRows}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggleHidden={onToggleHidden}
            onMove={onMove}
          />
        )}

        <Preview
          html={previewHtml}
          selectedSection={selectedId}
          device={device}
          overlay={
            inlineActive && selectedInstance && selectedInstanceSchema && anchor ? (
              <InlineEditor
                schema={selectedInstanceSchema}
                instance={selectedInstance}
                anchor={anchor}
                onFieldChange={onInstanceField}
                onRepeatChange={onInstanceRepeat}
                onStyleChange={onInstanceStyle}
                onClose={() => setInlineOpen(false)}
              />
            ) : null
          }
        />

        {inlineActive ? null : target.kind === "page" && composed ? (
          selectedInstance ? (
            <InstanceSettings
              schema={selectedInstanceSchema}
              instance={selectedInstance}
              onFieldChange={onInstanceField}
              onRepeatChange={onInstanceRepeat}
              onStyleChange={onInstanceStyle}
            />
          ) : (
            <aside className="pcms-settings">
              <h2 className="pcms-col__title">{t("settings.title")}</h2>
              <p className="pcms-empty">{t("settings.empty")}</p>
            </aside>
          )
        ) : target.kind === "page" ? (
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
            taxonomies={taxonomiesFor(doc, target.type)}
            onChange={onContentChange}
            onTermsChange={onTermsChange}
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
      {menusOpen && (
        <MenuManager
          menus={doc.menus}
          onCommit={onMenuCommit}
          onClose={() => setMenusOpen(false)}
        />
      )}
      {taxOpen && (
        <TaxonomyManager
          taxonomies={doc.taxonomies}
          contentTypes={doc.contentTypes}
          onCommit={onTaxCommit}
          onClose={() => setTaxOpen(false)}
        />
      )}
      {publishOpen && <PublishPanel api={api} onClose={() => setPublishOpen(false)} />}
      {aiOpen && (
        <AiPanel
          api={api}
          content={
            target.kind === "content" && currentItem
              ? {
                  title: String(currentItem.fields.title ?? currentItem.slug),
                  body: currentItem.body,
                  onApplyBody: (value) => onContentChange("body", value),
                }
              : undefined
          }
          onClose={() => setAiOpen(false)}
        />
      )}
      {insertAt != null && (
        <AddSectionModal
          catalog={catalog.map((c) => ({ type: c.id, label: c.label ?? c.id }))}
          onPick={(type) => {
            onAddInstance(type, insertAt);
            setInsertAt(null);
          }}
          onClose={() => setInsertAt(null)}
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
