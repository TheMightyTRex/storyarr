import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
// Pop-ups opened from inside a panel handle their own Escape and Tab.
const NESTED = "dialog, [role='menu'], [role='listbox'], details[open]";

/*
 * A slide-out from the shared library (components.css: .side-panel-layer, .side-panel, .panel-header,
 * .side-panel__body, .side-panel__foot), with the behaviour in components.js: it is modal over a dimmed
 * page; focus moves to Close and Tab stays inside; Escape, Close or a press on the backdrop close it;
 * focus goes back to what opened it; the page behind cannot scroll. side="left" is the phone menu.
 */
export default function SidePanel({
  title,
  label,
  labelledBy,
  closeLabel,
  onClose,
  children,
  footer,
  wide = false,
  side = "right",
  className = "",
  id,
  opener,
}: {
  /** Shown in the panel header; it also names the panel unless `label` is given. */
  title: ReactNode;
  /** The panel's name when the header title is not a good one (the phone menu's logo). */
  label?: string;
  /** The id of another element whose text is added to the name, such as the book's title. */
  labelledBy?: string;
  /** The Close button's name. */
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
  /** Actions that stay at the bottom while the body scrolls. */
  footer?: ReactNode;
  wide?: boolean;
  side?: "right" | "left";
  className?: string;
  id?: string;
  /** Where focus returns on close; by default, whatever had focus when the panel opened. */
  opener?: HTMLElement | null;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const [previous] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const returnTo = useRef<HTMLElement | null>(null);
  returnTo.current = opener ?? previous;

  useLayoutEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closer.current?.focus({ preventScroll: true });
    const element = panel.current;
    return () => {
      document.body.style.overflow = overflow;
      // Give focus back to the opener, unless something outside the panel has already taken it.
      const active = document.activeElement;
      const lost =
        !active || active === document.body || !!element?.contains(active);
      const target = returnTo.current;
      if (lost && target?.isConnected && target !== document.body)
        target.focus({ preventScroll: true });
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as Element;
    if (event.defaultPrevented || target.closest?.(NESTED)) return;
    const element = panel.current;
    if (!element || !element.contains(target)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const list = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (item) => item.getClientRects().length && !item.closest(NESTED),
    );
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const left = side === "left";
  const name =
    closeLabel ?? (typeof title === "string" ? `Close ${title}` : "Close");
  const header = (
    <div className="panel-header">
      {left ? (
        <div className="panel-header__title" id={titleId}>
          {title}
        </div>
      ) : (
        <h2 className="panel-header__title" id={titleId}>
          {title}
        </h2>
      )}
      <button
        ref={closer}
        type="button"
        className="icon-button"
        aria-label={name}
        onClick={onClose}
      >
        <X size={20} aria-hidden="true" />
      </button>
    </div>
  );
  return createPortal(
    <div className="side-panel-layer" onKeyDown={onKeyDown}>
      <div className="side-panel-backdrop" onClick={onClose} />
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={
          label ? undefined : [titleId, labelledBy].filter(Boolean).join(" ")
        }
        className={[
          left ? "phone-menu" : "side-panel",
          wide && !left ? "side-panel--wide" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {header}
        {left ? (
          children
        ) : (
          <>
            <div className="side-panel__body">{children}</div>
            {footer && <div className="side-panel__foot">{footer}</div>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
