import type { ReactNode } from "react";
import { ArrowDownUp, Check, Search, X } from "lucide-react";
import "../section-toolbar.css";

/*
 * The section header and toolbar every collection page shares (design D, chosen 1 November 2026):
 * 1. the section heading and a summary line, with the view switch at the end;
 * 2. search, quick-filter chips, dropdown filter chips, then Sort and anything else at the end;
 * 3. when something is filtered, one removable chip per filter, Clear all, and how many show.
 */

export type QuickChip = {
  key: string;
  label: string;
  count?: number;
  pressed: boolean;
  onToggle: () => void;
};

export type FilterMenu = {
  key: string;
  label: string;
  value: string;
  // The option that means "no filter"; the chip turns accent-coloured when another is chosen.
  emptyValue: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
};

export type SortMenu = Omit<FilterMenu, "emptyValue" | "label"> & {
  reverse?: { pressed: boolean; onToggle: () => void };
};

export type AppliedFilter = {
  key: string;
  label: string;
  onRemove: () => void;
};

function MenuChip({
  label,
  value,
  options,
  onChange,
  set,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  set: boolean;
}) {
  return (
    <label className="toolbar-menu" data-set={set || undefined}>
      <span className="toolbar-menu-label">{label}:</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function SectionToolbar({
  title,
  summary,
  view,
  search,
  chips = [],
  menus = [],
  sort,
  end,
  applied = [],
  onClearAll,
  showing,
}: {
  title: string;
  summary?: ReactNode;
  view?: ReactNode;
  search?: {
    label: string;
    placeholder: string;
    value: string;
    onSearch: (value: string) => void;
  };
  chips?: QuickChip[];
  menus?: FilterMenu[];
  sort?: SortMenu;
  end?: ReactNode;
  applied?: AppliedFilter[];
  onClearAll?: () => void;
  showing?: ReactNode;
}) {
  return (
    <div className="section-toolbar">
      <div className="section-toolbar-head">
        <div>
          <h2>{title}</h2>
          {summary && <p className="section-toolbar-summary">{summary}</p>}
        </div>
        {view && <div className="section-toolbar-view">{view}</div>}
      </div>
      <div
        className="section-toolbar-filters"
        role="group"
        aria-label="Filters"
      >
        {search && (
          <form
            className="toolbar-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              search.onSearch(
                String(new FormData(event.currentTarget).get("q") || "").trim(),
              );
            }}
          >
            <Search size={16} aria-hidden="true" />
            <input
              key={search.value}
              name="q"
              type="search"
              defaultValue={search.value}
              maxLength={300}
              placeholder={search.placeholder}
              aria-label={search.label}
            />
            <button type="submit" className="sr-only">
              {search.label}
            </button>
          </form>
        )}
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className="toolbar-chip"
            aria-pressed={chip.pressed}
            onClick={chip.onToggle}
          >
            {chip.label}
            {chip.count != null && (
              <span className="toolbar-chip-count">
                {chip.count.toLocaleString("en-GB")}
              </span>
            )}
          </button>
        ))}
        {menus.map((menu) => (
          <MenuChip
            key={menu.key}
            label={menu.label}
            value={menu.value}
            options={menu.options}
            onChange={menu.onChange}
            set={menu.value !== menu.emptyValue}
          />
        ))}
        <span className="section-toolbar-spacer" />
        {sort && (
          <>
            <MenuChip
              label="Sort"
              value={sort.value}
              options={sort.options}
              onChange={sort.onChange}
              set={false}
            />
            {sort.reverse && (
              <button
                type="button"
                className="toolbar-chip"
                aria-pressed={sort.reverse.pressed}
                onClick={sort.reverse.onToggle}
              >
                <ArrowDownUp size={15} aria-hidden="true" /> Reverse order
              </button>
            )}
          </>
        )}
        {end}
      </div>
      {applied.length > 0 && (
        <div className="section-toolbar-applied">
          <span className="section-toolbar-applied-label">Filtered by</span>
          {applied.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className="toolbar-chip toolbar-chip-applied"
              aria-label={`Remove filter: ${filter.label}`}
              onClick={filter.onRemove}
            >
              {filter.label}
              <X size={14} aria-hidden="true" />
            </button>
          ))}
          {onClearAll && (
            <button type="button" className="text-button" onClick={onClearAll}>
              Clear all
            </button>
          )}
          <span className="section-toolbar-spacer" />
          {showing && (
            <span className="section-toolbar-showing">{showing}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Saves the tab's current filters and order as the person's default (their account, not the browser). */
export function SaveViewButton({
  isDefault,
  saving,
  onSave,
}: {
  isDefault: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  return isDefault ? (
    <span className="toolbar-saved" role="status">
      <Check size={15} aria-hidden="true" /> Your default view
    </span>
  ) : (
    <button
      type="button"
      className="toolbar-chip"
      disabled={saving}
      onClick={onSave}
    >
      {saving ? "Saving…" : "Save as default"}
    </button>
  );
}
