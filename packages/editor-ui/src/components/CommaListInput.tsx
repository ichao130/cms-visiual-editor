import { useEffect, useRef, useState } from "react";

interface CommaListInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

const parse = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const join = (list: string[]): string => list.join(", ");

/**
 * Text input backing a comma-separated list of values. It keeps the raw text in
 * local state so typing a separator is never swallowed: a plain controlled
 * `value={list.join(", ")}` re-derives the value on every keystroke, dropping a
 * just-typed comma (an empty trailing entry) — which makes it impossible to
 * start a new entry, the next characters merge into the previous one. Here the
 * field shows the raw text while still emitting the parsed list on each change,
 * and refreshes when the list changes from outside (switching record, undo).
 */
export function CommaListInput({
  value,
  onChange,
  placeholder,
  className,
  id,
  "aria-label": ariaLabel,
}: CommaListInputProps) {
  const [text, setText] = useState(() => join(value));
  const emitted = useRef<string[]>(value);

  useEffect(() => {
    if (join(value) !== join(emitted.current)) {
      setText(join(value));
      emitted.current = value;
    }
  }, [value]);

  const handle = (raw: string) => {
    setText(raw);
    const list = parse(raw);
    emitted.current = list;
    onChange(list);
  };

  return (
    <input
      id={id}
      className={className}
      aria-label={ariaLabel}
      value={text}
      placeholder={placeholder}
      onChange={(e) => handle(e.target.value)}
    />
  );
}
