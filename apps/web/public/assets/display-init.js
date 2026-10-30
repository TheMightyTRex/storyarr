// Apply the saved theme and text size before the app loads, so the page does not flash.
try {
  const saved = JSON.parse(
    localStorage.getItem("book-search:display:v1") || "{}",
  );
  const root = document.documentElement;
  root.dataset.theme = ["light", "dark", "auto"].includes(saved.theme)
    ? saved.theme
    : "light";
  if ([125, 150, 175].includes(saved.textSize))
    root.style.fontSize = saved.textSize + "%";
  if (saved.highContrast === true) root.classList.add("pref-hc");
} catch {}
