import { NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  Bookmark,
  BookOpen,
  Compass,
  ListChecks,
  LogOut,
  Settings,
} from "lucide-react";
import { ApplicationRelease } from "./ApplicationRelease";
import HeaderSubmenu from "./HeaderSubmenu";
import type { SubmenuItem } from "./HeaderSubmenu";

// The Shelf layout groups the library pages under one menu item.
const libraryPaths = /^\/(library|following|review)(\/|$)/;

function count(value: number) {
  return value > 99 ? "99+" : String(value);
}

export function ShelfRail({
  name,
  role,
  waiting,
  reviewing,
  signOut,
  signingOut,
}: {
  name: string;
  role: string;
  waiting: number;
  reviewing: number;
  signOut: () => void;
  signingOut: boolean;
}) {
  const location = useLocation();
  const inLibrary = libraryPaths.test(location.pathname);
  return (
    <aside className="shelf-rail">
      <NavLink to="/library" className="shelf-brand" aria-label="Library home">
        <img src="/assets/dewarr.png" width="40" height="40" alt="" />
      </NavLink>
      <nav aria-label="Main navigation" className="shelf-nav">
        <NavLink
          to="/library"
          className={inLibrary ? "active" : undefined}
          aria-current={inLibrary ? "page" : undefined}
        >
          <BookOpen size={20} aria-hidden="true" />
          <span>Library</span>
          {role === "admin" && reviewing > 0 && (
            <span className="shelf-count">
              {count(reviewing)}
              <span className="sr-only"> library items to review</span>
            </span>
          )}
        </NavLink>
        <NavLink to="/discover">
          <Compass size={20} aria-hidden="true" />
          <span>Discover</span>
        </NavLink>
        <NavLink to="/requests">
          <Activity size={20} aria-hidden="true" />
          <span>Activity</span>
          {waiting > 0 && (
            <span className="shelf-count">
              {count(waiting)}
              <span className="sr-only"> active requests</span>
            </span>
          )}
        </NavLink>
        <NavLink to="/settings">
          <Settings size={20} aria-hidden="true" />
          <span>Settings</span>
        </NavLink>
      </nav>
      <div className="shelf-account">
        <span className="avatar" title={name} aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="sr-only">Signed in as {name}</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Sign out"
          onClick={signOut}
          disabled={signingOut}
        >
          <LogOut size={18} aria-hidden="true" />
        </button>
      </div>
      <ApplicationRelease />
    </aside>
  );
}

export function LibraryTabs({
  canEdit,
  admin,
  reviewing,
}: {
  canEdit: boolean;
  admin: boolean;
  reviewing: number;
}) {
  const { pathname } = useLocation();
  if (!libraryPaths.test(pathname)) return null;
  const items: SubmenuItem[] = [
    {
      to: "/library",
      label: "My library",
      icon: BookOpen,
      current: pathname === "/library",
    },
  ];
  if (canEdit)
    items.push({
      to: "/following",
      label: "Following",
      icon: Bookmark,
      current: pathname.startsWith("/following"),
    });
  if (admin)
    items.push({
      to: "/review",
      label: "Library review",
      icon: ListChecks,
      current: pathname.startsWith("/review"),
      count: reviewing,
      countLabel: "items to review",
    });
  return <HeaderSubmenu label="Library" items={items} />;
}
