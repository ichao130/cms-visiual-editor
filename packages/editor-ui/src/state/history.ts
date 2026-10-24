import { useCallback, useMemo, useReducer } from "react";

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  /** Coalescing key of the last commit, so rapid edits to one field merge. */
  lastKey: string | null;
}

type Action<T> =
  | { type: "reset"; doc: T }
  | { type: "commit"; doc: T; key: string | null }
  | { type: "undo" }
  | { type: "redo" };

function reducer<T>(state: HistoryState<T>, action: Action<T>): HistoryState<T> {
  switch (action.type) {
    case "reset":
      return { past: [], present: action.doc, future: [], lastKey: null };
    case "commit": {
      // Merge consecutive edits with the same key into one undo step.
      if (action.key != null && action.key === state.lastKey) {
        return { ...state, present: action.doc };
      }
      return {
        past: [...state.past, state.present],
        present: action.doc,
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

export interface EditorHistory<T> {
  doc: T;
  canUndo: boolean;
  canRedo: boolean;
  /** Replace the document, pushing an undo step (coalesced when key repeats). */
  commit: (doc: T, key?: string) => void;
  undo: () => void;
  redo: () => void;
  reset: (doc: T) => void;
}

export function useEditorHistory<T>(initial: T): EditorHistory<T> {
  const [state, dispatch] = useReducer(reducer<T>, {
    past: [],
    present: initial,
    future: [],
    lastKey: null,
  });

  const commit = useCallback(
    (doc: T, key?: string) => dispatch({ type: "commit", doc, key: key ?? null }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const reset = useCallback((doc: T) => dispatch({ type: "reset", doc }), []);

  return useMemo(
    () => ({
      doc: state.present,
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
