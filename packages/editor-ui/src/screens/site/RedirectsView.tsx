import { useEffect, useState } from "react";
import type { Redirect } from "@pcms/shared";
import type { PcmsApi } from "../../api/types.js";
import { t } from "../../i18n.js";

interface Props {
  api: PcmsApi;
  siteId: string;
}

/** Normalize an entered path to a leading-slash form; blank stays blank. */
export function normalizePath(value: string): string {
  const v = value.trim();
  if (v === "") return "";
  return v.startsWith("/") ? v : `/${v}`;
}

/**
 * Redirect manager (redirects.json). Entries are auto-added when the permalink
 * pattern changes (so old URLs keep working), and the operator can review them,
 * add a mapping by hand, or remove one here. Each change persists immediately
 * via api.saveRedirects; the generator emits a static stub page per redirect.
 */
export function RedirectsView({ api, siteId: _siteId }: Props) {
  const [redirects, setRedirects] = useState<Redirect[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    let active = true;
    void api.loadRedirects().then((list) => {
      if (!active) return;
      setRedirects(list);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [api]);

  const persist = (next: Redirect[]) => {
    setRedirects(next);
    void api.saveRedirects(next);
  };

  const canAdd =
    normalizePath(from) !== "" &&
    normalizePath(to) !== "" &&
    normalizePath(from) !== normalizePath(to) &&
    !redirects.some((r) => r.from === normalizePath(from));

  const add = () => {
    if (!canAdd) return;
    persist([...redirects, { from: normalizePath(from), to: normalizePath(to) }]);
    setFrom("");
    setTo("");
  };

  const remove = (target: string) => {
    persist(redirects.filter((r) => r.from !== target));
  };

  return (
    <div className="pcms-redirects">
      <h1 className="pcms-page__title">{t("site.tab.redirects")}</h1>
      <p className="pcms-field__hint">{t("redirects.hint")}</p>

      {loaded && redirects.length === 0 ? (
        <p className="pcms-redirects__empty">{t("redirects.empty")}</p>
      ) : (
        <table className="pcms-table pcms-redirects__table">
          <thead>
            <tr>
              <th>{t("redirects.from")}</th>
              <th>{t("redirects.to")}</th>
              <th aria-label={t("redirects.actions")} />
            </tr>
          </thead>
          <tbody>
            {redirects.map((r) => (
              <tr key={r.from}>
                <td className="pcms-redirects__path">{r.from}</td>
                <td className="pcms-redirects__path">{r.to}</td>
                <td>
                  <button
                    type="button"
                    className="pcms-danger"
                    onClick={() => remove(r.from)}
                  >
                    {t("redirects.delete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="pcms-redirects__add">
        <input
          className="pcms-redirects__input"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="/old/path/"
          aria-label={t("redirects.from")}
        />
        <span className="pcms-redirects__arrow">→</span>
        <input
          className="pcms-redirects__input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="/new/path/"
          aria-label={t("redirects.to")}
        />
        <button type="button" disabled={!canAdd} onClick={add}>
          {t("redirects.add")}
        </button>
      </div>
    </div>
  );
}
