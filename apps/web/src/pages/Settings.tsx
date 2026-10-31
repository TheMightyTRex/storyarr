import { Suspense, useEffect, useRef, useState } from "react";
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Download,
  Library,
  ScrollText,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Loading } from "../components";
import { settingsSections } from "./SettingsSections";
import HeaderSubmenu from "../components/HeaderSubmenu";

// Six settings groups. Each lists its sections in order; sections a role cannot see are left out.
const groups: {
  id: string;
  title: string;
  icon: LucideIcon;
  sections: string[];
}[] = [
  {
    id: "general",
    title: "General",
    icon: SlidersHorizontal,
    sections: ["display", "notifications"],
  },
  {
    id: "accounts",
    title: "Accounts",
    icon: UserRound,
    sections: ["sign-in", "accounts"],
  },
  {
    id: "reading",
    title: "Sources",
    icon: BookMarked,
    sections: ["reading", "catalog"],
  },
  {
    id: "library",
    title: "Library",
    icon: Library,
    sections: ["libraries", "naming"],
  },
  {
    id: "downloads",
    title: "Downloads",
    icon: Download,
    sections: ["sources", "downloaders", "preferences", "automation"],
  },
  {
    id: "system",
    title: "System",
    icon: ScrollText,
    sections: ["logs", "upgrades"],
  },
];

export default function Settings({
  role,
  permissions = [],
}: {
  role: string;
  permissions?: string[];
}) {
  const sections = settingsSections(role, permissions);
  const location = useLocation();
  const tabs = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const selected =
    sections.find((section) => section.id === location.hash.slice(1)) ||
    sections[0];
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.sections
        .map((id) => sections.find((section) => section.id === id))
        .filter((section) => section !== undefined),
    }))
    .filter((group) => group.items.length);
  const group =
    visibleGroups.find((group) =>
      group.items.some((section) => section.id === selected.id),
    ) || visibleGroups[0];
  const groupSections = group ? group.items : sections;
  useEffect(() => {
    const bar = tabs.current;
    const current = bar?.querySelector("a[aria-current='page']");
    if (!(current instanceof HTMLElement) || !bar) return;
    const measure = () =>
      setOverflow({
        left: bar.scrollLeft > 1,
        right: bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1,
      });
    const centerTab = () => {
      const left =
        current.offsetLeft - (bar.clientWidth - current.offsetWidth) / 2;
      bar.scrollTo({ left: Math.max(0, left) });
      measure();
    };
    centerTab();
    const observer = new ResizeObserver(centerTab);
    observer.observe(bar);
    bar.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      bar.removeEventListener("scroll", measure);
    };
  }, [selected.id, groupSections.length]);
  if (location.hash === "#recovery" || location.hash === "#quotas") {
    const group = location.hash.slice(1);
    const search = new URLSearchParams(location.search);
    search.set("group", group);
    return (
      <Navigate
        replace
        to={`/settings?${search}#${group === "recovery" ? "downloaders" : "accounts"}`}
      />
    );
  }
  if (location.hash === "#lists")
    return <Navigate replace to={`/settings${location.search}#reading`} />;
  if (location.hash === "#profiles")
    return (
      <Navigate
        replace
        to={`/settings${location.search}#${role === "viewer" ? "display" : "preferences"}`}
      />
    );
  if (location.hash === "#storage")
    return <Navigate replace to={`/settings${location.search}#libraries`} />;
  return (
    <div className="settings-page settings-focused">
      <h1 className="sr-only">Settings</h1>
      <HeaderSubmenu
        label="Settings groups"
        items={visibleGroups.map((item) => ({
          to: `/settings#${item.items[0].id}`,
          label: item.title,
          icon: item.icon,
          current: item.id === group?.id,
        }))}
        classic={
          <nav
            className="page-tabs settings-groups"
            aria-label="Settings groups"
          >
            {visibleGroups.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  to={`/settings#${item.items[0].id}`}
                  aria-current={item.id === group?.id ? "page" : undefined}
                >
                  <Icon size={16} aria-hidden="true" />
                  {item.title}
                </Link>
              );
            })}
          </nav>
        }
      />
      <div className="settings-tabs-bar">
        {(overflow.left || overflow.right) && (
          <button
            type="button"
            className="settings-tabs-scroll"
            aria-label="Earlier settings categories"
            disabled={!overflow.left}
            onClick={() =>
              tabs.current?.scrollBy({ left: -tabs.current.clientWidth * 0.75 })
            }
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
        )}
        <nav ref={tabs} className="page-tabs" aria-label="Settings categories">
          {groupSections.map((item) => (
            <Link
              key={item.id}
              to={`/settings#${item.id}`}
              aria-current={selected.id === item.id ? "page" : undefined}
            >
              {item.title}
            </Link>
          ))}
        </nav>
        {(overflow.left || overflow.right) && (
          <button
            type="button"
            className="settings-tabs-scroll"
            aria-label="More settings categories"
            disabled={!overflow.right}
            onClick={() =>
              tabs.current?.scrollBy({ left: tabs.current.clientWidth * 0.75 })
            }
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <section
        id={selected.id}
        className="settings-section"
        aria-labelledby="settings-section-title"
      >
        <header className="settings-section-heading">
          <h2 id="settings-section-title">{selected.title}</h2>
          {role === "admin" &&
            [
              "libraries",
              "sources",
              "downloaders",
              "storage",
              "naming",
              "accounts",
            ].includes(selected.id) && (
              <span className="settings-scope">Administrator</span>
            )}
        </header>
        <div className="settings-section-body">
          <Suspense key={selected.id} fallback={<Loading />}>
            {selected.content}
          </Suspense>
        </div>
      </section>
    </div>
  );
}
