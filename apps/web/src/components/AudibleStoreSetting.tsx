import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result } from "../api/client";
import { Loading, Notice } from "../components";
import SavedNote from "./SavedNote";
import {
  audibleStores,
  suggestedAudibleStore,
  type AudibleStore,
} from "../audibleStores";

/** The Audible store on its own, for the upgrade wizard. Settings → Metadata has it with the rest. */
export default function AudibleStoreSetting() {
  const cache = useQueryClient();
  const preferences = useQuery({
    queryKey: ["metadata-preferences"],
    queryFn: async () => result(await api.GET("/api/metadata/preferences")),
  });
  const [store, setStore] = useState<AudibleStore | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const value =
    store ??
    (preferences.data?.audible_region as AudibleStore | null | undefined) ??
    suggestedAudibleStore();
  const save = useMutation({
    mutationFn: async () =>
      result(
        await api.PUT("/api/metadata/preferences", {
          body: { ...preferences.data!, audible_region: value },
        }),
      ),
    onSuccess: (data) => {
      cache.setQueryData(["metadata-preferences"], data);
      setStore(null);
      setSavedAt(new Date());
    },
  });
  return (
    <form
      className="policy-settings"
      aria-label="Audible store"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Notice error={preferences.error || save.error} />
      {preferences.isPending && <Loading />}
      <label>
        Audible store
        <select
          value={value}
          onChange={(e) => {
            setStore(e.target.value as AudibleStore);
          }}
        >
          {audibleStores.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {!preferences.data?.audible_region && (
        <p className="muted">Suggested from this browser&apos;s country.</p>
      )}
      <div className="button-row">
        <button
          type="submit"
          className="primary"
          disabled={!preferences.data || save.isPending}
        >
          Save Audible store
        </button>
        <SavedNote at={savedAt} />
      </div>
    </form>
  );
}
