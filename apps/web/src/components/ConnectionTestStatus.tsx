import StatusChip from "./StatusChip";
import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  LoaderCircle,
  Minus,
  TriangleAlert,
} from "lucide-react";

type ConnectionTestStatusProps = {
  configured: boolean;
  status: string;
  lastSuccessAt?: string | null;
  isPending: boolean;
  error?: Error | null;
};

export default function ConnectionTestStatus({
  configured,
  status,
  lastSuccessAt,
  isPending,
  error,
}: ConnectionTestStatusProps) {
  const connected = status === "connected";
  const disabled = configured && status === "disabled";
  const state = disabled
    ? "disabled"
    : isPending
      ? "pending"
      : error
        ? "failed"
        : connected
          ? "connected"
          : configured && status === "untested"
            ? "saved"
            : configured
              ? "attention"
              : "not-saved";
  const label = {
    disabled: "Disabled",
    pending: "Testing…",
    failed: "Test failed",
    connected: "Saved & connected",
    saved: "Saved · not tested",
    attention: "Needs attention",
    "not-saved": "Not saved",
  }[state];
  const looks = {
    disabled: { tone: "muted", icon: Ban },
    pending: { tone: "info", icon: LoaderCircle },
    failed: { tone: "danger", icon: CircleX },
    connected: { tone: "success", icon: CircleCheck },
    saved: { tone: "neutral", icon: CircleDashed },
    attention: { tone: "warning", icon: TriangleAlert },
    "not-saved": { tone: "muted", icon: Minus },
  } as const;
  const detail = disabled
    ? "Enable this connection to test it."
    : isPending
      ? "Checking the saved connection."
      : error
        ? "Saved credentials were kept."
        : connected && lastSuccessAt
          ? `Verified ${new Date(lastSuccessAt).toLocaleString("en-GB")}`
          : connected
            ? "Connection verified successfully."
            : configured && status === "untested"
              ? "Test the saved connection to verify access."
              : configured
                ? "Review the error, then test again."
                : "Save this connection before testing.";

  return (
    <span
      className="connection-test-status"
      data-state={state}
      role="status"
      aria-label="Connection test status"
      aria-live="polite"
    >
      <StatusChip
        className="connection-test-status-label"
        label={label}
        {...looks[state]}
      />
      <span className="connection-test-status-detail">{detail}</span>
    </span>
  );
}

export function SavedSecretIndicator({ saved }: { saved: boolean }) {
  return saved ? (
    <span className="saved-secret-indicator" aria-label="Credential saved">
      Saved · ••••••••
    </span>
  ) : null;
}
