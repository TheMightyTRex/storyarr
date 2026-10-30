import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Loading, Notice } from "../components";
import FollowFilterFields from "../components/FollowFilterFields";
import SettingsGroup from "../components/SettingsGroup";

type View = components["schemas"]["AutomationSettingsView"];
type WantedSearch = components["schemas"]["WantedSearch"];

export function useAutomationSettings() {
  return useQuery({
    queryKey: ["automation-settings"],
    queryFn: async () => result(await api.GET("/api/automation/settings")),
  });
}

export default function AutomationSettings({
  admin = false,
}: {
  admin?: boolean;
}) {
  return (
    <>
      <SettingsGroup
        id="follow-defaults"
        title="New follows"
        description="Choose which kinds of books new author and series follows include."
      >
        <FollowDefaults />
      </SettingsGroup>
      <SettingsGroup
        id="wanted-search"
        title="Wanted books"
        description="Search again for requested books that no source had yet."
      >
        <WantedSearchSettings />
      </SettingsGroup>
      {admin && (
        <SettingsGroup
          id="deleted-books"
          title="Deleted books"
          description="How long deleted books stay in the holding folder before their files are removed."
        >
          <DeletedRetention />
        </SettingsGroup>
      )}
    </>
  );
}

function WantedSearchSettings() {
  const cache = useQueryClient();
  const settings = useAutomationSettings();
  const [draft, setDraft] = useState<WantedSearch | null>(null);
  const [saved, setSaved] = useState(false);
  const value = draft ?? settings.data?.settings?.wanted_search;
  const save = useMutation({
    mutationFn: async () =>
      result(
        await api.PUT("/api/automation/settings", {
          body: {
            wanted_search: value!,
            expected_generation: settings.data!.generation,
          },
        }),
      ),
    onSuccess: (data) => {
      cache.setQueryData(["automation-settings"], data);
      setDraft(null);
      setSaved(true);
    },
  });
  const change = (next: Partial<WantedSearch>) => {
    setSaved(false);
    setDraft({ ...value!, ...next });
  };
  return (
    <form
      className="policy-settings"
      aria-label="Wanted books"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Notice error={settings.error || save.error} />
      {settings.isPending && <Loading />}
      {saved && <p role="status">Wanted books settings saved.</p>}
      {value && (
        <>
          <p>
            When a search finds no suitable release, the book stays wanted. With
            this on, it is searched again automatically: after 6 hours, then
            once a day for a week, then once a week until it is found.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(e) => change({ enabled: e.target.checked })}
            />
            Search again for wanted books
          </label>
          <fieldset disabled={!value.enabled}>
            <legend>Formats to search again</legend>
            <label className="check-label">
              <input
                type="checkbox"
                checked={value.audio}
                onChange={(e) => change({ audio: e.target.checked })}
              />
              Audiobooks
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={value.ebook}
                onChange={(e) => change({ ebook: e.target.checked })}
              />
              Ebooks
            </label>
          </fieldset>
          <p className="muted">
            Books waiting for their release day are always searched on that day.
            Requests from lists follow their own list settings.
          </p>
          <button
            type="submit"
            className="primary"
            disabled={!draft || save.isPending}
          >
            Save wanted books settings
          </button>
        </>
      )}
    </form>
  );
}

function DeletedRetention() {
  const cache = useQueryClient();
  const [saved, setSaved] = useState(false);
  const query = useQuery({
    queryKey: ["automation-installation"],
    queryFn: async () =>
      result(await api.GET("/api/automation/settings/installation")),
  });
  const [days, setDays] = useState<number | null>(null);
  const value = days ?? query.data?.settings.deleted_retention_days ?? 30;
  const save = useMutation({
    mutationFn: async () =>
      result(
        await api.PUT("/api/automation/settings/installation", {
          body: {
            deleted_retention_days: value,
            expected_generation: query.data!.generation,
          },
        }),
      ),
    onSuccess: (data) => {
      cache.setQueryData(["automation-installation"], data);
      setDays(null);
      setSaved(true);
    },
  });
  return (
    <form
      className="policy-settings"
      aria-label="Deleted books retention"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Notice error={query.error || save.error} />
      {query.isPending && <Loading />}
      {saved && <p role="status">Retention saved.</p>}
      <p>
        Deleting a book from a library moves its files to a hidden{" "}
        <code>.deleted-books</code> folder inside that library, so it can be
        restored by moving the folder back.
      </p>
      <label>
        Keep deleted books for (days)
        <input
          type="number"
          min={0}
          max={3650}
          required
          value={value}
          onChange={(e) => setDays(Number(e.target.value))}
        />
      </label>
      <p className="muted">
        {value === 0
          ? "0 keeps them until you delete them yourself."
          : `Held files older than ${value} days are deleted permanently each night.`}
      </p>
      <button
        type="submit"
        className="primary"
        disabled={!query.data || save.isPending}
      >
        Save retention
      </button>
    </form>
  );
}

function FollowDefaults() {
  const [saved, setSaved] = useState(false);
  const cache = useQueryClient();
  const settings = useAutomationSettings();
  return (
    <div className="policy-settings">
      <p>
        New follows start with these choices. You can still change them for each
        author or series in Following.
      </p>
      <Notice error={settings.error} />
      {settings.isPending && <Loading />}
      {saved && <p role="status">Follow defaults saved.</p>}
      {settings.data && (
        <Editor
          key={settings.data.generation}
          current={settings.data}
          onSaved={(value) => {
            cache.setQueryData(["automation-settings"], value);
            setSaved(true);
          }}
        />
      )}
    </div>
  );
}

function Editor({
  current,
  onSaved,
}: {
  current: View;
  onSaved: (value: View) => void;
}) {
  const [filters, setFilters] = useState(current.settings.follow_filters);
  const save = useMutation({
    mutationFn: async () =>
      result(
        await api.PUT("/api/automation/settings", {
          body: {
            follow_filters: filters,
            expected_generation: current.generation,
          },
        }),
      ),
    onSuccess: onSaved,
  });
  return (
    <form
      aria-label="New follow defaults"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Notice error={save.error} />
      <FollowFilterFields value={filters} change={setFilters} />
      <button type="submit" className="primary" disabled={save.isPending}>
        Save follow defaults
      </button>{" "}
      <button
        type="button"
        onClick={() => setFilters(current.built_in.follow_filters)}
      >
        Use built-in defaults
      </button>
    </form>
  );
}
