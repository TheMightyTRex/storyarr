/*
 * The sections and sub-menus of the main menu, in one place, so the pages' header sub-menus and the
 * phone menu always list the same things.
 */
import type { LucideIcon } from "lucide-react";
import {
  BookMarked,
  Download,
  Library,
  ScrollText,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";

export const discoverViews = [
  ["home", "For you"],
  ["series", "Your series"],
  ["browse", "Browse"],
  ["calendar", "Calendar"],
  ["collections", "Collections"],
  ["awards", "Awards"],
  ["yours", "Your lists"],
] as const;

export const activityTabs = [
  { id: "queue", title: "Queue", to: "/requests" },
  { id: "pending", title: "Wanted", to: "/requests?status=pending" },
  { id: "history", title: "History", to: "/requests?status=history" },
] as const;

// Six settings groups. Each lists its sections in order; sections a role cannot see are left out.
export const settingsGroups: {
  id: string;
  title: string;
  icon: LucideIcon;
  sections: string[];
}[] = [
  {
    id: "general",
    title: "General",
    icon: SlidersHorizontal,
    sections: ["display", "notifications"],
  },
  {
    id: "accounts",
    title: "Accounts",
    icon: UserRound,
    sections: ["sign-in", "accounts"],
  },
  {
    id: "reading",
    title: "Sources",
    icon: BookMarked,
    sections: ["reading", "catalog"],
  },
  {
    id: "library",
    title: "Library",
    icon: Library,
    sections: ["libraries", "naming"],
  },
  {
    id: "downloads",
    title: "Downloads",
    icon: Download,
    sections: ["sources", "downloaders", "preferences", "automation"],
  },
  {
    id: "system",
    title: "System",
    icon: ScrollText,
    sections: ["logs", "background-work", "upgrades"],
  },
];
