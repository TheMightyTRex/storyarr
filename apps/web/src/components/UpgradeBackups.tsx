import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Loading, Notice } from "../components";

type Backup = components["schemas"]["BackupView"];
type Restored = components["schemas"]["RestoreView"];

export function useUpgrade(enabled = true) {
  return useQuery({
    queryKey: ["upgrade"],
    queryFn: async () => result(await api.GET("/api/upgrade")),
    enabled,
    staleTime: 60_000,
  });
}

const reasons: Record<string, string> = {
  "before-upgrade": "Before upgrading",
  "before-restore": "Before a restore",
  manual: "Taken by hand",
};

function when(value?: string | null) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Unknown time";
}

function size(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Settings backups: take one, download one, or restore settings from one. */
export default function UpgradeBackups({
  restore = true,
}: {
  restore?: boolean;
}) {
  const cache = useQueryClient();
  const upgrade = useUpgrade();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [restored, setRestored] = useState<Restored | null>(null);
  const take = useMutation({
    mutationFn: async () => result(await api.POST("/api/upgrade/backups")),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["upgrade"] }),
  });
  const put = useMutation({
    mutationFn: async (name: string) =>
      result(
        await api.POST("/api/upgrade/backups/{name}/restore", {
          params: { path: { name } },
          body: { confirm: true },
        }),
      ),
    onSuccess: (value) => {
      setRestored(value);
      setConfirming(null);
      cache.invalidateQueries();
    },
  });
  const backups = upgrade.data?.backups ?? [];
  return (
    <div className="upgrade-backups">
      <Notice error={upgrade.error || take.error || put.error} />
      {upgrade.isPending && <Loading />}
      {restored && (
        <p role="status" className="notice">
          Settings restored from the backup. Your settings from just before the
          restore are in a new backup, so you can undo this.
        </p>
      )}
      {upgrade.isSuccess && !backups.length && (
        <p>
          There are no settings backups yet. Dewarr takes one automatically
          before each upgrade, or you can take one now.
        </p>
      )}
      {!!backups.length && (
        <ul className="upgrade-backup-list">
          {backups.map((backup: Backup) => (
            <li key={backup.name}>
              <div>
                <strong>{when(backup.created_at)}</strong>
                <span className="muted">
                  {reasons[backup.reason ?? ""] ?? "Backup"} ·{" "}
                  {size(backup.size)} ·{" "}
                  {Object.values(backup.rows).reduce((a, b) => a + b, 0)}{" "}
                  settings rows
                </span>
              </div>
              <div className="button-row">
                <a
                  className="button-link"
                  href={`/api/upgrade/backups/${encodeURIComponent(backup.name)}`}
                  download={backup.name}
                >
                  Download
                </a>
                {restore && (
                  <button
                    type="button"
                    onClick={() => {
                      setRestored(null);
                      setConfirming(backup.name);
                    }}
                  >
                    Restore settings
                  </button>
                )}
              </div>
              {confirming === backup.name && (
                <div
                  className="upgrade-confirm"
                  role="group"
                  aria-label="Confirm restore"
                >
                  <p>
                    Restore settings from {when(backup.created_at)}? Your
                    connections, libraries, lists and automation settings go
                    back to how they were then. Books, downloads and history are
                    not changed, and nor are user accounts or passwords.
                  </p>
                  <p>
                    Your current settings are saved in a new backup first, so
                    you can undo this.
                  </p>
                  <div className="button-row">
                    <button
                      type="button"
                      className="primary"
                      disabled={put.isPending}
                      onClick={() => put.mutate(backup.name)}
                    >
                      {put.isPending
                        ? "Restoring settings…"
                        : "Restore settings"}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => take.mutate()}
        disabled={take.isPending}
      >
        {take.isPending ? "Taking a backup…" : "Take a backup now"}
      </button>
      {take.isSuccess && <p role="status">Backup taken.</p>}
    </div>
  );
}

/** Upgrade automatically: future upgrades take a backup and keep the defaults, with no wizard. */
export function AutomaticUpgrades() {
  const cache = useQueryClient();
  const upgrade = useUpgrade();
  const change = useMutation({
    mutationFn: async (automatic: boolean) =>
      result(await api.PUT("/api/upgrade/settings", { body: { automatic } })),
    onSuccess: (value) => cache.setQueryData(["upgrade"], value),
  });
  const data = upgrade.data;
  if (!data) return null;
  return (
    <div className="upgrade-automatic">
      <Notice error={change.error} />
      <label className="check-label">
        <input
          type="checkbox"
          checked={data.automatic}
          disabled={data.automatic_from_environment || change.isPending}
          onChange={(event) => change.mutate(event.target.checked)}
        />
        Upgrade automatically
      </label>
      <p className="muted">
        {data.automatic_from_environment
          ? "Active because BOOK_UPGRADE_AUTOMATIC is set on the server."
          : "Future upgrades take a settings backup and keep the default for every new setting, without showing this wizard. You can still restore a backup here at any time."}
      </p>
    </div>
  );
}
