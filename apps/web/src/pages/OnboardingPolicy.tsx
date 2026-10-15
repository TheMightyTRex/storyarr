import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result } from "../api/client";
import { Loading, Notice } from "../components";

export default function OnboardingPolicy() {
  const cache = useQueryClient();
  const policy = useQuery({
    queryKey: ["onboarding-policy"],
    queryFn: async () => result(await api.GET("/api/setup/onboarding-policy")),
  });
  const [draft, setDraft] = useState<boolean | null>(null);
  const show = draft ?? policy.data?.show_member_onboarding ?? true;
  const save = useMutation({
    mutationFn: async (submitted: boolean) =>
      result(
        await api.PUT("/api/setup/onboarding-policy", {
          body: { show_member_onboarding: submitted },
        }),
      ),
    onSuccess: (saved, submitted) => {
      setDraft((current) => (current === submitted ? null : current));
      cache.setQueryData(["onboarding-policy"], saved);
      cache.invalidateQueries({ queryKey: ["session"] });
    },
  });
  return (
    <section className="panel editor" aria-labelledby="onboarding-policy-title">
      <h2 id="onboarding-policy-title">First-run onboarding</h2>
      <p className="muted">
        Members and viewers can go straight to browsing on a managed
        installation. They can always open their personal setup wizard from
        Settings → General. Administrators, requesters, and approvers keep their
        usual setup experience.
      </p>
      {policy.isPending ? (
        <Loading />
      ) : policy.data ? (
        <form
          className="editor"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(show);
          }}
        >
          <label className="check-label">
            <input
              type="checkbox"
              checked={show}
              onChange={(event) => setDraft(event.target.checked)}
            />
            Show onboarding wizard to new members and viewers
          </label>
          <p className="access-hint">
            This setting leaves personal integrations, library access, and saved
            setup progress unchanged.
          </p>
          <button className="primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save onboarding preference"}
          </button>
          {save.isSuccess && <p role="status">Onboarding preference saved.</p>}
        </form>
      ) : null}
      <Notice error={policy.error || save.error} />
    </section>
  );
}
