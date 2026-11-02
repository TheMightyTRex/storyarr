import type { ComponentProps } from "react";
import {
  ArrowDownToLine,
  Ban,
  Bookmark,
  Calendar,
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Hourglass,
  Import,
  Info,
  LoaderCircle,
  Minus,
  OctagonX,
  Search,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";

/** The shared library's status tones (`.chip[data-tone]`). */
export type ChipTone =
  "success" | "info" | "neutral" | "warning" | "danger" | "muted";

type Look = { tone: ChipTone; icon: LucideIcon };

/**
 * One status vocabulary for every page (guides/CONTENT-DESIGN.md, section 6). Each word has one tone
 * and one icon, so the same state looks the same everywhere.
 */
export const statusLooks: Record<string, Look> = {
  "In library": { tone: "success", icon: Check },
  Downloading: { tone: "info", icon: ArrowDownToLine },
  Importing: { tone: "info", icon: Import },
  Searching: { tone: "info", icon: Search },
  Waiting: { tone: "neutral", icon: Clock },
  "Not released": { tone: "neutral", icon: Calendar },
  "Needs attention": { tone: "warning", icon: TriangleAlert },
  Wanted: { tone: "neutral", icon: Bookmark },
  Excluded: { tone: "muted", icon: Ban },
  "Not requested": { tone: "muted", icon: Minus },
  // Request outcomes (Activity only).
  Pending: { tone: "neutral", icon: Hourglass },
  Declined: { tone: "muted", icon: CircleX },
  Withdrawn: { tone: "muted", icon: Undo2 },
  Failed: { tone: "danger", icon: OctagonX },
  // Connections.
  Connected: { tone: "success", icon: CircleCheck },
  "Cannot connect": { tone: "danger", icon: CircleX },
  "Not connected": { tone: "muted", icon: Minus },
  "Not tested": { tone: "neutral", icon: CircleDashed },
  Disabled: { tone: "muted", icon: Ban },
  Checking: { tone: "info", icon: LoaderCircle },
};

/** The look for a label that starts with a vocabulary word ("Waiting · 16:31", "Downloading 45%"). */
export function statusLook(label: string): Look {
  const word = Object.keys(statusLooks)
    .filter(
      (key) =>
        label.startsWith(key) && !/^[\p{L}]/u.test(label.slice(key.length)),
    )
    .sort((a, b) => b.length - a.length)[0];
  return word ? statusLooks[word] : { tone: "neutral", icon: Info };
}

type StatusChipProps = Omit<ComponentProps<"span">, "children"> & {
  /** The words shown. Always present: a chip never relies on colour or icon alone. */
  label: string;
  /** The vocabulary word that sets the tone and icon, when the label carries extra detail. */
  status?: string;
  tone?: ChipTone;
  icon?: LucideIcon;
};

/** The shared library's status chip: an icon, the words, and the tone colour. */
export default function StatusChip({
  label,
  status,
  tone,
  icon,
  className,
  ...rest
}: StatusChipProps) {
  const look = statusLook(status ?? label);
  const Icon = icon ?? look.icon;
  return (
    <span
      {...rest}
      className={className ? `chip ${className}` : "chip"}
      data-tone={tone ?? look.tone}
    >
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  );
}
