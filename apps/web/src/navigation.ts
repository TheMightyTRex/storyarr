/*
 * The sections and sub-menus of the main menu, in one place, so the pages' header sub-menus and the
 * phone menu always list the same things.
 */
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArchiveRestore,
  Award,
  Bell,
  BookCopy,
  BookMarked,
  BookOpen,
  BookOpenText,
  Bookmark,
  CalendarDays,
  CircleAlert,
  Clock,
  Download,
  FilePen,
  FileQuestion,
  FileX,
  HardDriveDownload,
  History,
  KeyRound,
  Layers,
  LayoutGrid,
  Library,
  List,
  ListChecks,
  ListOrdered,
  Puzzle,
  Radio,
  Radar,
  ScrollText,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Tags,
  Timer,
  UserRound,
  Users,
  Zap,
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
  { id: "queue", title: "Queue", to: "/requests", icon: ListOrdered },
  {
    id: "pending",
    title: "Wanted",
    to: "/requests?status=pending",
    icon: Clock,
  },
  {
    id: "history",
    title: "History",
    to: "/requests?status=history",
    icon: History,
  },
] as const;

/*
 * Icons. Main menu (the rail) and 1st level (header row 1) have icons, and so does the 2nd level
 * (header row 2). In the phone menu only the main menu and the 1st level have them.
 */
export const discoverViewIcons: Record<
  (typeof discoverViews)[number][0],
  LucideIcon
> = {
  home: Sparkles,
  series: Library,
  browse: LayoutGrid,
  calendar: CalendarDays,
  collections: Layers,
  awards: Award,
  yours: List,
};
export const libraryIcons = {
  library: BookOpen,
  following: Bookmark,
  review: ListChecks,
} as const;
// 2nd level: My library's shelves.
export const shelfIcons = {
  libraries: BookCopy,
  authors: Users,
  series: Library,
  saved: Archive,
  radio: Radio,
} as const;
// 2nd level: Library review's filters.
export const reviewIcons: Record<string, LucideIcon> = {
  all: CircleAlert,
  "needs-matching": Puzzle,
  "read-issue": FileX,
  details: FileQuestion,
};
// 2nd level: each settings category.
export const settingsSectionIcons: Record<string, LucideIcon> = {
  display: Sun,
  notifications: Bell,
  "sign-in": KeyRound,
  accounts: Users,
  reading: BookOpenText,
  catalog: Tags,
  libraries: Library,
  naming: FilePen,
  sources: Radar,
  downloaders: HardDriveDownload,
  preferences: SlidersHorizontal,
  automation: Zap,
  logs: ScrollText,
  "background-work": Timer,
  upgrades: ArchiveRestore,
};

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
