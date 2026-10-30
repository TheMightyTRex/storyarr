import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { useDisplayPreferences } from "../displayPreferences";

// The header row that page sub-menus move into in the Shelf layout. Set by the app shell.
export const HeaderSubmenuSlot = createContext<HTMLElement | null>(null);

export type SubmenuItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  current: boolean;
  count?: number;
  countLabel?: string;
};

/**
 * A page's sub-menu. In the Shelf layout it shows in the header with icons; in Classic the page keeps
 * its own tabs, passed as `classic`.
 */
export default function HeaderSubmenu({
  label,
  items,
  classic = null,
}: {
  label: string;
  items: SubmenuItem[];
  classic?: ReactNode;
}) {
  const slot = useContext(HeaderSubmenuSlot);
  const shelf = useDisplayPreferences().layout === "shelf";
  const nav = useRef<HTMLElement>(null);
  const fullWidth = useRef(0);
  // When the tabs with their names do not fit, show icons only; the names stay as tooltips and
  // for screen readers.
  const [compact, setCompact] = useState(false);
  const names = items.map((item) => item.label).join("|");
  useLayoutEffect(() => {
    if (!slot || !shelf) return;
    const check = () => {
      const element = nav.current;
      if (!element) return;
      if (!compact) fullWidth.current = element.scrollWidth;
      const style = getComputedStyle(slot);
      const room =
        slot.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      setCompact(fullWidth.current > room);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot, shelf, compact, names]);
  if (!shelf) return <>{classic}</>;
  if (!slot) return null;
  return createPortal(
    <nav
      ref={nav}
      className={
        compact ? "header-submenu-nav is-compact" : "header-submenu-nav"
      }
      aria-label={label}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.to + item.label}
            to={item.to}
            aria-current={item.current ? "page" : undefined}
            title={compact ? item.label : undefined}
          >
            <Icon size={17} aria-hidden="true" />
            <span className="header-submenu-label">{item.label}</span>
            {!!item.count && (
              <span className="header-submenu-count">
                {item.count > 99 ? "99+" : item.count}
                {item.countLabel && (
                  <span className="sr-only"> {item.countLabel}</span>
                )}
              </span>
            )}
          </Link>
        );
      })}
    </nav>,
    slot,
  );
}
