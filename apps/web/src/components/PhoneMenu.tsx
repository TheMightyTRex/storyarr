import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BookOpen,
  ChevronRight,
  Compass,
  LogOut,
  Menu,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, result } from "../api/client";
import {
  activityTabs,
  discoverViewIcons,
  discoverViews,
  libraryIcons,
  settingsGroups,
} from "../navigation";
import { settingsSections } from "../pages/SettingsSections";
import { requestFilter, requestTab } from "../pages/requestFilters";
import { ApplicationRelease } from "./ApplicationRelease";
import SidePanel from "./SidePanel";
import "../phone-menu.css";

type Item = {
  to: string;
  label: string;
  icon: LucideIcon;
  current: boolean;
  count?: number;
};
type Section = { id: string; label: string; icon: LucideIcon; items: Item[] };

/*
 * On phones the main menu is a drawer from the left, opened by the menu button in the header. Each
 * section folds open to its sub-menu; the one you are in starts open. It is a SidePanel from the left,
 * so it closes on the close button, Escape or a press outside it, and also on a choice.
 */
export default function PhoneMenu({
  name,
  role,
  permissions,
  reviewing,
  signOut,
  signingOut,
}: {
  name: string;
  role: string;
  permissions: string[];
  reviewing: number;
  signOut: () => void;
  signingOut: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const release = useQuery({
    queryKey: ["application-release"],
    queryFn: async () => result(await api.GET("/api/application/release")),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const path = location.pathname;
  const params = new URLSearchParams(location.search);
  const admin = role === "admin";
  const sections: Section[] = [
    {
      id: "library",
      label: "Library",
      icon: BookOpen,
      items: [
        {
          to: "/library",
          label: "My library",
          icon: libraryIcons.library,
          current: path === "/library",
        },
        ...(role !== "viewer"
          ? [
              {
                to: "/following",
                label: "Following",
                icon: libraryIcons.following,
                current: path.startsWith("/following"),
              },
            ]
          : []),
        ...(admin
          ? [
              {
                to: "/review",
                label: "Library review",
                icon: libraryIcons.review,
                current: path.startsWith("/review"),
                count: reviewing,
              },
            ]
          : []),
      ],
    },
    {
      id: "discover",
      label: "Discover",
      icon: Compass,
      items: discoverViews.map(([key, label]) => ({
        to: key === "home" ? "/discover" : `/discover?view=${key}`,
        label,
        icon: discoverViewIcons[key],
        current: path === "/discover" && (params.get("view") || "home") === key,
      })),
    },
    {
      id: "activity",
      label: "Activity",
      icon: Activity,
      items: activityTabs.map((tab) => ({
        to: tab.to,
        label: tab.title,
        icon: tab.icon,
        current:
          path === "/requests" &&
          requestTab(requestFilter(location.hash, params.get("status"))) ===
            tab.id,
      })),
    },
    {
      id: "settings",
      label: "Settings",
      icon: Settings,
      items: (() => {
        const visible = settingsSections(role, permissions);
        const hash = location.hash.slice(1);
        return settingsGroups
          .map((group) => ({
            group,
            first: group.sections.find((id) =>
              visible.some((section) => section.id === id),
            ),
          }))
          .filter(({ first }) => first)
          .map(({ group, first }) => ({
            to: `/settings#${first}`,
            label: group.title,
            icon: group.icon,
            current:
              path === "/settings" &&
              (group.sections.includes(hash) ||
                (!hash && group.id === "general")),
          }));
      })(),
    },
  ];
  const here = sections.find((section) =>
    section.items.some((item) => item.current),
  );
  const [unfolded, setUnfolded] = useState<string[]>([]);
  // Close on a choice: the address changes.
  useEffect(
    () => setOpen(false),
    [location.pathname, location.search, location.hash],
  );
  useEffect(() => {
    if (open) setUnfolded(here ? [here.id] : []);
    // Unfold the current section each time the menu opens, not on every change while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const close = () => setOpen(false);
  const upgrade = !!release.data?.update_available;
  return (
    <>
      <button
        ref={opener}
        type="button"
        className="phone-menu-button icon-button"
        aria-expanded={open}
        aria-controls="phone-menu"
        aria-label={upgrade ? "Menu, upgrade available" : "Menu"}
        onClick={() => setOpen(true)}
      >
        <Menu size={20} aria-hidden="true" />
        {upgrade && <span className="phone-menu-dot" aria-hidden="true" />}
      </button>
      {open && (
        <SidePanel
          side="left"
          id="phone-menu"
          label="Main menu"
          title={
            <span className="panel-header__brand">
              <img src="/assets/storyarr.svg" width="28" height="28" alt="" />
              Storyarr
            </span>
          }
          closeLabel="Close menu"
          opener={opener.current}
          onClose={close}
        >
          <form
            className="phone-menu-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              const q = new FormData(event.currentTarget).get("q");
              close();
              navigate(
                "/search?q=" + encodeURIComponent(String(q ?? "").trim()),
              );
            }}
          >
            <input
              type="search"
              name="q"
              aria-label="Search books or authors"
              placeholder="Search books or authors"
              maxLength={300}
            />
            <button type="submit" className="sr-only">
              Search
            </button>
          </form>
          <nav className="phone-menu-sections" aria-label="Main navigation">
            {sections.map((section) => {
              const isOpen = unfolded.includes(section.id);
              const Icon = section.icon;
              return (
                <div
                  key={section.id}
                  className="phone-menu-section"
                  data-current={section === here || undefined}
                >
                  <button
                    type="button"
                    className="phone-menu-section-button"
                    aria-expanded={isOpen}
                    aria-controls={`phone-menu-${section.id}`}
                    onClick={() =>
                      setUnfolded((list) =>
                        isOpen
                          ? list.filter((id) => id !== section.id)
                          : [...list, section.id],
                      )
                    }
                  >
                    <Icon size={20} aria-hidden="true" />
                    {section.label}
                    <ChevronRight
                      size={18}
                      className="phone-menu-chevron"
                      aria-hidden="true"
                    />
                  </button>
                  <ul id={`phone-menu-${section.id}`} hidden={!isOpen}>
                    {section.items.map((item) => (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          aria-current={item.current ? "page" : undefined}
                        >
                          <item.icon size={18} aria-hidden="true" />
                          {item.label}
                          {!!item.count && (
                            <span className="phone-menu-count">
                              {item.count > 99 ? "99+" : item.count}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>
          <footer className="phone-menu-footer">
            <div className="phone-menu-account">
              <span className="avatar" aria-hidden="true">
                {name.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{name}</strong>
                <small>
                  {admin
                    ? "Administrator"
                    : role === "viewer"
                      ? "Viewer"
                      : "Member"}
                </small>
              </span>
              <button
                type="button"
                className="phone-menu-sign-out"
                onClick={signOut}
                disabled={signingOut}
              >
                <LogOut size={18} aria-hidden="true" /> Sign out
              </button>
            </div>
            <ApplicationRelease />
          </footer>
        </SidePanel>
      )}
    </>
  );
}
