import { useCallback, useEffect, useMemo, useState } from "react";
import type { FieldValue, SectionInstance, SectionSchema, SectionStyle } from "@pcms/shared";
import { useSiteWorkspace } from "../state/SiteWorkspace.js";
import type { ContentTypeDef, MenuItem, TaxonomyDef } from "@pcms/shared";
import {
  createContent,
  findItem,
  listTargets,
  removeContent,
  setContentField,
  setContentStatus,
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
  addRegionInstance,
  duplicateInstance,
  duplicateRegionInstance,
  moveInstance,
  moveRegionInstance,
  pasteInstance,
  pasteRegionInstance,
  removeInstance,
  removeRegionInstance,
  setField,
  setInstanceField,
  setInstanceRepeat,
  setInstanceStyle,
  setRegionInstanceField,
  setRegionInstanceRepeat,
  setRegionInstanceStyle,
  setRepeatRows,
  setSectionOrder,
  toggleInstanceHidden,
  toggleRegionInstanceHidden,
  toggleSectionHidden,
} from "../state/mutations.js";
import type { RegionName } from "@pcms/shared";
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
import { AiPanel } from "./AiPanel.js";
import { t } from "../i18n.js";

type Row = Record<string, FieldValue>;
/** Which composed list the editor acts on: the page body, or a site-wide region. */
type Scope = "body" | RegionName;

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
  const [aiOpen, setAiOpen] = useState(false);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  // The inline card is open per selection; closing it keeps the section
  // selected so its settings fall back to the right panel.
  const [inlineOpen, setInlineOpen] = useState(true);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [clipboard, setClipboard] = useState<SectionInstance | null>(null);
  // Which region the canvas / inline editor act on: page body, header or footer.
  const [editScope, setEditScope] = useState<Scope>("body");
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

  const onReorderSection = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= sectionRows.length || to >= sectionRows.length) {
        return;
      }
      const ids = sectionRows.map((r) => r.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved as string);
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

  // --- Composed sections: page body + site-wide header/footer regions -------
  // Body and the two regions share one composed-instance model; `editScope`
  // chooses which list the canvas / inline editor act on, and a preview click
  // switches scope to wherever the clicked section lives (CLAUDE.md: header /
  // footer are edited once and apply to every page).

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

  // The page body is "composed" when it has an instances list (vs a fixed
  // template). Header/footer always use the composed region model.
  const pageComposed = target?.kind === "page" && page.instances != null;
  const regions = doc.settings.regions;
  const hasRegions = regions != null;

  const listFor = useCallback(
    (scope: Scope): SectionInstance[] =>
      scope === "body" ? page.instances ?? [] : regions?.[scope] ?? [],
    [page.instances, regions],
  );

  // The active composed list (for the current scope). Fixed body has none.
  const activeComposed = editScope !== "body" || pageComposed;
  const instances = activeComposed ? listFor(editScope) : [];
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
    activeComposed && selectedInstance && selectedInstanceSchema && anchor && inlineOpen,
  );

  // Selecting a section (from a list or the preview) opens its inline card.
  const onSelectSection = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setInlineOpen(true);
  }, []);

  // Scope-aware builders: route a mutation to the page body or a region.
  const buildToggle = (s: Scope, id: string) =>
    s === "body"
      ? toggleInstanceHidden(doc.settings, pageId, id)
      : toggleRegionInstanceHidden(doc.settings, s, id);
  const buildMove = (s: Scope, from: number, to: number) =>
    s === "body"
      ? moveInstance(doc.settings, pageId, from, to)
      : moveRegionInstance(doc.settings, s, from, to);
  const buildRemove = (s: Scope, id: string) =>
    s === "body"
      ? removeInstance(doc.settings, pageId, id)
      : removeRegionInstance(doc.settings, s, id);
  const buildAdd = (s: Scope, type: string, at?: number) =>
    s === "body"
      ? addInstance(doc.settings, pageId, type, at)
      : addRegionInstance(doc.settings, s, type, at);
  const buildDuplicate = (s: Scope, id: string) =>
    s === "body"
      ? duplicateInstance(doc.settings, pageId, id)
      : duplicateRegionInstance(doc.settings, s, id);
  const buildPaste = (s: Scope, snap: SectionInstance) =>
    s === "body"
      ? pasteInstance(doc.settings, pageId, snap)
      : pasteRegionInstance(doc.settings, s, snap);

  const onToggleInstanceHidden = useCallback(
    (id: string, scope: Scope = editScope) => {
      commit({ ...doc, settings: buildToggle(scope, id) });
      setDirty(true);
    },
    [commit, doc, pageId, editScope],
  );

  const onMoveInstance = useCallback(
    (from: number, to: number, scope: Scope = editScope) => {
      commit({ ...doc, settings: buildMove(scope, from, to) });
      setDirty(true);
    },
    [commit, doc, pageId, editScope],
  );

  const onDeleteInstance = useCallback(
    (id: string, scope: Scope = editScope) => {
      commit({ ...doc, settings: buildRemove(scope, id) });
      setSelectedId((cur) => (cur === id ? null : cur));
      setDirty(true);
    },
    [commit, doc, pageId, editScope],
  );

  const onAddInstance = useCallback(
    (type: string, at?: number, scope: Scope = editScope) => {
      const settings = buildAdd(scope, type, at);
      commit({ ...doc, settings });
      const list = scope === "body" ? settings.pages[pageId]?.instances ?? [] : settings.regions?.[scope] ?? [];
      const added = list[at ?? list.length - 1];
      setEditScope(scope);
      if (added) setSelectedId(added.id);
      setDirty(true);
    },
    [commit, doc, pageId, editScope],
  );

  const onInstanceField = useCallback(
    (path: string, value: string) => {
      if (!selectedId) return;
      const next =
        editScope === "body"
          ? setInstanceField(doc.settings, pageId, selectedId, path, value)
          : setRegionInstanceField(doc.settings, editScope, selectedId, path, value);
      commit({ ...doc, settings: next }, `inst:${editScope}:${selectedId}:${path}`);
      setDirty(true);
    },
    [commit, doc, pageId, selectedId, editScope],
  );

  const onInstanceRepeat = useCallback(
    (name: string, rows: Row[]) => {
      if (!selectedId) return;
      const next =
        editScope === "body"
          ? setInstanceRepeat(doc.settings, pageId, selectedId, name, rows)
          : setRegionInstanceRepeat(doc.settings, editScope, selectedId, name, rows);
      commit({ ...doc, settings: next }, `instrep:${editScope}:${selectedId}:${name}`);
      setDirty(true);
    },
    [commit, doc, pageId, selectedId, editScope],
  );

  const onCopyInstance = useCallback(() => {
    if (selectedInstance) setClipboard(selectedInstance);
  }, [selectedInstance]);

  const onPasteInstance = useCallback(
    (scope: Scope = editScope) => {
      if (!clipboard) return;
      const settings = buildPaste(scope, clipboard);
      commit({ ...doc, settings });
      const list = scope === "body" ? settings.pages[pageId]?.instances ?? [] : settings.regions?.[scope] ?? [];
      const added = list[list.length - 1];
      setEditScope(scope);
      if (added) setSelectedId(added.id);
      setDirty(true);
    },
    [clipboard, doc, pageId, commit, setDirty, editScope],
  );

  const onInstanceStyle = useCallback(
    (patch: Partial<SectionStyle>) => {
      if (!selectedId) return;
      const next =
        editScope === "body"
          ? setInstanceStyle(doc.settings, pageId, selectedId, patch)
          : setRegionInstanceStyle(doc.settings, editScope, selectedId, patch);
      commit({ ...doc, settings: next }, `inststyle:${editScope}:${selectedId}`);
      setDirty(true);
    },
    [commit, doc, pageId, selectedId, editScope, setDirty],
  );

  const onDuplicateInstance = useCallback(
    (id: string, scope: Scope = editScope) => {
      commit({ ...doc, settings: buildDuplicate(scope, id) });
      setDirty(true);
    },
    [commit, doc, pageId, editScope],
  );

  /** Apply a field value: region instance, composed body instance, or fixed page. */
  const applyFieldEdit = useCallback(
    (scope: Scope, section: string | null | undefined, field: string, value: string, key?: string) => {
      let next;
      if (scope !== "body") {
        if (!section) return;
        next = setRegionInstanceField(doc.settings, scope, section, field, value);
      } else if (pageComposed && section) {
        next = setInstanceField(doc.settings, pageId, section, field, value);
      } else {
        next = setField(doc.settings, pageId, field, value);
      }
      commit({ ...doc, settings: next }, key);
      setDirty(true);
    },
    [commit, doc, pageId, pageComposed],
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

  // --- Delete content (while editing it inline) ----------------------------

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

  const onStatusChange = useCallback(
    (status: "draft" | "published") => {
      if (target?.kind !== "content") return;
      commit(setContentStatus(doc, target.type, target.slug, status));
      setDirty(true);
    },
    [commit, doc, target],
  );

  // --- Target selection ----------------------------------------------------

  const onSelectTarget = useCallback((key: string) => {
    setCurrentKey(key);
    setSelectedId(null);
    setEditScope("body");
  }, []);

  // Clear the selection when switching the edit scope — ids don't cross lists.
  const onSelectScope = useCallback((scope: Scope) => {
    setEditScope(scope);
    setSelectedId(null);
  }, []);

  // Messages from the preview runtime: select, reorder (op/move), insert. Each
  // carries the `region` it happened in (body / header / footer); we switch the
  // edit scope to that region and route the mutation to its instance list.
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
            region?: string;
            rect?: Anchor["rect"] | null;
            view?: Anchor["view"];
          }
        | null;
      if (!d || d.source !== "pcms-preview") return;

      const region: Scope =
        d.region === "header" || d.region === "footer" ? d.region : "body";
      // Is this region editable as composed instances? (body may be a fixed page.)
      const regionComposed = region !== "body" || pageComposed;

      if (d.type === "select") {
        if (d.section) {
          setEditScope(region);
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
        if (d.section) {
          setEditScope(region);
          setSelectedId(d.section);
        }
        setFocusTarget(regionComposed ? `inst-${d.section}-${d.field}` : `field-${d.field}`);
        return;
      }
      if (d.type === "edit" && d.field) {
        applyFieldEdit(region, d.section, d.field, d.value ?? "", `edit:${region}:${d.section}:${d.field}`);
        return;
      }
      if (d.type === "pickimage" && d.field) {
        const section = d.section;
        const field = d.field;
        void mediaLib.value.pickImage().then((path) => {
          if (path) applyFieldEdit(region, section, field, path);
        });
        return;
      }
      if (!regionComposed) return;
      const list = listFor(region);
      const from = d.id ? list.findIndex((i) => i.id === d.id) : -1;
      if (d.type === "op" && from >= 0) {
        if (d.op === "up") onMoveInstance(from, from - 1, region);
        else if (d.op === "down") onMoveInstance(from, from + 1, region);
        else if (d.op === "dup" && d.id) onDuplicateInstance(d.id, region);
        else if (d.op === "del" && d.id) onDeleteInstance(d.id, region);
      } else if (d.type === "move" && from >= 0 && d.toIndex != null) {
        const to = d.toIndex > from ? d.toIndex - 1 : d.toIndex;
        if (to !== from) onMoveInstance(from, to, region);
      } else if (d.type === "insert" && d.index != null) {
        setEditScope(region);
        setInsertAt(d.index);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    pageComposed,
    listFor,
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
          onAi={() => setAiOpen(true)}
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
        ) : (
          <div className="pcms-sections-col">
            {hasRegions && (
              <div className="pcms-scope-switch" role="tablist" aria-label={t("region.switch")}>
                {(["header", "body", "footer"] as Scope[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={editScope === s}
                    className={`pcms-scope-switch__btn${editScope === s ? " is-active" : ""}`}
                    onClick={() => onSelectScope(s)}
                  >
                    {t(`region.${s}`)}
                  </button>
                ))}
              </div>
            )}
            {activeComposed ? (
              <SectionCanvas
                instances={instanceRows}
                catalog={catalog.map((c) => ({ type: c.id, label: c.label ?? c.id }))}
                selectedId={selectedId}
                onSelect={onSelectSection}
                onToggleHidden={onToggleInstanceHidden}
                onMove={onMoveInstance}
                onDelete={onDeleteInstance}
                onAdd={onAddInstance}
                onPaste={onPasteInstance}
                canPaste={clipboard != null}
              />
            ) : (
              <SectionList
                sections={sectionRows}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onToggleHidden={onToggleHidden}
                onMove={onMove}
                onReorder={onReorderSection}
              />
            )}
          </div>
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
                onCopy={onCopyInstance}
                onClose={() => setInlineOpen(false)}
              />
            ) : null
          }
        />

        {inlineActive ? null : target.kind === "page" && activeComposed ? (
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
            onStatusChange={onStatusChange}
            onDelete={onDeleteContent}
          />
        ) : (
          <aside className="pcms-settings" />
        )}
        </div>
      </div>
      {mediaLib.modal}
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
