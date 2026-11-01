import { useSyncExternalStore } from "react";

export type DisplayPreferences = {
  defaultShape: "square" | "portrait";
  audioShape: "square" | "portrait";
  ebookShape: "square" | "portrait";
  layout: "classic" | "shelf";
  theme: "light" | "dark" | "auto";
  textSize: 100 | 125 | 150 | 175;
  highContrast: boolean;
  reduceMotion: boolean;
  underlineLinks: boolean;
  wideSpacing: boolean;
};
export const displayDefaults: DisplayPreferences = {
  defaultShape: "portrait",
  audioShape: "portrait",
  ebookShape: "portrait",
  layout: "classic",
  theme: "light",
  textSize: 100,
  highContrast: false,
  reduceMotion: false,
  underlineLinks: false,
  wideSpacing: false,
};
// Display and accessibility settings, reset together by the panel's Reset button.
export const accessibilityKeys = [
  "theme",
  "textSize",
  "highContrast",
  "reduceMotion",
  "underlineLinks",
  "wideSpacing",
] as const;
const allowed: { [K in keyof DisplayPreferences]: readonly unknown[] } = {
  defaultShape: ["square", "portrait"],
  audioShape: ["square", "portrait"],
  ebookShape: ["square", "portrait"],
  layout: ["classic", "shelf"],
  theme: ["light", "dark", "auto"],
  textSize: [100, 125, 150, 175],
  highContrast: [true, false],
  reduceMotion: [true, false],
  underlineLinks: [true, false],
  wideSpacing: [true, false],
};
const key = "book-search:display:v1";
let snapshot = displayDefaults;
function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    const next: Record<string, unknown> = { ...displayDefaults };
    for (const name of Object.keys(allowed) as (keyof DisplayPreferences)[]) {
      if (allowed[name].includes(saved[name])) next[name] = saved[name];
    }
    snapshot = next as DisplayPreferences;
  } catch {
    snapshot = displayDefaults;
  }
  applyDisplay(snapshot);
}

// Puts the theme and accessibility choices on <html>, where the stylesheets read them.
export function applyDisplay(value: DisplayPreferences) {
  const root = document.documentElement;
  root.dataset.theme = value.theme;
  root.style.fontSize = value.textSize === 100 ? "" : `${value.textSize}%`;
  root.classList.toggle("pref-hc", value.highContrast);
  root.classList.toggle("pref-calm", value.reduceMotion);
  root.classList.toggle("pref-underline", value.underlineLinks);
  root.classList.toggle("pref-spacing", value.wideSpacing);
}
read();
const listeners = new Set<() => void>();
window.addEventListener("storage", (event) => {
  if (event.key === key || event.key === null) {
    read();
    listeners.forEach((notify) => notify());
  }
});
function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}
export function useDisplayPreferences() {
  return useSyncExternalStore(subscribe, () => snapshot);
}
export function saveDisplayPreferences(value: DisplayPreferences) {
  localStorage.setItem(key, JSON.stringify(value));
  snapshot = value;
  applyDisplay(value);
  listeners.forEach((notify) => notify());
}
