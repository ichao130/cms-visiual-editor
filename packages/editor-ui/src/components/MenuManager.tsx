import { useState } from "react";
import type { MenuItem } from "@pcms/shared";
import type { LinkTarget } from "../state/linkTargets.js";
import { t } from "../i18n.js";

interface MenuManagerProps {
  menus: Record<string, MenuItem[]>;
  onCommit: (name: string, items: MenuItem[]) => void;
  /** Existing pages/posts/archives, so URLs can be picked instead of typed. */
  targets?: LinkTarget[];
}

/** Edit navigation menus (label + URL, add / remove / reorder). */
export function MenuManager({ menus, onCommit, targets = [] }: MenuManagerProps) {
  const names = Object.keys(menus).length ? Object.keys(menus) : ["menu"];
  const [selected, setSelected] = useState(names[0] as string);
  const items = menus[selected] ?? [];

  const update = (idx: number, patch: Partial<MenuItem>) =>
    onCommit(
      selected,
      items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  const add = () => onCommit(selected, [...items, { label: "新しい項目", url: "/" }]);
  const remove = (idx: number) => onCommit(selected, items.filter((_, i) => i !== idx));
  const move = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[idx], next[to]] = [next[to] as MenuItem, next[idx] as MenuItem];
    onCommit(selected, next);
  };

  return (
    <div className="pcms-structpage pcms-structpage--narrow">
      <h1 className="pcms-page__title">{t("menu.title")}</h1>
      <p className="pcms-structpage__hint">{t("menu.hint")}</p>

      {names.length > 1 && (
          <label className="pcms-field">
            <span className="pcms-field__label">{t("menu.pick")}</span>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}

        {items.map((it, i) => (
          <div className="pcms-menuitem" key={i}>
            <input
              className="pcms-menuitem__label"
              value={it.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder={t("menu.label")}
            />
            <input
              className="pcms-menuitem__url"
              value={it.url}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="/path/"
            />
            {targets.length > 0 && (
              <select
                className="pcms-menuitem__pick"
                value=""
                aria-label={t("menu.pickTarget")}
                onChange={(e) => {
                  const target = targets.find((tg) => tg.url === e.target.value);
                  if (!target) return;
                  // Fill the label too when it is still empty or the default.
                  const patch: Partial<MenuItem> =
                    it.label.trim() === "" || it.label === "新しい項目"
                      ? { url: target.url, label: target.label }
                      : { url: target.url };
                  update(i, patch);
                }}
              >
                <option value="">{t("menu.pickTarget")}</option>
                {targets.map((tg) => (
                  <option key={tg.url} value={tg.url}>
                    {tg.label}
                  </option>
                ))}
              </select>
            )}
            <div className="pcms-menuitem__actions">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1}>
                ↓
              </button>
              <button type="button" className="pcms-danger" onClick={() => remove(i)}>
                {t("repeat.remove")}
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="pcms-types__addfield" onClick={add}>
          {t("menu.add")}
        </button>
    </div>
  );
}
