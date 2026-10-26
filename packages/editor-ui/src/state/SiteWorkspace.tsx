import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { PcmsApi, ProjectData } from "../api/types.js";
import { useEditorHistory } from "./history.js";
import { initialState, type EditorState } from "./editorState.js";

const EMPTY_STATE: EditorState = {
  site: { name: "" },
  settings: { pages: {} },
  content: [],
  contentTypes: [],
  menus: {},
  taxonomies: [],
};

/**
 * One open site's shared state: the loaded project plus the editable document
 * (history-backed) and save. Content views (posts/pages/settings) and the
 * visual theme editor all read and write the same workspace, so a site has a
 * single source of truth. `commit` does not set `dirty` on its own — callers
 * pair it with `setDirty(true)`, matching the existing editor handlers.
 */
export interface SiteWorkspace {
  api: PcmsApi;
  project: ProjectData;
  doc: EditorState;
  commit: (next: EditorState, label?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  setDirty: (value: boolean) => void;
  save: () => void;
  /** Re-fetch the project (e.g. after editing theme files), refreshing the
   *  section catalog and preview base without touching the editable document. */
  reloadProject: () => void;
}

const Ctx = createContext<SiteWorkspace | null>(null);

export function useSiteWorkspace(): SiteWorkspace {
  const value = useContext(Ctx);
  if (!value) throw new Error("useSiteWorkspace must be used within a SiteWorkspaceProvider");
  return value;
}

interface ProviderProps {
  api: PcmsApi;
  /** Site id — remount (via key) to load a different site. */
  siteId: string;
  /** Report unsaved state up to the shell (for a leave-site navigation guard). */
  onDirtyChange?: (dirty: boolean) => void;
  children: ReactNode;
}

export function SiteWorkspaceProvider({ api, siteId, onDirtyChange, children }: ProviderProps) {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // On unmount the document (and its unsaved edits) go away, so clear the flag.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const { doc, commit, undo, redo, reset, canUndo, canRedo } =
    useEditorHistory<EditorState>(EMPTY_STATE);

  useEffect(() => {
    let active = true;
    void api.loadProject().then((data) => {
      if (!active) return;
      setProject(data);
      reset(initialState(data));
      setDirty(false);
    });
    return () => {
      active = false;
    };
    // siteId is in deps so switching sites reloads (the provider is also keyed).
  }, [api, siteId, reset]);

  const reloadProject = useCallback(() => {
    void api.loadProject().then(setProject);
  }, [api]);

  const save = useCallback(() => {
    void Promise.all([
      api.saveSite(doc.site),
      api.saveDraft(doc.settings),
      api.saveContent(doc.content),
      api.saveContentTypes(doc.contentTypes),
      api.saveMenus(doc.menus),
      api.saveTaxonomies(doc.taxonomies),
    ]).then(() => setDirty(false));
  }, [api, doc]);

  // Undo/redo move the document away from what was last saved, so they mark the
  // workspace dirty (callers already guard on canUndo/canRedo).
  const undoDirty = useCallback(() => {
    undo();
    setDirty(true);
  }, [undo]);
  const redoDirty = useCallback(() => {
    redo();
    setDirty(true);
  }, [redo]);

  if (!project) {
    return <div className="pcms-loading">読み込み中…</div>;
  }

  const value: SiteWorkspace = {
    api,
    project,
    doc,
    commit,
    undo: undoDirty,
    redo: redoDirty,
    canUndo,
    canRedo,
    dirty,
    setDirty,
    save,
    reloadProject,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
