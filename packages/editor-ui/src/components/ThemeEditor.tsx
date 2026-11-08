import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  BlockInstance,
  FieldValue,
  SectionInstance,
  SectionSchema,
  SectionStyle,
  SiteSettings,
} from "@pcms/shared";
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
  addBlock,
  addInstance,
  addRegionInstance,
  changeBlockType,
  changeInstanceType,
  duplicateBlock,
  duplicateInstance,
  duplicateRegionInstance,
  enablePageRegions,
  disablePageRegions,
  moveBlock,
  moveInstance,
  moveRegionInstance,
  pasteInstance,
  pasteRegionInstance,
  removeBlock,
  removeInstance,
  removeRegionInstance,
  setBlockField,
  setColumnCount,
  setColumnsRatio,
  addColumnChild,
  removeColumnChild,
  moveColumnChild,
  moveColumnChildTo,
  setColumnChildField,
  setField,
  setInstanceField,
  setInstanceRepeat,
  setInstanceStyle,
  setRegionInstanceField,
  setRegionInstanceRepeat,
  setRegionInstanceStyle,
  setRepeatRows,
  setSectionOrder,
  setThemeToken,
  clearThemeOverrides,
  toggleInstanceHidden,
  toggleRegionInstanceHidden,
  toggleSectionHidden,
  type InstanceLoc,
  type ThemeTokenGroup,
  type TypeChange,
} from "../state/mutations.js";
import type { RegionName } from "@pcms/shared";
import {
  blockPartTemplate,
  mergeThemeConfig,
  parseSectionSchema,
  sectionBlockTypes,
  setSectionBlocks,
  isColumnsBlock,
} from "@pcms/engine";
import { SectionFields } from "./SectionFields.js";
import { renderPreview, schemaForPage } from "../preview/render.js";
import { MediaContext, useMediaLibrary } from "../media/MediaContext.js";
import { Toolbar } from "./Toolbar.js";
import { SectionList, type SectionRow } from "./SectionList.js";
import { Preview } from "./Preview.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { SectionCanvas, type InstanceRow } from "./SectionCanvas.js";
import { BlockManager, BlockSettings, EnableBlocksPrompt } from "./BlockPanel.js";
import { ColumnsManager } from "./ColumnsManager.js";
import { ThemeStylePanel } from "./ThemeStylePanel.js";
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
  const {
    api,
    project,
    doc,
    commit,
    undo,
    redo,
    canUndo,
    canRedo,
    dirty,
    setDirty,
    save: onSave,
    reloadProject,
  } = useSiteWorkspace();
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
  // A nested block selected inside the selected section (null = the section itself).
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  // Where a new block will be inserted (section + index), while the picker is open.
  const [blockInsertAt, setBlockInsertAt] = useState<
    { scope: Scope; section: string; index: number } | null
  >(null);
  // The site-wide theme style panel (colors / fonts / spacing) is open.
  const [themeStyleOpen, setThemeStyleOpen] = useState(false);
  // A swap picker is open: for a placed section, or a placed nested block.
  const [swapAt, setSwapAt] = useState<{ scope: Scope; section: string } | null>(null);
  const [blockSwapAt, setBlockSwapAt] = useState<
    { scope: Scope; section: string; block: string } | null
  >(null);
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

  // Nested blocks: the theme's block templates (`blocks/<type>`) parsed into
  // schemas, and the allow-list a section declares via its `data-blocks`.
  const blockSchemaByType = useMemo(() => {
    const m = new Map<string, SectionSchema>();
    for (const [type, html] of Object.entries(project?.theme.blocks ?? {})) {
      m.set(type, parseSectionSchema(type, html));
    }
    return m;
  }, [project]);

  const blockTypesForSection = useCallback(
    (sectionType: string): string[] => {
      const html = project?.theme.sections?.[sectionType];
      const allowed = html ? sectionBlockTypes(html) : null;
      if (allowed == null) return []; // section has no blocks container
      const all = [...blockSchemaByType.keys()];
      return allowed.length === 0 ? all : allowed.filter((t) => blockSchemaByType.has(t));
    },
    [project, blockSchemaByType],
  );

  // The page body is "composed" when it has an instances list (vs a fixed
  // template). Header/footer always use the composed region model.
  const pageComposed = target?.kind === "page" && page.instances != null;
  // A page can override the shared header/footer with its own. When it does,
  // the region editor reads and writes that page's regions (via `regionPageId`,
  // threaded into the region mutations) instead of the site-wide ones.
  const pageOverridesRegions = target?.kind === "page" && page.regions != null;
  const regionPageId = pageOverridesRegions ? pageId : undefined;
  const regions = pageOverridesRegions ? page.regions : doc.settings.regions;
  const hasRegions = regions != null;
  // Resolve the active region store from a settings object (page override or
  // site-wide), for re-reads right after a region mutation.
  const regionsOf = useCallback(
    (s: SiteSettings) => (regionPageId != null ? s.pages[regionPageId]?.regions : s.regions),
    [regionPageId],
  );

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

  // Block types this section accepts (empty = the section has no block container).
  const sectionBlockCatalog: { type: string; label: string }[] = selectedInstance
    ? blockTypesForSection(selectedInstance.type).map((type) => ({
        type,
        label: blockSchemaByType.get(type)?.label ?? type,
      }))
    : [];
  const sectionSupportsBlocks = sectionBlockCatalog.length > 0;
  const selectedBlock: BlockInstance | null =
    (selectedBlockId && selectedInstance?.blocks?.find((b) => b.id === selectedBlockId)) || null;
  const selectedBlockSchema = selectedBlock
    ? blockSchemaByType.get(selectedBlock.type) ?? null
    : null;

  // Whether a block type is a layout (columns) block — its template root has a
  // `data-columns` container, so it holds child blocks instead of fields.
  const isLayoutType = useCallback(
    (type: string): boolean => isColumnsBlock(project?.theme.blocks?.[type] ?? ""),
    [project],
  );
  const selectedBlockIsLayout = selectedBlock ? isLayoutType(selectedBlock.type) : false;
  // Block types that can go inside a column: the section's allowed blocks minus
  // layout blocks (no columns-in-columns).
  const columnChildCatalog = selectedInstance
    ? blockTypesForSection(selectedInstance.type)
        .filter((type) => !isLayoutType(type))
        .map((type) => ({ type, label: blockSchemaByType.get(type)?.label ?? type }))
    : [];

  // Where the currently-edited section instance lives, for block mutations.
  const locFor = useCallback(
    (scope: Scope): InstanceLoc =>
      scope === "body"
        ? { kind: "body", pageId }
        : { kind: "region", region: scope, pageId: regionPageId },
    [pageId, regionPageId],
  );

  // The inline (on-preview) editor is showing — collapse the right panel. When
  // a nested block is selected, the right panel shows the block instead.
  const inlineActive = Boolean(
    activeComposed &&
      selectedInstance &&
      selectedInstanceSchema &&
      anchor &&
      inlineOpen &&
      !selectedBlockId &&
      !themeStyleOpen,
  );

  // Selecting a section (from a list or the preview) opens its inline card.
  const onSelectSection = useCallback((id: string | null) => {
    setSelectedId(id);
    setSelectedBlockId(null);
    if (id) setInlineOpen(true);
  }, []);

  // Scope-aware builders: route a mutation to the page body or a region.
  const buildToggle = (s: Scope, id: string) =>
    s === "body"
      ? toggleInstanceHidden(doc.settings, pageId, id)
      : toggleRegionInstanceHidden(doc.settings, s, id, regionPageId);
  const buildMove = (s: Scope, from: number, to: number) =>
    s === "body"
      ? moveInstance(doc.settings, pageId, from, to)
      : moveRegionInstance(doc.settings, s, from, to, regionPageId);
  const buildRemove = (s: Scope, id: string) =>
    s === "body"
      ? removeInstance(doc.settings, pageId, id)
      : removeRegionInstance(doc.settings, s, id, regionPageId);
  const buildAdd = (s: Scope, type: string, at?: number) =>
    s === "body"
      ? addInstance(doc.settings, pageId, type, at)
      : addRegionInstance(doc.settings, s, type, at, regionPageId);
  const buildDuplicate = (s: Scope, id: string) =>
    s === "body"
      ? duplicateInstance(doc.settings, pageId, id)
      : duplicateRegionInstance(doc.settings, s, id, regionPageId);
  const buildPaste = (s: Scope, snap: SectionInstance) =>
    s === "body"
      ? pasteInstance(doc.settings, pageId, snap)
      : pasteRegionInstance(doc.settings, s, snap, undefined, regionPageId);

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
      const list = scope === "body" ? settings.pages[pageId]?.instances ?? [] : regionsOf(settings)?.[scope] ?? [];
      const added = list[at ?? list.length - 1];
      setEditScope(scope);
      if (added) setSelectedId(added.id);
      setDirty(true);
    },
    [commit, doc, pageId, editScope, regionsOf],
  );

  const onInstanceField = useCallback(
    (path: string, value: string) => {
      if (!selectedId) return;
      const next =
        editScope === "body"
          ? setInstanceField(doc.settings, pageId, selectedId, path, value)
          : setRegionInstanceField(doc.settings, editScope, selectedId, path, value, regionPageId);
      commit({ ...doc, settings: next }, `inst:${editScope}:${selectedId}:${path}`);
      setDirty(true);
    },
    [commit, doc, pageId, selectedId, editScope, regionPageId],
  );

  const onInstanceRepeat = useCallback(
    (name: string, rows: Row[]) => {
      if (!selectedId) return;
      const next =
        editScope === "body"
          ? setInstanceRepeat(doc.settings, pageId, selectedId, name, rows)
          : setRegionInstanceRepeat(doc.settings, editScope, selectedId, name, rows, regionPageId);
      commit({ ...doc, settings: next }, `instrep:${editScope}:${selectedId}:${name}`);
      setDirty(true);
    },
    [commit, doc, pageId, selectedId, editScope, regionPageId],
  );

  const onCopyInstance = useCallback(() => {
    if (selectedInstance) setClipboard(selectedInstance);
  }, [selectedInstance]);

  const onPasteInstance = useCallback(
    (scope: Scope = editScope) => {
      if (!clipboard) return;
      const settings = buildPaste(scope, clipboard);
      commit({ ...doc, settings });
      const list = scope === "body" ? settings.pages[pageId]?.instances ?? [] : regionsOf(settings)?.[scope] ?? [];
      const added = list[list.length - 1];
      setEditScope(scope);
      if (added) setSelectedId(added.id);
      setDirty(true);
    },
    [clipboard, doc, pageId, commit, setDirty, editScope, regionsOf],
  );

  const onInstanceStyle = useCallback(
    (patch: Partial<SectionStyle>) => {
      if (!selectedId) return;
      const next =
        editScope === "body"
          ? setInstanceStyle(doc.settings, pageId, selectedId, patch)
          : setRegionInstanceStyle(doc.settings, editScope, selectedId, patch, regionPageId);
      commit({ ...doc, settings: next }, `inststyle:${editScope}:${selectedId}`);
      setDirty(true);
    },
    [commit, doc, pageId, selectedId, editScope, setDirty, regionPageId],
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
        next = setRegionInstanceField(doc.settings, scope, section, field, value, regionPageId);
      } else if (pageComposed && section) {
        next = setInstanceField(doc.settings, pageId, section, field, value);
      } else {
        next = setField(doc.settings, pageId, field, value);
      }
      commit({ ...doc, settings: next }, key);
      setDirty(true);
    },
    [commit, doc, pageId, pageComposed, regionPageId],
  );

  // --- Nested blocks (within a section instance) ---------------------------

  const blocksOf = useCallback(
    (scope: Scope, sectionId: string): BlockInstance[] => {
      const list =
        scope === "body"
          ? doc.settings.pages[pageId]?.instances ?? []
          : regionsOf(doc.settings)?.[scope] ?? [];
      return list.find((i) => i.id === sectionId)?.blocks ?? [];
    },
    [doc, pageId, regionsOf],
  );

  const onSelectBlock = useCallback((sectionId: string, blockId: string | null) => {
    setSelectedId(sectionId);
    setSelectedBlockId(blockId);
    if (blockId) setInlineOpen(false);
  }, []);

  const onAddBlock = useCallback(
    (scope: Scope, sectionId: string, type: string, at?: number) => {
      // A layout (columns) block starts with two empty columns.
      const seed = isLayoutType(type) ? 2 : undefined;
      const settings = addBlock(doc.settings, locFor(scope), sectionId, type, at, seed);
      commit({ ...doc, settings });
      const list =
        (scope === "body" ? settings.pages[pageId]?.instances : regionsOf(settings)?.[scope])?.find(
          (i) => i.id === sectionId,
        )?.blocks ?? [];
      const added = list[at ?? list.length - 1];
      setEditScope(scope);
      setSelectedId(sectionId);
      if (added) setSelectedBlockId(added.id);
      setDirty(true);
    },
    [commit, doc, pageId, locFor, isLayoutType, regionsOf],
  );

  // --- Column mutations for a selected layout (columns) block ----------------
  const onColumnCount = useCallback(
    (sectionId: string, blockId: string, count: number) => {
      commit({ ...doc, settings: setColumnCount(doc.settings, locFor(editScope), sectionId, blockId, count) });
      setDirty(true);
    },
    [commit, doc, locFor, editScope],
  );
  const onColumnRatio = useCallback(
    (sectionId: string, blockId: string, ratio: string) => {
      commit({ ...doc, settings: setColumnsRatio(doc.settings, locFor(editScope), sectionId, blockId, ratio) });
      setDirty(true);
    },
    [commit, doc, locFor, editScope],
  );
  const onColumnAddChild = useCallback(
    (sectionId: string, blockId: string, col: number, type: string) => {
      commit({ ...doc, settings: addColumnChild(doc.settings, locFor(editScope), sectionId, blockId, col, type) });
      setDirty(true);
    },
    [commit, doc, locFor, editScope],
  );
  const onColumnChildOp = useCallback(
    (sectionId: string, blockId: string, col: number, childId: string, op: "up" | "down" | "del") => {
      const loc = locFor(editScope);
      const inst = listFor(editScope).find((i) => i.id === sectionId);
      const children = inst?.blocks?.find((b) => b.id === blockId)?.columns?.[col] ?? [];
      const from = children.findIndex((c) => c.id === childId);
      if (from < 0) return;
      let settings;
      if (op === "up") settings = moveColumnChild(doc.settings, loc, sectionId, blockId, col, from, from - 1);
      else if (op === "down") settings = moveColumnChild(doc.settings, loc, sectionId, blockId, col, from, from + 1);
      else settings = removeColumnChild(doc.settings, loc, sectionId, blockId, col, childId);
      commit({ ...doc, settings });
      setDirty(true);
    },
    [commit, doc, locFor, editScope, listFor],
  );
  const onColumnChildMove = useCallback(
    (sectionId: string, blockId: string, fromCol: number, fromIndex: number, toCol: number, toIndex: number) => {
      if (fromCol === toCol && (toIndex === fromIndex || toIndex === fromIndex + 1)) return; // no-op drop
      commit({
        ...doc,
        settings: moveColumnChildTo(doc.settings, locFor(editScope), sectionId, blockId, fromCol, fromIndex, toCol, toIndex),
      });
      setDirty(true);
    },
    [commit, doc, locFor, editScope],
  );
  const onColumnChildField = useCallback(
    (sectionId: string, blockId: string, col: number, childId: string, path: string, value: string) => {
      commit(
        { ...doc, settings: setColumnChildField(doc.settings, locFor(editScope), sectionId, blockId, col, childId, path, value) },
        `col:${editScope}:${sectionId}:${blockId}:${col}:${childId}:${path}`,
      );
      setDirty(true);
    },
    [commit, doc, locFor, editScope],
  );

  const onBlockOp = useCallback(
    (scope: Scope, sectionId: string, blockId: string, op: string) => {
      const list = blocksOf(scope, sectionId);
      const from = list.findIndex((b) => b.id === blockId);
      if (from < 0) return;
      const loc = locFor(scope);
      let settings;
      if (op === "up") settings = moveBlock(doc.settings, loc, sectionId, from, from - 1);
      else if (op === "down") settings = moveBlock(doc.settings, loc, sectionId, from, from + 1);
      else if (op === "dup") settings = duplicateBlock(doc.settings, loc, sectionId, blockId);
      else if (op === "del") settings = removeBlock(doc.settings, loc, sectionId, blockId);
      else return;
      commit({ ...doc, settings });
      if (op === "del") setSelectedBlockId((cur) => (cur === blockId ? null : cur));
      setDirty(true);
    },
    [commit, doc, locFor, blocksOf],
  );

  // Drag-reorder a block within its section. `toIndex` is the gap the block was
  // dropped on; dropping below its current slot shifts the target left by one
  // (the block is removed before it is re-inserted) — same as section drag.
  const onBlockMove = useCallback(
    (scope: Scope, sectionId: string, blockId: string, toIndex: number) => {
      const list = blocksOf(scope, sectionId);
      const from = list.findIndex((b) => b.id === blockId);
      if (from < 0) return;
      const to = toIndex > from ? toIndex - 1 : toIndex;
      if (to === from) return;
      commit({ ...doc, settings: moveBlock(doc.settings, locFor(scope), sectionId, from, to) });
      setDirty(true);
    },
    [commit, doc, locFor, blocksOf],
  );

  const applyBlockFieldEdit = useCallback(
    (scope: Scope, section: string, block: string, field: string, value: string, key?: string) => {
      const settings = setBlockField(doc.settings, locFor(scope), section, block, field, value);
      commit({ ...doc, settings }, key);
      setDirty(true);
    },
    [commit, doc, locFor],
  );

  const onBlockField = useCallback(
    (path: string, value: string) => {
      if (!selectedId || !selectedBlockId) return;
      applyBlockFieldEdit(
        editScope,
        selectedId,
        selectedBlockId,
        path,
        value,
        `block:${editScope}:${selectedId}:${selectedBlockId}:${path}`,
      );
    },
    [applyBlockFieldEdit, selectedId, selectedBlockId, editScope],
  );

  // Make a section type accept parts: add a `data-blocks` slot (allow any) to
  // its theme template, in the working copy. Applies to all sections of this
  // type; after reload the BlockManager appears for it.
  const onEnableSectionParts = useCallback(
    (sectionType: string) => {
      const html = project?.theme.sections?.[sectionType];
      if (html == null) return;
      void api.writeThemeFile(`sections/${sectionType}.html`, setSectionBlocks(html, [])).then(() => {
        reloadProject();
      });
    },
    [api, project, reloadProject],
  );

  // Author a brand-new block part (blocks/<type>.html), add it to the section's
  // allow-list when the section restricts types, then place one in the section.
  const onCreateBlockPart = useCallback(
    (scope: Scope, sectionId: string, rawName: string, at?: number) => {
      const type = safePartName(rawName);
      if (!type || project == null) return;
      const secType = listFor(scope).find((i) => i.id === sectionId)?.type ?? "";
      const secHtml = project.theme.sections?.[secType];
      const writes: Promise<void>[] = [];
      if (project.theme.blocks?.[type] == null) {
        writes.push(api.writeThemeFile(`blocks/${type}.html`, blockPartTemplate(type, rawName.trim())));
      }
      const allowed = secHtml ? sectionBlockTypes(secHtml) : null;
      if (secHtml && allowed != null && allowed.length > 0 && !allowed.includes(type)) {
        writes.push(
          api.writeThemeFile(`sections/${secType}.html`, setSectionBlocks(secHtml, [...allowed, type])),
        );
      }
      void Promise.all(writes).then(() => {
        reloadProject();
        onAddBlock(scope, sectionId, type, at);
      });
    },
    [api, project, listFor, reloadProject, onAddBlock],
  );

  // --- Swap a placed section / block to another part (in-place type change) --
  // The instance keeps its id (position, selection); values are carried over
  // where the new part still has a place for them (see changeInstanceType).

  const onSwapSection = useCallback(
    (scope: Scope, sectionId: string, newType: string) => {
      const schema = schemaByType.get(newType);
      const secHtml = project?.theme.sections?.[newType];
      const change: TypeChange = {
        type: newType,
        fieldPaths: schema ? schema.fields.map((f) => f.path) : [],
        repeatNames: schema ? schema.repeats.map((r) => r.name) : [],
        blockTypes: secHtml ? sectionBlockTypes(secHtml) : null,
      };
      commit({ ...doc, settings: changeInstanceType(doc.settings, locFor(scope), sectionId, change) });
      setEditScope(scope);
      setSelectedId(sectionId);
      setSelectedBlockId(null);
      setDirty(true);
    },
    [commit, doc, project, schemaByType, locFor, setDirty],
  );

  const onSwapBlock = useCallback(
    (scope: Scope, sectionId: string, blockId: string, newType: string) => {
      const schema = blockSchemaByType.get(newType);
      const paths = schema ? schema.fields.map((f) => f.path) : [];
      commit({
        ...doc,
        settings: changeBlockType(doc.settings, locFor(scope), sectionId, blockId, newType, paths),
      });
      setEditScope(scope);
      setSelectedId(sectionId);
      setSelectedBlockId(blockId);
      setDirty(true);
    },
    [commit, doc, blockSchemaByType, locFor, setDirty],
  );

  // --- Site-wide theme style (colors / fonts / spacing) --------------------
  // Overrides live in settings.theme and are merged over the theme's presets.
  // The live preview re-renders from doc.settings.theme, so edits show at once.

  const effectiveTheme = useMemo(
    () => mergeThemeConfig(project?.theme.config, doc.settings.theme),
    [project, doc.settings.theme],
  );

  const onThemeToken = useCallback(
    (group: ThemeTokenGroup, key: string, value: string) => {
      commit(
        { ...doc, settings: setThemeToken(doc.settings, group, key, value) },
        `theme:${group}:${key}`,
      );
      setDirty(true);
    },
    [commit, doc],
  );

  const onThemeReset = useCallback(() => {
    commit({ ...doc, settings: clearThemeOverrides(doc.settings) });
    setDirty(true);
  }, [commit, doc]);

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
    setSelectedBlockId(null);
    setEditScope("body");
  }, []);

  // Clear the selection when switching the edit scope — ids don't cross lists.
  const onSelectScope = useCallback((scope: Scope) => {
    setEditScope(scope);
    setSelectedId(null);
    setSelectedBlockId(null);
  }, []);

  // Toggle this page's own header/footer. On: seed the override from the
  // site-wide regions so the page starts identical, then edits stay on the page.
  // Off: drop the override and fall back to the shared header/footer. Either way
  // the body selection is cleared (the region lists it referenced just changed).
  const onTogglePageRegions = useCallback(() => {
    if (target?.kind !== "page") return;
    const next = pageOverridesRegions
      ? disablePageRegions(doc.settings, pageId)
      : enablePageRegions(doc.settings, pageId);
    commit({ ...doc, settings: next });
    setSelectedId(null);
    setSelectedBlockId(null);
    setDirty(true);
  }, [target, pageOverridesRegions, doc, pageId, commit]);

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
            block?: string | null;
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
          // A block click selects the block; a section click clears the block.
          setSelectedBlockId(d.block ?? null);
          setInlineOpen(!d.block);
        }
        return;
      }
      if (d.type === "blockop" && d.section && d.id && d.op) {
        onBlockOp(region, d.section, d.id, d.op);
        return;
      }
      if (d.type === "blockmove" && d.section && d.id && d.toIndex != null) {
        onBlockMove(region, d.section, d.id, d.toIndex);
        return;
      }
      if (d.type === "blockinsert" && d.section && d.index != null) {
        setEditScope(region);
        setSelectedId(d.section);
        setBlockInsertAt({ scope: region, section: d.section, index: d.index });
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
          setSelectedBlockId(d.block ?? null);
        }
        setFocusTarget(
          d.block
            ? `inst-${d.block}-${d.field}`
            : regionComposed
              ? `inst-${d.section}-${d.field}`
              : `field-${d.field}`,
        );
        return;
      }
      if (d.type === "edit" && d.field) {
        if (d.block && d.section) {
          applyBlockFieldEdit(
            region,
            d.section,
            d.block,
            d.field,
            d.value ?? "",
            `blockedit:${region}:${d.section}:${d.block}:${d.field}`,
          );
        } else {
          applyFieldEdit(region, d.section, d.field, d.value ?? "", `edit:${region}:${d.section}:${d.field}`);
        }
        return;
      }
      if (d.type === "pickimage" && d.field) {
        const section = d.section;
        const block = d.block;
        const field = d.field;
        void mediaLib.value.pickImage().then((path) => {
          if (!path) return;
          if (block && section) applyBlockFieldEdit(region, section, block, field, path);
          else applyFieldEdit(region, section, field, path);
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
    onBlockOp,
    onBlockMove,
    applyFieldEdit,
    applyBlockFieldEdit,
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

  // The nested-parts area under a selected section: the block manager when the
  // section accepts parts, else a prompt to make it accept parts. Reused by the
  // inline card and the right-hand settings panel.
  const blocksArea: ReactNode = selectedInstance ? (
    sectionSupportsBlocks ? (
      <BlockManager
        blocks={selectedInstance.blocks ?? []}
        schemaByType={blockSchemaByType}
        selectedBlockId={selectedBlockId}
        onSelect={(blockId) => onSelectBlock(selectedInstance.id, blockId)}
        onOp={(blockId, op) => onBlockOp(editScope, selectedInstance.id, blockId, op)}
        onMove={(blockId, toIndex) => onBlockMove(editScope, selectedInstance.id, blockId, toIndex)}
        onAddClick={() =>
          setBlockInsertAt({
            scope: editScope,
            section: selectedInstance.id,
            index: selectedInstance.blocks?.length ?? 0,
          })
        }
      />
    ) : (
      <EnableBlocksPrompt onEnable={() => onEnableSectionParts(selectedInstance.type)} />
    )
  ) : null;

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
          onThemeStyle={() => {
            setThemeStyleOpen(true);
            setInlineOpen(false);
          }}
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
            {doc.settings.regions != null && (
              <label className="pcms-page-regions-toggle">
                <input
                  type="checkbox"
                  checked={pageOverridesRegions}
                  onChange={onTogglePageRegions}
                />
                <span>{t("region.pageOverride")}</span>
              </label>
            )}
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
                onSwap={() => setSwapAt({ scope: editScope, section: selectedInstance.id })}
                blocks={blocksArea}
              />
            ) : null
          }
        />

        {themeStyleOpen ? (
          <ThemeStylePanel
            theme={effectiveTheme}
            overridden={doc.settings.theme != null}
            onToken={onThemeToken}
            onReset={onThemeReset}
            onClose={() => setThemeStyleOpen(false)}
          />
        ) : inlineActive ? null : target.kind === "page" && activeComposed ? (
          selectedBlock && selectedBlockSchema ? (
            <BlockSettings
              block={selectedBlock}
              schema={selectedBlockSchema}
              onFieldChange={onBlockField}
              onBack={() => setSelectedBlockId(null)}
              onSwap={() =>
                setBlockSwapAt({
                  scope: editScope,
                  section: selectedInstance!.id,
                  block: selectedBlock.id,
                })
              }
              layout={
                selectedBlockIsLayout ? (
                  <ColumnsManager
                    block={selectedBlock}
                    childSchemaByType={blockSchemaByType}
                    childCatalog={columnChildCatalog}
                    onCount={(n) => onColumnCount(selectedInstance!.id, selectedBlock.id, n)}
                    onRatio={(r) => onColumnRatio(selectedInstance!.id, selectedBlock.id, r)}
                    onAddChild={(col, type) =>
                      onColumnAddChild(selectedInstance!.id, selectedBlock.id, col, type)
                    }
                    onChildOp={(col, childId, op) =>
                      onColumnChildOp(selectedInstance!.id, selectedBlock.id, col, childId, op)
                    }
                    onChildField={(col, childId, path, value) =>
                      onColumnChildField(selectedInstance!.id, selectedBlock.id, col, childId, path, value)
                    }
                    onChildMove={(fromCol, fromIndex, toCol, toIndex) =>
                      onColumnChildMove(selectedInstance!.id, selectedBlock.id, fromCol, fromIndex, toCol, toIndex)
                    }
                  />
                ) : undefined
              }
            />
          ) : selectedInstance ? (
            <aside className="pcms-settings">
              <div className="pcms-settings__titlerow">
                <h2 className="pcms-col__title">
                  {t("settings.title")}：{selectedInstanceSchema?.label ?? selectedInstance.type}
                </h2>
                <button
                  type="button"
                  className="pcms-swapbtn"
                  onClick={() => setSwapAt({ scope: editScope, section: selectedInstance.id })}
                  title={t("swap.section")}
                >
                  ⇄ {t("swap.short")}
                </button>
              </div>
              {selectedInstanceSchema && (
                <SectionFields
                  schema={selectedInstanceSchema}
                  instance={selectedInstance}
                  onFieldChange={onInstanceField}
                  onRepeatChange={onInstanceRepeat}
                  onStyleChange={onInstanceStyle}
                />
              )}
              {blocksArea}
            </aside>
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
      {blockInsertAt != null && (
        <AddSectionModal
          heading={t("block.pick")}
          emptyHint={t("block.noneYet")}
          catalog={blockTypesForSection(
            listFor(blockInsertAt.scope).find((i) => i.id === blockInsertAt.section)?.type ?? "",
          ).map((type) => ({ type, label: blockSchemaByType.get(type)?.label ?? type }))}
          onPick={(type) => {
            onAddBlock(blockInsertAt.scope, blockInsertAt.section, type, blockInsertAt.index);
            setBlockInsertAt(null);
          }}
          onCreateNew={(name) => {
            onCreateBlockPart(blockInsertAt.scope, blockInsertAt.section, name, blockInsertAt.index);
            setBlockInsertAt(null);
          }}
          onClose={() => setBlockInsertAt(null)}
        />
      )}
      {swapAt != null &&
        (() => {
          const curType = listFor(swapAt.scope).find((i) => i.id === swapAt.section)?.type;
          return (
            <AddSectionModal
              heading={t("swap.pickSection")}
              emptyHint={t("swap.none")}
              catalog={catalog
                .filter((c) => c.id !== curType)
                .map((c) => ({ type: c.id, label: c.label ?? c.id }))}
              onPick={(type) => {
                onSwapSection(swapAt.scope, swapAt.section, type);
                setSwapAt(null);
              }}
              onClose={() => setSwapAt(null)}
            />
          );
        })()}
      {blockSwapAt != null &&
        (() => {
          const section = listFor(blockSwapAt.scope).find((i) => i.id === blockSwapAt.section);
          const curType = section?.blocks?.find((b) => b.id === blockSwapAt.block)?.type;
          return (
            <AddSectionModal
              heading={t("swap.pickBlock")}
              emptyHint={t("swap.none")}
              catalog={blockTypesForSection(section?.type ?? "")
                .filter((ty) => ty !== curType)
                .map((ty) => ({ type: ty, label: blockSchemaByType.get(ty)?.label ?? ty }))}
              onPick={(type) => {
                onSwapBlock(blockSwapAt.scope, blockSwapAt.section, blockSwapAt.block, type);
                setBlockSwapAt(null);
              }}
              onClose={() => setBlockSwapAt(null)}
            />
          );
        })()}
    </MediaContext.Provider>
  );
}

/** A filesystem-safe part name (matches the code view's safeName). */
function safePartName(raw: string): string {
  return raw.trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase();
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
