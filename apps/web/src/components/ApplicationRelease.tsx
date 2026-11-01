import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import BookDialog from "./BookDialog";
import {
  releaseDate,
  releaseIsNewer,
  releaseNoteBlocks,
  versionLabel,
  type Inline,
  type NoteBlock,
} from "./releaseNotes";

type Release = components["schemas"]["ApplicationRelease"];

function renderInlines(items: Inline[]) {
  return items.map((item, index) => {
    if (item.type === "text") return item.value;
    if (item.type === "code") return <code key={index}>{item.value}</code>;
    if (item.type === "strong")
      return <strong key={index}>{item.value}</strong>;
    return (
      <a key={index} href={item.href} target="_blank" rel="noreferrer">
        {item.text}
      </a>
    );
  });
}

function NoteBlockView({ block }: { block: NoteBlock }) {
  if (block.type === "heading") {
    const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
    return <Tag>{renderInlines(block.inlines)}</Tag>;
  }
  if (block.type === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List>
        {block.items.map((item, index) => (
          <li key={index}>{renderInlines(item)}</li>
        ))}
      </List>
    );
  }
  if (block.type === "code")
    return (
      <pre>
        <code>{block.value}</code>
      </pre>
    );
  return <p>{renderInlines(block.inlines)}</p>;
}

function headingText(block: NoteBlock) {
  return block.type === "heading"
    ? block.inlines
        .map((item) => (item.type === "link" ? item.text : item.value))
        .join("")
        .trim()
    : "";
}

function ReleaseNotes({ source, title }: { source: string; title: string }) {
  const all = releaseNoteBlocks(source);
  // Notes often start with the release's own name, which the entry already shows as its title.
  const blocks =
    all[0] && headingText(all[0]) === title.trim() ? all.slice(1) : all;
  if (!blocks.length)
    return <p className="muted">No notes for this release.</p>;
  return (
    <div className="release-notes">
      {blocks.map((block, index) => (
        <NoteBlockView key={index} block={block} />
      ))}
    </div>
  );
}

function useReleaseNotes(enabled: boolean) {
  return useQuery({
    queryKey: ["application-releases"],
    queryFn: async () => result(await api.GET("/api/application/releases")),
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

function statusLine(
  status: string,
  installed: string,
  latest: string | null,
  updateAvailable: boolean,
) {
  if (status === "unconfigured")
    return "Release tracking is not configured, so notes from GitHub are unavailable.";
  if (status === "no-release")
    return "No GitHub releases have been published yet.";
  if (status === "unavailable")
    return "Release notes could not be loaded from GitHub.";
  if (updateAvailable && latest)
    return `${versionLabel(latest)} is available. You have ${versionLabel(installed)}.`;
  if (!/^v?\d+\.\d+\.\d+(?:\+[\w.-]+)?$/.test(installed))
    return `You have ${versionLabel(installed)}, a build that is not a published version.`;
  return `You have ${versionLabel(installed)}, the latest version.`;
}

const UPDATING_GUIDE =
  "https://github.com/TheMightyTRex/storyarr/blob/main/docs/UPDATING.md";

/**
 * Storyarr runs in a container, which cannot replace its own image, so the upgrade happens outside
 * it: on the administrator's own upgrade page when there is one, or with these steps.
 */
function HowToUpgrade({
  version,
  upgradeUrl,
}: {
  version: string;
  upgradeUrl: string | null;
}) {
  const label = versionLabel(version);
  const commands =
    "docker compose pull storyarr\ndocker compose up -d storyarr";
  const [copied, setCopied] = useState(false);
  return (
    <section className="how-to-upgrade" aria-labelledby="how-to-upgrade">
      <h2 id="how-to-upgrade">How to upgrade to {label}</h2>
      {upgradeUrl && (
        <p>
          <a
            className="button-link primary"
            href={upgradeUrl}
            target="_blank"
            rel="noreferrer"
          >
            Upgrade now
          </a>{" "}
          <span className="muted">
            Opens your upgrade page (opens in a new tab).
          </span>
        </p>
      )}
      <ol>
        <li>
          Back up the config folder and the database. Storyarr also saves a
          settings backup before it upgrades.
        </li>
        <li>
          If your compose file names a version, change the Storyarr image tag to{" "}
          <code>{label}</code>.
        </li>
        <li>
          Pull the new image and restart Storyarr:
          <pre>
            <code>{commands}</code>
          </pre>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(commands)
                .then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy commands"}
          </button>
        </li>
      </ol>
      <p className="muted">
        <a href={UPDATING_GUIDE} target="_blank" rel="noreferrer">
          The updating guide (opens in a new tab)
        </a>{" "}
        has the details. If something is not right afterwards, use Restore
        previous version in Settings, System, Upgrades and backups.
      </p>
    </section>
  );
}

/** The release notes window: where you stand, the newest release's notes, and the way to the rest. */
function ReleaseHistory({
  installed,
  latest,
  status,
  updateAvailable,
  releaseUrl,
  upgradeUrl,
  close,
}: {
  installed: string;
  latest: string | null;
  status: string;
  updateAvailable: boolean;
  releaseUrl: string | null;
  upgradeUrl: string | null;
  close: () => void;
}) {
  const notes = useReleaseNotes(status !== "unconfigured");
  const releases = notes.data?.status === "checked" ? notes.data.releases : [];
  const featured =
    releases.find((release) => !release.prerelease) ?? releases[0];
  const published = featured ? releaseDate(featured.published_at) : null;
  const link = featured?.url || releaseUrl;
  return (
    <BookDialog
      title="Release notes"
      close={close}
      className="application-release-dialog"
    >
      <div className="application-release-history">
        <div className="release-status">
          <p>
            {statusLine(
              notes.isError ? "unavailable" : notes.data?.status || status,
              installed,
              latest,
              updateAvailable,
            )}
          </p>
          {link && (
            <a
              className="button-link"
              href={link}
              target="_blank"
              rel="noreferrer"
            >
              View on GitHub
            </a>
          )}
        </div>
        {updateAvailable && latest && (
          <HowToUpgrade version={latest} upgradeUrl={upgradeUrl} />
        )}
        {notes.isLoading ? (
          <p>Loading release notes…</p>
        ) : (
          featured && (
            <article className="release-note">
              <h2>
                {versionLabel(featured.version)}
                {published && (
                  <span className="release-note-date">{published}</span>
                )}
              </h2>
              <ReleaseNotes source={featured.notes} title={featured.name} />
            </article>
          )
        )}
        <p className="muted">
          Earlier releases are in{" "}
          <Link to="/settings#upgrades" onClick={close}>
            Settings, System, Upgrades and backups
          </Link>
          .
        </p>
      </div>
    </BookDialog>
  );
}

/** Settings: every release, newest first, one per fold; the installed one starts open. */
export function ReleaseList() {
  const release = useQuery({
    queryKey: ["application-release"],
    queryFn: async () => result(await api.GET("/api/application/release")),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const installed = release.data?.installed_version || "";
  const notes = useReleaseNotes(release.data?.status !== "unconfigured");
  if (notes.isLoading || release.isLoading) return <p>Loading releases…</p>;
  const releases = notes.data?.status === "checked" ? notes.data.releases : [];
  if (!releases.length)
    return (
      <p>
        {statusLine(
          notes.isError ? "unavailable" : notes.data?.status || "unavailable",
          installed,
          null,
          false,
        )}
      </p>
    );
  const current = (version: string) =>
    versionLabel(version) === versionLabel(installed);
  return (
    <div className="release-list">
      {releases.map((item) => {
        const published = releaseDate(item.published_at);
        return (
          <details
            key={item.version}
            className="release-fold"
            open={current(item.version) || undefined}
          >
            <summary>
              <span className="release-fold-version">
                {versionLabel(item.version)}
              </span>
              {published && (
                <span className="release-note-date">{published}</span>
              )}
              {current(item.version) && (
                <span className="release-tag">Current version</span>
              )}
              {releaseIsNewer(installed, item.version) && (
                <span className="release-tag release-tag-new">Available</span>
              )}
              {item.prerelease && (
                <span className="release-tag">Pre-release</span>
              )}
            </summary>
            <ReleaseNotes source={item.notes} title={item.name} />
            <a href={item.url} target="_blank" rel="noreferrer">
              View {versionLabel(item.version)} on GitHub
            </a>
          </details>
        );
      })}
    </div>
  );
}

export function ApplicationRelease() {
  const [open, setOpen] = useState(false);
  const { data, isError } = useQuery({
    queryKey: ["application-release"],
    queryFn: async () => result(await api.GET("/api/application/release")),
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    retry: false,
  });
  if (!data?.installed_version)
    return (
      <footer className="application-release">
        <small>{isError ? "Version unavailable" : "Checking version…"}</small>
      </footer>
    );
  const label = versionLabel(data.installed_version);
  return (
    <footer
      className="application-release"
      role="group"
      aria-label="Application version"
    >
      <button
        type="button"
        className="installed-version text-button"
        aria-haspopup="dialog"
        title="Show release notes"
        onClick={() => setOpen(true)}
      >
        {label}
        {data.update_available && (
          <span className="update-dot" aria-hidden="true" />
        )}
      </button>
      {data.update_available ? (
        <button
          type="button"
          className="release-update text-button"
          aria-haspopup="dialog"
          title={`${versionLabel(data.latest_version || "")} is available`}
          onClick={() => setOpen(true)}
        >
          Upgrade available
        </button>
      ) : (
        <small>{footerStatus(data)}</small>
      )}
      {open && (
        <ReleaseHistory
          installed={data.installed_version}
          latest={data.latest_version}
          status={data.status}
          updateAvailable={data.update_available}
          releaseUrl={data.release_url}
          upgradeUrl={data.upgrade_url ?? null}
          close={() => setOpen(false)}
        />
      )}
    </footer>
  );
}

function footerStatus(data: Release) {
  if (data.status === "checked")
    return /^v?\d+\.\d+\.\d+(?:\+[\w.-]+)?$/.test(data.installed_version)
      ? "Up to date"
      : "Unreleased build";
  if (data.status === "unconfigured") return "Release tracking not configured";
  if (data.status === "no-release") return "No releases yet";
  return "Update check unavailable";
}
