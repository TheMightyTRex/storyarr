import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result } from "../api/client";
import type { components } from "../api/schema";

export type Preferences = components["schemas"]["UserPreferences"];
type Changes = components["schemas"]["PreferencesInput"];

const key = ["preferences"];

/** The signed-in person's own preferences, saved with their account. */
export function usePreferences() {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: async () => result(await api.GET("/api/preferences")),
    staleTime: 5 * 60_000,
  });
  const save = useMutation({
    mutationFn: async (changes: Changes) =>
      result(await api.PATCH("/api/preferences", { body: changes })),
    // Show the choice straight away; the server's answer replaces it.
    onMutate: (changes) => {
      const before = cache.getQueryData<Preferences>(key);
      if (before) cache.setQueryData(key, { ...before, ...changes });
      return { before };
    },
    onError: (_error, _changes, context) => {
      if (context?.before) cache.setQueryData(key, context.before);
    },
    onSuccess: (saved) => cache.setQueryData(key, saved),
  });
  return { preferences: query.data, isPending: query.isPending, save };
}
