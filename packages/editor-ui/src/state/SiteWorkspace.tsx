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
  children: ReactNode;
}

export function SiteWorkspaceProvider({ api, siteId, children }: ProviderProps) {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [dirty, setDirty] = useState(false);
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

  const save = useCallback(() => {
    void Promise.all([
      api.saveDraft(doc.settings),
      api.saveContent(doc.content),
      api.saveContentTypes(doc.contentTypes),
      api.saveMenus(doc.menus),
      api.saveTaxonomies(doc.taxonomies),
    ]).then(() => setDirty(false));
  }, [api, doc]);

  if (!project) {
    return <div className="pcms-loading">読み込み中…</div>;
  }

  const value: SiteWorkspace = {
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
    save,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
