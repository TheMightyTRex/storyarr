import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Loading, Notice } from "../components";
import FollowFilterFields from "../components/FollowFilterFields";
import SettingsGroup from "../components/SettingsGroup";

type View = components["schemas"]["AutomationSettingsView"];

export function useAutomationSettings() {
  return useQuery({
    queryKey: ["automation-settings"],
    queryFn: async () => result(await api.GET("/api/automation/settings")),
  });
}

export default function AutomationSettings() {
  return (
    <SettingsGroup
      id="follow-defaults"
      title="New follows"
      description="Choose which kinds of books new author and series follows include."
    >
      <FollowDefaults />
    </SettingsGroup>
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
