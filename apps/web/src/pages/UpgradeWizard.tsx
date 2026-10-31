import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { api, result } from "../api/client";
import { Loading, Notice } from "../components";
import LayoutChoice from "../components/LayoutChoice";
import DisplayPanel from "../components/DisplayPanel";
import UpgradeBackups, {
  AutomaticUpgrades,
  useUpgrade,
} from "../components/UpgradeBackups";
import SettingsGroup from "../components/SettingsGroup";
import AudibleStoreSetting from "../components/AudibleStoreSetting";
import {
  DeletedRetention,
  FollowDefaults,
  WantedSearchSettings,
} from "./AutomationSettings";
import { upgradeLaterKey } from "../upgradeLater";
import { BackgroundWorkForm } from "./BackgroundWork";

const steps = [
  ["whats-new", "New in this version"],
  ["backup", "Your backup"],
  ["settings", "New settings"],
  ["way-back", "The way back"],
] as const;

// New settings shown in place, so they can be changed without leaving the wizard.
const settingsFor: Record<string, React.ReactNode> = {
  "follow-types": <FollowDefaults />,
  "wanted-search": <WantedSearchSettings />,
  "deleted-books": <DeletedRetention />,
  "audible-store": <AudibleStoreSetting />,
  "background-work": <BackgroundWorkForm />,
};

export default function UpgradeWizard() {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const upgrade = useUpgrade();
  const [current, setCurrent] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const quick = useMutation({
    mutationFn: async () => result(await api.POST("/api/upgrade/automatic")),
    onSuccess: (value) => {
      cache.setQueryData(["upgrade"], value);
      navigate("/library", { replace: true });
    },
  });
  const finish = useMutation({
    mutationFn: async () => result(await api.POST("/api/upgrade/acknowledge")),
    onSuccess: (value) => {
      cache.setQueryData(["upgrade"], value);
      navigate("/library", { replace: true });
    },
  });
  function go(step: number) {
    setCurrent(step);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function later() {
    try {
      sessionStorage.setItem(upgradeLaterKey, "true");
    } catch {
      // Without storage the wizard simply opens again on the next page load.
    }
    navigate("/library", { replace: true });
  }
  if (upgrade.isPending) return <Loading />;
  const data = upgrade.data;
  const releases = data?.releases ?? [];
  const review = releases.flatMap((release) => release.review ?? []);
  const id = steps[current][0];
  return (
    <div className="upgrade-wizard">
      <header className="upgrade-heading">
        <p className="wall-eyebrow">Upgrade</p>
        <h1>
          {data?.version
            ? `Welcome to version ${data.version}`
            : "Welcome to the new version"}
        </h1>
        <p className="muted">
          Storyarr has been upgraded. Take a moment to see what has changed,
          check your settings backup and review the new settings. Every step is
          optional.
        </p>
      </header>
      <div className="upgrade-quick">
        <button
          type="button"
          disabled={quick.isPending}
          onClick={() => quick.mutate()}
        >
          {quick.isPending
            ? "Taking a backup…"
            : "Keep the defaults and finish"}
        </button>
        <p className="muted">
          Takes a settings backup and keeps the default for every new setting.
        </p>
      </div>
      <Notice error={upgrade.error || finish.error || quick.error} />
      <div className="upgrade-layout">
        <nav aria-label="Upgrade steps" className="onboarding-steps">
          {steps.map(([key, label], index) => (
            <button
              key={key}
              type="button"
              aria-current={index === current ? "step" : undefined}
              onClick={() => go(index)}
            >
              <span className="onboarding-step-number">
                {index < current ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              {label}
            </button>
          ))}
        </nav>
        <section className="upgrade-step" aria-labelledby="upgrade-step-title">
          <p className="wall-eyebrow">
            Step {current + 1} of {steps.length}
          </p>
          <h2 id="upgrade-step-title" ref={heading} tabIndex={-1}>
            {steps[current][1]}
          </h2>
          {id === "whats-new" &&
            (releases.length ? (
              releases.map((release) => (
                <article key={release.id} className="upgrade-release">
                  <h3>{release.title}</h3>
                  <ul>
                    {release.highlights.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {!!release.database_changes?.length && (
                    <div className="upgrade-database">
                      <h4>Database changes</h4>
                      <ul>
                        {release.database_changes.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                      <p className="muted">
                        A settings backup was taken before these changes ran.
                        {release.rollback ? ` ${release.rollback}` : ""}
                      </p>
                    </div>
                  )}
                </article>
              ))
            ) : (
              <p>You are on the latest version. Nothing new to show.</p>
            ))}
          {id === "backup" && (
            <>
              <p>
                Before upgrading, Storyarr saved a copy of your settings:
                connections, libraries, lists, download and automation settings.
                Download it to keep a copy somewhere else.
              </p>
              <UpgradeBackups restore={false} />
            </>
          )}
          {id === "settings" && (
            <>
              <p>
                New settings start with sensible defaults, so you only need to
                change the ones you want to.
              </p>
              <LayoutChoice />
              <DisplayPanel />
              <div className="settings-section-body upgrade-settings">
                {review
                  .filter((item) => item.id !== "layout")
                  .map((item) =>
                    settingsFor[item.id] ? (
                      <SettingsGroup
                        key={item.id}
                        id={`upgrade-${item.id}`}
                        title={item.title}
                        description={item.description}
                      >
                        {settingsFor[item.id]}
                      </SettingsGroup>
                    ) : (
                      <p key={item.id}>
                        <strong>{item.title}:</strong> {item.description}{" "}
                        <Link to={item.link}>Open {item.title} settings</Link>
                      </p>
                    ),
                  )}
              </div>
            </>
          )}
          {id === "way-back" && (
            <>
              <p>
                If something is not right after the upgrade, you can put your
                settings back to how they were before it. Books, downloads and
                history are not changed.
              </p>
              <UpgradeBackups />
              <AutomaticUpgrades />
              <h3>Going back to the previous version</h3>
              <p>
                Restoring settings does not change the app itself. To go back to
                the previous version, start the previous image again with the
                database backup you took before upgrading. Keep the settings
                backup above, so you can bring your settings across again
                afterwards.
              </p>
            </>
          )}
          <div className="button-row upgrade-actions">
            {current > 0 && (
              <button type="button" onClick={() => go(current - 1)}>
                Previous step
              </button>
            )}
            {current < steps.length - 1 ? (
              <button
                type="button"
                className="primary"
                onClick={() => go(current + 1)}
              >
                Next step
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={finish.isPending}
                onClick={() => finish.mutate()}
              >
                {finish.isPending ? "Finishing…" : "Finish"}
              </button>
            )}
            <button type="button" onClick={later}>
              Remind me later
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
