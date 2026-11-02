export const liveDownloadStates = new Set([
  "queued",
  "preflight",
  "submitting",
  "uncertain",
  "downloading",
  "held",
]);

type StatusRequest = {
  approval_status: string;
  reasons: { active: boolean }[];
};

type StatusTarget = {
  state: string;
  message?: string | null;
  attempt_state?: string | null;
  selection_status?: string | null;
  next_action?: string | null;
  needs_review?: boolean;
  import_state?: string | null;
};

export function statusLabel(request: StatusRequest, target: StatusTarget) {
  if (!request.reasons.some((reason) => reason.active)) return "Withdrawn";
  if (
    request.approval_status === "declined" ||
    target.message === "Request declined"
  )
    return "Declined";
  if (
    request.approval_status === "pending" ||
    target.message === "Waiting for approval"
  )
    return "Pending";
  if (target.state === "satisfied") return "In library";
  if (target.needs_review || target.import_state === "held")
    return "Needs review";
  if (["uncertain", "held"].includes(target.attempt_state || ""))
    return "Download needs attention";
  if (["queued", "preflight"].includes(target.attempt_state || ""))
    return "Queued";
  if (target.attempt_state && liveDownloadStates.has(target.attempt_state))
    return "Downloading";
  if (target.state === "awaiting-inventory") return "Check inventory";
  if (target.state === "paused") return "Paused";
  if (target.attempt_state === "complete") return "Importing";
  if (
    target.next_action === "downloads" &&
    target.attempt_state !== "cancelled"
  )
    return "Downloading";
  if (target.selection_status === "searching") return "Searching sources";
  if (target.selection_status === "waiting") return "Waiting for source";
  if (target.selection_status === "scheduled") return "Request queued";
  if (target.selection_status === "held") return "Source needs review";
  if (target.selection_status === "failed") return "Download not started";
  if (["queued", "running"].includes(target.selection_status || ""))
    return "Preparing download";
  if (target.state === "wanted") return "Wanted";
  if (target.state === "cancelled") return "Withdrawn";
  return target.state;
}

/**
 * The status vocabulary word a request's chip shows (guides/CONTENT-DESIGN.md, section 6). The finer
 * label from statusLabel still decides the hint under the chip and the row's actions.
 */
export function statusWord(label: string) {
  if (
    [
      "Needs review",
      "Download needs attention",
      "Check inventory",
      "Source needs review",
    ].includes(label)
  )
    return "Needs attention";
  if (["Searching sources", "Preparing download"].includes(label))
    return "Searching";
  if (
    ["Queued", "Paused", "Waiting for source", "Request queued"].includes(label)
  )
    return "Waiting";
  if (label === "Download not started") return "Failed";
  return label;
}

/** A request target's state in the status vocabulary, where only the state is known. */
export function targetStateWord(state: string) {
  return (
    {
      satisfied: "In library",
      wanted: "Wanted",
      pending: "Already requested",
      "awaiting-inventory": "Needs attention",
      unresolved: "Needs attention",
      paused: "Waiting",
      cancelled: "Withdrawn",
    }[state] || state
  );
}
