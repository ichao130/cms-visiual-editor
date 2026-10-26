import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { t } from "../i18n.js";

type ToastKind = "info" | "error";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

/** Push a transient notification. Default kind is "info". */
type PushToast = (message: string, kind?: ToastKind) => void;

const ToastCtx = createContext<PushToast>(() => {});

/** Show brief confirmations ("created", "deleted") and error notices. */
export function useToast(): PushToast {
  return useContext(ToastCtx);
}

const DISMISS_MS = 3200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const push = useCallback<PushToast>(
    (message, kind = "info") => {
      const id = Date.now() + Math.random();
      setToasts((list) => [...list, { id, message, kind }]);
      window.setTimeout(() => remove(id), DISMISS_MS);
    },
    [remove],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pcms-toasts" role="status" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`pcms-toast pcms-toast--${item.kind}`}>
            <span className="pcms-toast__msg">{item.message}</span>
            <button
              type="button"
              className="pcms-toast__close"
              onClick={() => remove(item.id)}
              aria-label={t("media.close")}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
