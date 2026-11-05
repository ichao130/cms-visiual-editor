import { useRef, useState, type DragEvent } from "react";

/** Move the item at `from` so it lands at index `to` (both in the original list). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export interface DragReorder {
  /** Spread on the drag handle (a grip): starts/ends the drag. */
  handleProps: (index: number) => {
    draggable: true;
    onDragStart: (e: DragEvent) => void;
    onDragEnd: () => void;
  };
  /** Spread on each row (the drop zone): accepts the dragged item. */
  zoneProps: (index: number) => {
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    "data-dragging": true | undefined;
    "data-dragover": true | undefined;
  };
  /** The index currently being dragged, or null. */
  dragging: number | null;
}

/**
 * Minimal, dependency-free drag-and-drop list reordering (CLAUDE.md: 新しい依存
 * は入れない). The drag starts from a dedicated handle so text selection inside
 * a row's inputs is never hijacked; each row is a drop zone. The caller applies
 * the move with `moveItem` and keeps its own arrow buttons — this only adds the
 * drag half, so every reorderable list offers 矢印＋ドラッグの両方.
 */
export function useDragReorder(onReorder: (from: number, to: number) => void): DragReorder {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const fromRef = useRef<number | null>(null);

  const reset = () => {
    fromRef.current = null;
    setDragging(null);
    setOver(null);
  };

  return {
    handleProps: (index) => ({
      draggable: true,
      onDragStart: (e) => {
        fromRef.current = index;
        setDragging(index);
        e.dataTransfer.effectAllowed = "move";
        // Firefox will not start a drag unless some data is set.
        e.dataTransfer.setData("text/plain", String(index));
      },
      onDragEnd: reset,
    }),
    zoneProps: (index) => ({
      onDragOver: (e) => {
        if (fromRef.current == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (over !== index) setOver(index);
      },
      onDrop: (e) => {
        e.preventDefault();
        const from = fromRef.current;
        if (from != null && from !== index) onReorder(from, index);
        reset();
      },
      "data-dragging": dragging === index || undefined,
      "data-dragover": (over === index && dragging !== index) || undefined,
    }),
    dragging,
  };
}
