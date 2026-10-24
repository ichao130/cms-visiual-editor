import { useCallback, useMemo, useReducer } from "react";
import type { SiteSettings } from "@pcms/shared";

interface HistoryState {
  past: SiteSettings[];
  present: SiteSettings;
  future: SiteSettings[];
  /** Coalescing key of the last commit, so rapid edits to one field merge. */
  lastKey: string | null;
}

type Action =
  | { type: "reset"; settings: SiteSettings }
  | { type: "commit"; settings: SiteSettings; key: string | null }
  | { type: "undo" }
  | { type: "redo" };

function reducer(state: HistoryState, action: Action): HistoryState {
  switch (action.type) {
    case "reset":
      return { past: [], present: action.settings, future: [], lastKey: null };
    case "commit": {
      // Merge consecutive edits with the same key into one undo step.
      if (action.key != null && action.key === state.lastKey) {
        return { ...state, present: action.settings };
      }
      return {
        past: [...state.past, state.present],
        present: action.settings,
        future: [],
        lastKey: action.key,
      };
    }
    case "undo": {
      const prev = state.past.at(-1);
      if (prev === undefined) return state;
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
        lastKey: null,
      };
    }
    case "redo": {
      const next = state.future[0];
      if (next === undefined) return state;
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        lastKey: null,
      };
    }
  }
}

export interface EditorHistory {
  settings: SiteSettings;
  canUndo: boolean;
  canRedo: boolean;
  /** Replace settings, pushing an undo step (or coalescing when key repeats). */
  commit: (settings: SiteSettings, key?: string) => void;
  undo: () => void;
  redo: () => void;
  reset: (settings: SiteSettings) => void;
}

export function useEditorHistory(initial: SiteSettings): EditorHistory {
  const [state, dispatch] = useReducer(reducer, {
    past: [],
    present: initial,
    future: [],
    lastKey: null,
  });

  const commit = useCallback(
    (settings: SiteSettings, key?: string) =>
      dispatch({ type: "commit", settings, key: key ?? null }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const reset = useCallback(
    (settings: SiteSettings) => dispatch({ type: "reset", settings }),
    [],
  );

  return useMemo(
    () => ({
      settings: state.present,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      commit,
      undo,
      redo,
      reset,
    }),
    [state, commit, undo, redo, reset],
  );
}
