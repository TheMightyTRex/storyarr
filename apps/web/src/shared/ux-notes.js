/*
 * UX notes (version 1, 2 November 2026). Plain JavaScript, no libraries; styles are in components.css
 * (.ux-dock, .ux-banner, .ux-outline, .ux-notes).
 *
 * A tester's tool: a "Note an issue" button in the corner of every page. Press it, choose the part of the
 * page with the issue (click it, or Tab to it and press Enter; Whole page for the page itself; Escape
 * stops), say what is wrong, the kind and how bad it is. Each note keeps the page, the part chosen and the
 * display settings, so it can be found again. Notes lists them, with Copy as text, Download and Mark as fixed.
 *
 *   UxNotes.start({ app: "Starboard", version: "0.7.4", store })
 *   UxNotes.stop()
 *
 * store is optional: { list(), add(note), update(id, changes), remove(id) }, each returning a promise; list
 * resolves to an array, add to the saved note. Without one, notes stay in this browser (localStorage).
 * Everything is built as text, never as HTML, so a note cannot run anything.
 */
(() => {
  const KINDS = ["Layout", "Words", "Behaviour", "Accessibility", "Looks", "Other"];
  const SEVERITY = [["minor", "Minor"], ["in-the-way", "Gets in the way"], ["stops-me", "Stops me"]];
  const ROLES = { a: "Link", button: "Button", input: "Field", select: "Choice", textarea: "Text box", td: "Table cell",
    th: "Table heading", tr: "Table row", table: "Table", img: "Picture", svg: "Icon", li: "List item", ul: "List", ol: "List",
    nav: "Menu", header: "Header", footer: "Footer", p: "Text", span: "Text", label: "Label", section: "Section",
    article: "Card", aside: "Slide-out", dialog: "Dialog", form: "Form", main: "Page", div: "Area" };
  const ICONS = {
    note: ["M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z", "M12 15h.01", "M12 7v4"],
    list: ["M3 5h.01", "M3 12h.01", "M3 19h.01", "M8 5h13", "M8 12h13", "M8 19h13"],
    x: ["M18 6 6 18", "m6 6 12 12"],
  };

  let options = null;
  let dock = null;
  let count = null;
  let picking = null; // { banner, outline, listeners } while choosing a part of the page

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    node.append(...children.flat().filter((c) => c != null && c !== false));
    return node;
  }

  function svg(name) {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor",
      "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) s.setAttribute(k, v);
    for (const d of ICONS[name]) { const p = document.createElementNS(ns, "path"); p.setAttribute("d", d); s.append(p); }
    return s;
  }

  function say(message) {
    if (window.SharedComponents?.toast) return window.SharedComponents.toast(message);
    let region = document.getElementById("ux-notes-status");
    if (!region) document.body.append(region = h("div", { id: "ux-notes-status", class: "toast", role: "status" }));
    region.hidden = false;
    region.textContent = message;
    clearTimeout(say.timer);
    say.timer = setTimeout(() => (region.hidden = true), 4000);
  }

  // Notes kept in this browser, when the app gives no store of its own.
  function browserStore(key) {
    const read = () => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
    const write = (notes) => { try { localStorage.setItem(key, JSON.stringify(notes)); } catch { /* private window */ } };
    return {
      async list() { return read(); },
      async add(note) { const saved = { ...note, id: `n${Date.now().toString(36)}` }; write([...read(), saved]); return saved; },
      async update(id, changes) { write(read().map((n) => (n.id === id ? { ...n, ...changes } : n))); },
      async remove(id) { write(read().filter((n) => n.id !== id)); },
    };
  }

  const ours = (node) => node instanceof Element && !!node.closest(".ux-dock, .ux-banner, .ux-notes, .ux-outline");

  // A selector that finds the part again: the nearest id, then up to four steps of tag, classes and position.
  function selectorFor(node) {
    const steps = [];
    for (let n = node; n && n !== document.documentElement && steps.length < 5; n = n.parentElement) {
      if (n.id && !/^\d/.test(n.id)) { steps.unshift(`#${CSS.escape(n.id)}`); break; }
      let step = n.tagName.toLowerCase();
      const classes = [...n.classList].filter((c) => !c.startsWith("is-")).slice(0, 2);
      if (classes.length) step += classes.map((c) => `.${CSS.escape(c)}`).join("");
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (same.length > 1) step += `:nth-of-type(${same.indexOf(n) + 1})`;
      steps.unshift(step);
    }
    return steps.join(" > ");
  }

  function labelFor(node) {
    const text = (node.getAttribute("aria-label") || node.innerText || node.getAttribute("alt") || node.getAttribute("title") || "")
      .replace(/\s+/g, " ").trim();
    const tag = node.tagName.toLowerCase();
    const role = node.getAttribute("role") || ROLES[tag] || (/^h[1-6]$/.test(tag) ? "Heading" : tag);
    const name = role.charAt(0).toUpperCase() + role.slice(1);
    return text ? `${name}: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}` : name;
  }

  function context() {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    return {
      page: location.pathname + location.search + location.hash,
      title: document.title,
      screen: `${innerWidth}×${innerHeight}`,
      zoom: Math.round(devicePixelRatio * 100) / 100,
      theme: `${dark ? "Dark" : "Light"}${root.dataset.theme ? "" : " (device)"}`,
      text: getComputedStyle(root).fontSize,
      design: root.dataset.design || "",
      display: [...root.classList].filter((c) => c.startsWith("pref-")).map((c) => c.slice(5)),
      app: options.app || "",
      version: options.version || "",
      browser: navigator.userAgent,
      when: new Date().toISOString(),
    };
  }

  // Choosing a part of the page ---------------------------------------------------------------------------

  function startPicking() {
    if (picking) return;
    dock.hidden = true;
    const outline = h("div", { class: "ux-outline", "aria-hidden": "true" });
    const whole = h("button", { type: "button", class: "btn btn--compact", text: "Whole page", onclick: () => finish(document.body) });
    const stop = h("button", { type: "button", class: "btn btn--compact", text: "Stop", onclick: () => endPicking(true) });
    const banner = h("div", { class: "ux-banner", role: "region", "aria-label": "Note an issue" },
      h("p", { id: "ux-banner-text", text: "Choose the part with the issue: click it, or Tab to it and press Enter. Escape stops." }),
      h("div", { class: "ux-banner__actions" }, whole, stop));
    document.body.append(outline, banner);
    document.documentElement.classList.add("is-ux-picking");
    let current = null;
    const show = (node) => {
      if (!(node instanceof Element) || ours(node)) { outline.hidden = true; current = null; return; }
      current = node;
      const r = node.getBoundingClientRect();
      Object.assign(outline.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
      outline.hidden = false;
    };
    const block = (e) => { if (!ours(e.target)) { e.preventDefault(); e.stopPropagation(); } };
    const listeners = {
      pointermove: (e) => show(e.target),
      pointerdown: block,
      mousedown: block,
      pointerup: block,
      mouseup: block,
      click: (e) => { if (ours(e.target)) return; block(e); finish(e.target); },
      focusin: (e) => show(e.target),
      keydown: (e) => {
        if (e.key === "Escape") { e.preventDefault(); endPicking(true); return; }
        if ((e.key === "Enter" || e.key === " ") && !ours(document.activeElement) && document.activeElement !== document.body) {
          block(e);
          finish(document.activeElement);
        }
      },
      scroll: () => current && show(current),
    };
    for (const [type, fn] of Object.entries(listeners)) window.addEventListener(type, fn, true);
    picking = { banner, outline, listeners };
    whole.focus();
  }

  function endPicking(refocus) {
    if (!picking) return;
    for (const [type, fn] of Object.entries(picking.listeners)) window.removeEventListener(type, fn, true);
    picking.banner.remove();
    picking.outline.remove();
    picking = null;
    document.documentElement.classList.remove("is-ux-picking");
    dock.hidden = false;
    if (refocus) dock.querySelector("button").focus();
  }

  function finish(node) {
    const part = node === document.body
      ? { label: "Whole page", selector: "" }
      : { label: labelFor(node), selector: selectorFor(node) };
    endPicking(false);
    openNote(part);
  }

  // Dialogs ----------------------------------------------------------------------------------------------

  function dialog(title, body, foot, wide) {
    const id = `ux-dialog-${Date.now()}`;
    const d = h("dialog", { class: wide ? "dialog ux-notes ux-notes--wide" : "dialog ux-notes", "aria-labelledby": id },
      h("div", { class: "panel-header" },
        h("h2", { class: "panel-header__title", id, text: title }),
        h("button", { type: "button", class: "icon-btn", "aria-label": `Close ${title}`, onclick: () => d.close() }, svg("x"))),
      h("div", { class: "dialog__body" }, body),
      h("div", { class: "dialog__foot" }, foot));
    d.addEventListener("close", () => { d.remove(); dock.querySelector("button")?.focus(); });
    document.body.append(d);
    d.showModal();
    return d;
  }

  function openNote(part) {
    const what = h("textarea", { class: "textarea", id: "ux-what", name: "what", required: true, rows: 4 });
    const kind = h("select", { class: "select", id: "ux-kind", name: "kind" }, KINDS.map((k) => h("option", { value: k, text: k })));
    const severity = h("fieldset", { class: "segmented" }, h("legend", { class: "visually-hidden", text: "How bad is it" }),
      SEVERITY.map(([value, label], i) => h("label", {}, h("input", { type: "radio", name: "severity", value, checked: i === 1 }), h("span", { text: label }))));
    const error = h("p", { class: "field-error", id: "ux-what-error", hidden: true, text: "Say what is wrong" });
    const form = h("form", { class: "ux-notes__form", id: "ux-form", novalidate: true },
      h("div", { class: "field" }, h("span", { class: "field__label", text: "Where" }),
        h("p", { class: "ux-notes__where", text: part.label }), part.selector ? h("code", { class: "ux-notes__selector", text: part.selector }) : null),
      h("div", { class: "field" }, h("label", { for: "ux-what", text: "What is wrong" }), error, what),
      h("div", { class: "field" }, h("label", { for: "ux-kind", text: "Kind" }), kind),
      h("div", { class: "field" }, h("span", { class: "field__label", id: "ux-sev-l", text: "How bad is it" }), severity));
    severity.setAttribute("aria-labelledby", "ux-sev-l");
    const save = h("button", { type: "submit", form: "ux-form", class: "btn btn--primary", text: "Save the note" });
    const d = dialog("Note an issue", form, [save, h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => d.close() })]);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = what.value.trim();
      error.hidden = !!text;
      what.toggleAttribute("aria-invalid", !text);
      if (text) what.removeAttribute("aria-describedby"); else { what.setAttribute("aria-describedby", error.id); what.focus(); return; }
      save.disabled = true;
      try {
        await options.store.add({ ...context(), part: part.label, selector: part.selector, what: text.slice(0, 4000),
          kind: kind.value, severity: form.severity.value, status: "open" });
        d.close();
        say("Note saved");
        refreshCount();
      } catch (err) {
        save.disabled = false;
        error.textContent = `Not saved: ${err.message || err}`;
        error.hidden = false;
      }
    });
    what.focus();
  }

  const severityLabel = (v) => (SEVERITY.find(([k]) => k === v) || [, v])[1];
  const when = (iso) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  function asText(notes) {
    const head = `${notes.length} UX ${notes.length === 1 ? "note" : "notes"} from ${options.app || location.host}${options.version ? ` ${options.version}` : ""}`;
    return [`## ${head}`, "", ...notes.map((n, i) => [
      `${i + 1}. **${n.kind}, ${severityLabel(n.severity).toLowerCase()}**${n.status === "fixed" ? " (fixed)" : ""} on ${n.page}: ${n.part}`,
      `   ${n.what.replace(/\n/g, "\n   ")}`,
      `   ${[n.selector && `\`${n.selector}\``, n.screen, n.theme, `text ${n.text}`, n.design && `design ${n.design}`,
        n.display?.length && n.display.join(", "), when(n.when)].filter(Boolean).join(" · ")}`,
    ].join("\n"))].join("\n");
  }

  async function openList() {
    const list = h("ol", { class: "ux-notes__list" });
    const draw = async () => {
      const notes = await options.store.list();
      list.replaceChildren(...notes.slice().reverse().map((n) => h("li", { class: n.status === "fixed" ? "ux-notes__item is-fixed" : "ux-notes__item" },
        h("div", { class: "ux-notes__meta" },
          h("strong", { text: `${n.kind}, ${severityLabel(n.severity).toLowerCase()}` }),
          h("span", { class: "muted", text: `${n.page} · ${when(n.when)}${n.status === "fixed" ? " · Fixed" : ""}` })),
        h("p", { class: "ux-notes__part muted", text: n.part }),
        h("p", { class: "ux-notes__what", text: n.what }),
        h("div", { class: "ux-notes__actions" },
          h("button", { type: "button", class: "btn btn--compact", text: n.status === "fixed" ? "Open again" : "Mark as fixed",
            onclick: async () => { await options.store.update(n.id, { status: n.status === "fixed" ? "open" : "fixed" }); draw(); refreshCount(); } }),
          h("button", { type: "button", class: "btn btn--compact", text: "Remove", "aria-label": `Remove the note: ${n.what.slice(0, 40)}`,
            onclick: async () => { await options.store.remove(n.id); draw(); refreshCount(); say("Note removed"); } })))));
      if (!notes.length) list.replaceChildren(h("li", { class: "muted", text: "No notes yet." }));
      return notes;
    };
    await draw();
    const copy = h("button", { type: "button", class: "btn btn--primary", text: "Copy as text", onclick: async () => {
      const text = asText(await options.store.list());
      try { await navigator.clipboard.writeText(text); say("Notes copied"); } catch { say("Copy did not work: use Download"); }
    } });
    const download = h("button", { type: "button", class: "btn", text: "Download", onclick: async () => {
      const notes = await options.store.list();
      const url = URL.createObjectURL(new Blob([JSON.stringify(notes, null, 2)], { type: "application/json" }));
      const a = h("a", { href: url, download: `ux-notes-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } });
    const d = dialog("UX notes", list, [copy, download, h("button", { type: "button", class: "btn", text: "Close", onclick: () => d.close() })], true);
  }

  async function refreshCount() {
    if (!count) return;
    try {
      const open = (await options.store.list()).filter((n) => n.status !== "fixed").length;
      count.textContent = String(open);
      count.parentElement.setAttribute("aria-label", `UX notes, ${open} open`);
    } catch { count.textContent = "?"; }
  }

  function start(opts = {}) {
    if (dock) return;
    options = { ...opts, store: opts.store || browserStore(`ux-notes:${opts.app || location.host}`) };
    count = h("span", { class: "ux-dock__count", text: "0" });
    dock = h("div", { class: "ux-dock", role: "region", "aria-label": "UX notes" },
      h("button", { type: "button", class: "btn btn--primary", onclick: startPicking }, svg("note"), "Note an issue"),
      h("button", { type: "button", class: "btn", "aria-label": "UX notes", onclick: openList }, svg("list"), h("span", { "aria-hidden": "true" }, count)));
    document.body.append(dock);
    refreshCount();
  }

  function stop() {
    endPicking(false);
    dock?.remove();
    dock = count = null;
  }

  window.UxNotes = { start, stop, asText };
})();
