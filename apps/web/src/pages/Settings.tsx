import { Suspense, useEffect, useRef } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Loading } from "../components";
import { settingsSections } from "./SettingsSections";
import HeaderSubmenu, { HeaderTabs } from "../components/HeaderSubmenu";
import { settingsGroups, settingsSectionIcons } from "../navigation";

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
  const selected =
    sections.find((section) => section.id === location.hash.slice(1)) ||
    sections[0];
  const visibleGroups = settingsGroups
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
  // The section tabs scroll sideways in the header's second row; keep the current one in view,
  // centred, and centre it again when the row's width changes.
  useEffect(() => {
    const bar = tabs.current;
    const current = bar?.querySelector("a[aria-current='page']");
    if (!(current instanceof HTMLElement) || !bar) return;
    let width = -1;
    const centerTab = () => {
      if (Math.abs(bar.clientWidth - width) < 1) return;
      width = bar.clientWidth;
      const left =
        current.offsetLeft - (bar.clientWidth - current.offsetWidth) / 2;
      bar.scrollTo({ left: Math.max(0, left) });
    };
    centerTab();
    const observer = new ResizeObserver(centerTab);
    observer.observe(bar);
    return () => observer.disconnect();
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
      />
      <HeaderTabs>
        <div className="settings-tabs-bar">
          <nav
            ref={tabs}
            className="page-tabs"
            aria-label="Settings categories"
          >
            {groupSections.map((item) => {
              const Icon = settingsSectionIcons[item.id];
              return (
                <Link
                  key={item.id}
                  to={`/settings#${item.id}`}
                  aria-current={selected.id === item.id ? "page" : undefined}
                >
                  {Icon && <Icon size={17} aria-hidden="true" />}
                  {item.title}
                </Link>
              );
            })}
          </nav>
        </div>
      </HeaderTabs>
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
