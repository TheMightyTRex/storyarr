import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { CircleCheck, Info, X } from "lucide-react";

export type ToastOptions = {
  /** One optional line under the title. */
  detail?: string;
  tone?: "success" | "info";
  /** One optional next step, such as Undo or Open Activity. */
  action?: { label: string; run: () => void };
};
type Item = ToastOptions & { id: number; title: string };
type Show = (title: string, options?: ToastOptions) => () => void;

const ToastContext = createContext<Show>(() => () => undefined);

/** toast("Follow saved", { detail, tone, action }) shows a confirmation and returns a function that closes it. */
export function useToast() {
  return useContext(ToastContext);
}

/**
 * The shared library's toasts (option C): a card in the corner, success or information, up to three
 * stacked with the newest at the bottom, read out through one role="status" region. Each stays 5 seconds,
 * or 10 with an action, and waits while the pointer or keyboard focus is on it. Confirmations only: an
 * error is never only a toast. Settings pages use SavedNote instead.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(0);
  const close = useCallback(
    (id: number) => setItems((list) => list.filter((item) => item.id !== id)),
    [],
  );
  const show = useCallback<Show>(
    (title, options = {}) => {
      const id = ++next.current;
      setItems((list) => [...list, { ...options, id, title }].slice(-3));
      return () => close(id);
    },
    [close],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status">
        {items.map((item) => (
          <Toast key={item.id} item={item} onClose={() => close(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onClose }: { item: Item; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const tone = item.tone === "info" ? "info" : "success";
  const Icon = tone === "info" ? Info : CircleCheck;
  // Puts focus back on the page when the toast that held it goes.
  const shut = useCallback(() => {
    if (card.current?.contains(document.activeElement))
      document.querySelector<HTMLElement>("main")?.focus();
    closeRef.current();
  }, []);
  useEffect(() => {
    const node = card.current;
    if (!node) return;
    let left = item.action ? 10_000 : 5_000;
    let started = Date.now();
    let timer = setTimeout(shut, left);
    const pause = () => {
      clearTimeout(timer);
      left -= Date.now() - started;
    };
    const resume = () => {
      if (node.matches(":hover, :focus-within")) return;
      started = Date.now();
      timer = setTimeout(shut, Math.max(left, 2000));
    };
    const later = () => setTimeout(resume);
    node.addEventListener("pointerenter", pause);
    node.addEventListener("focusin", pause);
    node.addEventListener("pointerleave", resume);
    node.addEventListener("focusout", later);
    return () => {
      clearTimeout(timer);
      node.removeEventListener("pointerenter", pause);
      node.removeEventListener("focusin", pause);
      node.removeEventListener("pointerleave", resume);
      node.removeEventListener("focusout", later);
    };
  }, [item.action, shut]);
  return (
    <div ref={card} className="toast" data-tone={tone}>
      <Icon className="i" size={20} aria-hidden="true" focusable="false" />
      <span className="toast__text">
        <span className="toast__title">{item.title}</span>
        {item.detail && <span className="toast__detail">{item.detail}</span>}
      </span>
      {item.action && (
        <button
          type="button"
          className="btn btn--quiet btn--compact toast__action"
          onClick={() => {
            item.action?.run();
            shut();
          }}
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        className="icon-btn icon-btn--bare toast__close"
        aria-label={`Close message: ${item.title}`}
        onClick={shut}
      >
        <X className="i" size={20} aria-hidden="true" focusable="false" />
      </button>
    </div>
  );
}
