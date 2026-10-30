import type { components } from "../api/schema";

type Filters = components["schemas"]["FollowFilters"];

const labels = {
  compilations: "Include compilations",
  box_sets: "Include box sets",
  anthologies: "Include anthologies",
  non_main_series: "Include non-main-series titles",
  coauthored: "Include co-authored books",
  comics: "Include comics and graphic novels",
  plays: "Include plays and screenplays",
  companions: "Include companions, diaries, maps and games",
  non_fiction: "Include non-fiction",
} as const;

export default function FollowFilterFields({
  value,
  change,
}: {
  value: Filters;
  change: (value: Filters) => void;
}) {
  return (
    <fieldset>
      <legend>Books to include</legend>
      {Object.entries(labels).map(([key, label]) => (
        <label className="check-label" key={key}>
          <input
            type="checkbox"
            checked={value[key as keyof typeof labels] ?? false}
            onChange={(e) => change({ ...value, [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      <label>
        Edition language (optional)
        <input
          value={value.language || ""}
          placeholder="en"
          pattern="[a-z]{2}"
          maxLength={2}
          onChange={(e) =>
            change({ ...value, language: e.target.value.toLowerCase() || null })
          }
        />
      </label>
      <p className="muted">
        Use a two-letter language code. Books without a matching edition are
        excluded. Collection filters use Hardcover series flags, titles and
        tags. Book types use Hardcover genre tags and title wording, such as
        “The Play” or “Diary 1998”.
      </p>
    </fieldset>
  );
}
