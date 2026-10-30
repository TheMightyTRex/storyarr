import { createContext, useContext } from "react";
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
  if (!shelf) return <>{classic}</>;
  if (!slot) return null;
  return createPortal(
    <nav className="header-submenu-nav" aria-label={label}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.to + item.label}
            to={item.to}
            aria-current={item.current ? "page" : undefined}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{item.label}</span>
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
