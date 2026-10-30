import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { api, result } from "../api/client";
import { Loading, Notice } from "../components";
import LayoutChoice from "../components/LayoutChoice";
import DisplayPanel from "../components/DisplayPanel";
import UpgradeBackups, { useUpgrade } from "../components/UpgradeBackups";
import SettingsGroup from "../components/SettingsGroup";
import AudibleStoreSetting from "../components/AudibleStoreSetting";
import {
  DeletedRetention,
  FollowDefaults,
  WantedSearchSettings,
} from "./AutomationSettings";
import { upgradeLaterKey } from "../upgradeLater";

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
};

export default function UpgradeWizard() {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const upgrade = useUpgrade();
  const [current, setCurrent] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
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
        <h1>Welcome to the new version</h1>
        <p className="muted">
          Dewarr has been upgraded. Take a moment to see what has changed, check
          your settings backup and review the new settings. Every step is
          optional.
        </p>
      </header>
      <Notice error={upgrade.error || finish.error} />
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
                </article>
              ))
            ) : (
              <p>You are on the latest version. Nothing new to show.</p>
            ))}
          {id === "backup" && (
            <>
              <p>
                Before upgrading, Dewarr saved a copy of your settings:
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
