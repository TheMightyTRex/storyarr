import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BookOpen,
  ChevronRight,
  Compass,
  LogOut,
  Menu,
  Settings,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, result } from "../api/client";
import { activityTabs, discoverViews, settingsGroups } from "../navigation";
import { settingsSections } from "../pages/SettingsSections";
import { requestFilter, requestTab } from "../pages/requestFilters";
import { ApplicationRelease } from "./ApplicationRelease";
import "../phone-menu.css";

type Item = { to: string; label: string; current: boolean; count?: number };
type Section = { id: string; label: string; icon: LucideIcon; items: Item[] };

/*
 * On phones the main menu is a drawer from the left, opened by the menu button in the header. Each
 * section folds open to its sub-menu; the one you are in starts open. It closes on a choice, the
 * close button, Escape, or a press outside it.
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
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
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
        { to: "/library", label: "My library", current: path === "/library" },
        ...(role !== "viewer"
          ? [
              {
                to: "/following",
                label: "Following",
                current: path.startsWith("/following"),
              },
            ]
          : []),
        ...(admin
          ? [
              {
                to: "/review",
                label: "Library review",
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
    if (!open) return;
    setUnfolded(here ? [here.id] : []);
    closer.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        opener.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // Unfold the current section each time the menu opens, not on every change while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
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
        <div className="phone-menu-layer">
          <div className="phone-menu-overlay" onClick={close} />
          <nav
            id="phone-menu"
            className="phone-menu"
            aria-label="Main navigation"
          >
            <header className="side-panel-header">
              <span className="side-panel-title phone-menu-brand">
                <img src="/assets/storyarr.svg" width="28" height="28" alt="" />
                Storyarr
              </span>
              <button
                ref={closer}
                type="button"
                className="icon-button"
                aria-label="Close menu"
                onClick={close}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="phone-menu-sections">
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
            </div>
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
          </nav>
        </div>
      )}
    </>
  );
}
