import StatusChip from "./StatusChip";
import { CircleX, TriangleAlert } from "lucide-react";
import { connectionLabel } from "../pages/settingLabels";

/** Shared connection feedback for settings and onboarding, as the library's status chip. */
export default function ConnectionStatus({ status }: { status?: string }) {
  const label = status === "checking" ? "Checking…" : connectionLabel(status);
  const known = [
    "connected",
    "checking",
    "not-configured",
    "untested",
    "disabled",
  ];
  const look =
    status === "stale"
      ? { tone: "warning" as const, icon: TriangleAlert }
      : status && !known.includes(status)
        ? { tone: "danger" as const, icon: CircleX }
        : {};
  return (
    <StatusChip
      className="connection-state"
      label={label}
      role="status"
      {...look}
    />
  );
}
