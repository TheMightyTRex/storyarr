import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Plus,
  Radio as RadioIcon,
  RadioTower,
  RefreshCw,
} from "lucide-react";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Empty, Loading, Notice } from "../components";
import BookDialog from "../components/BookDialog";
import SectionToolbar from "../components/SectionToolbar";
import LogoMask from "../components/LogoMask";
import LogoPanel from "../components/LogoPanel";
import ShowArt from "../components/ShowArt";
import {
  CollectionViewSwitch,
  useCollectionView,
} from "../components/GroupShelf";
import SidePanel from "../components/SidePanel";
import StatusChip from "../components/StatusChip";
import { usePreferences } from "../hooks/usePreferences";
import { currentParams } from "../currentParams";
import RadioReview, { RadioReviewNotice, useRadioReview } from "./RadioReview";
import "../radio.css";

type Show = components["schemas"]["RadioShowSummary"];
type Detail = components["schemas"]["RadioShowDetail"];
type Station = components["schemas"]["RadioStationView"];
type SeriesView = components["schemas"]["RadioSeriesView"];
type Episode = components["schemas"]["RadioEpisodeView"];
type Preview = components["schemas"]["RadioShowPreview"];
type Follow = Show["follow"];

const base = "/library/radio";
export const showPage = (id: string) => `${base}/shows/${id}`;
const stationPage = (id: string) =>
  `${base}/stations/${encodeURIComponent(id)}`;
const NO_STATION = "none";

const followChoices: { value: Follow; label: string; hint: string }[] = [
  {
    value: "all",
    label: "All series",
    hint: "Storyarr wants every broadcast episode and new ones as they are broadcast.",
  },
  {
    value: "from_now_on",
    label: "From now on",
    hint: "Only episodes broadcast from now on. Earlier episodes stay Not requested.",
  },
  {
    value: "none",
    label: "None",
    hint: "Keeps the show and its episode list. Storyarr wants nothing.",
  },
];

/** What the follow choice means for this show, with how many episodes it wants now. */
function followNote(follow: Follow, since: string | null, wanted: number) {
  const count =
    wanted === 1 ? "1 episode is wanted" : `${wanted} episodes are wanted`;
  if (follow === "none")
    return "Storyarr wants nothing from this show. The episode list still updates.";
  const rule =
    follow === "all"
      ? "Storyarr wants every episode that is not in your library, and new ones after each broadcast."
      : `Storyarr wants episodes first broadcast from ${since ? day(since, true) : "today"} onwards.`;
  return `${rule} ${count}.`;
}
const followLabel = (follow: Follow) =>
  follow === "all"
    ? "Following · all series"
    : follow === "from_now_on"
      ? "Following · from now on"
      : "Not followed";

const day = (value?: string | null, long = false) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: long ? "long" : "short",
        year: "numeric",
        timeZone: "Europe/London",
      })
    : "";
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const minutes = (seconds?: number | null) =>
  seconds ? `${Math.max(1, Math.round(seconds / 60))} min` : "Not known yet";
const pad = (n: number) => String(n).padStart(2, "0");
export function episodeCode(
  series: Pick<SeriesView, "kind" | "number">,
  episode: Pick<Episode, "number">,
) {
  return series.kind === "specials"
    ? `Special ${episode.number}`
    : `S${pad(series.number)}E${pad(episode.number)}`;
}
const seriesName = (series: Pick<SeriesView, "kind" | "number">) =>
  series.kind === "specials" ? "Specials" : `Series ${series.number}`;
const refreshing = (show: Pick<Show, "refresh">) =>
  !!show.refresh &&
  ["queued", "running", "retrying"].includes(show.refresh.status);

function chipFor(episode: Episode) {
  const { status } = episode;
  if (status.kind === "not_released" && episode.first_broadcast)
    return {
      label: `Not released · ${day(episode.first_broadcast)}`,
      status: "Not released",
    };
  return { label: status.label, status: status.label };
}

/** My library, Radio: Shows and Stations (a switch at the start of the toolbar), a station, a show. */
export default function RadioLibrary({ canEdit }: { canEdit: boolean }) {
  return (
    <Routes>
      <Route index element={<RadioShows canEdit={canEdit} />} />
      <Route path="stations" element={<RadioStations />} />
      <Route path="stations/:stationId" element={<RadioStation />} />
      <Route path="shows/:showId" element={<RadioShow canEdit={canEdit} />} />
      <Route path="review" element={<RadioReview canEdit={canEdit} />} />
      <Route path="*" element={<RadioShows canEdit={canEdit} />} />
    </Routes>
  );
}

/** Shows and Stations, each with its own address, as the library's segmented switch. */
function RadioSwitch({ current }: { current: "shows" | "stations" }) {
  const navigate = useNavigate();
  return (
    <fieldset className="segmented radio-switch">
      <legend className="sr-only">Radio</legend>
      {(
        [
          ["shows", "Shows", RadioIcon, base],
          ["stations", "Stations", RadioTower, `${base}/stations`],
        ] as const
      ).map(([value, label, Icon, to]) => (
        <label key={value}>
          <input
            type="radio"
            name="radio-view"
            value={value}
            checked={current === value}
            onChange={() => navigate(to)}
          />
          <span>
            <Icon size={16} aria-hidden="true" />
            {label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function useShows(params: { station?: string; followed?: boolean }) {
  return useQuery({
    queryKey: ["radio", "shows", params],
    queryFn: async () =>
      result(
        await api.GET("/api/radio/shows", {
          params: {
            query: {
              station:
                params.station && params.station !== NO_STATION
                  ? params.station
                  : undefined,
              followed: params.followed,
            },
          },
        }),
      ),
    refetchInterval: (query) =>
      query.state.data?.items.some(refreshing) ? 4000 : false,
  });
}

/** A show in the cover grid: the artwork in the book shape, its name in two lines, station and size. */
export function ShowCard({ show }: { show: Show }) {
  const station = show.station?.name;
  return (
    <div className="media-card cover-card show-card">
      <Link
        className="cover-card__open"
        to={showPage(show.id)}
        aria-label={show.title}
      />
      <div className="cover-card__art">
        <ShowArt
          title={show.title}
          station={station}
          artwork={show.artwork_url}
        />
      </div>
      <h3 className="media-card__title" title={show.title}>
        {show.title}
      </h3>
      <span className="media-card__meta">
        {station || "No station given"} ·{" "}
        {plural(show.series_count, "series", "series")}
      </span>
      <span className="media-card__meta">
        {refreshing(show)
          ? "Reading the episode list…"
          : plural(show.episode_count, "episode")}
      </span>
      {show.follow !== "none" && (
        <StatusChip
          className="show-card__chip"
          label="Following"
          icon={Bookmark}
          tone="neutral"
        />
      )}
    </div>
  );
}

export function ShowGrid({ shows }: { shows: Show[] }) {
  const size = usePreferences().preferences?.cover_size ?? "medium";
  return (
    <div className="shelf-wall show-grid" data-size={size}>
      {shows.map((show) => (
        <ShowCard key={show.id} show={show} />
      ))}
    </div>
  );
}

/** Radio shows beside book series: the Series tab's Radio chip (FEAT-R, R2). */
export function RadioShowsShelf({ q }: { q: string }) {
  const shows = useShows({});
  const words = q.toLocaleLowerCase();
  const items = (shows.data?.items ?? []).filter(
    (show) => !words || show.title.toLocaleLowerCase().includes(words),
  );
  return (
    <>
      <Notice error={shows.error} />
      {shows.isPending && <Loading />}
      {shows.data &&
        (items.length ? (
          <ShowGrid shows={items} />
        ) : (
          <Empty title="No radio shows to show">
            Add a show from <Link to={base}>My library, Radio</Link>.
          </Empty>
        ))}
    </>
  );
}

/**
 * Shows as a list beside the chosen show, like My library, Series and Authors (TheMightyTRexUK, 2 November 2026):
 * the pane is the show page's own header (artwork on the right) with its series and episodes.
 */
function ShowSplit({
  shows,
  picked,
  onPick,
  canEdit,
}: {
  shows: Show[];
  picked: string | null;
  onPick: (id: string) => void;
  canEdit: boolean;
}) {
  const current = shows.find((show) => show.id === picked) || shows[0];
  return (
    <div className="group-split">
      <nav className="group-picker" aria-label="Radio shows">
        <ul>
          {shows.map((show) => (
            <li key={show.id}>
              <button
                type="button"
                className="group-pick"
                aria-current={show.id === current.id || undefined}
                onClick={() => onPick(show.id)}
              >
                <span className="group-pick-cover" aria-hidden="true">
                  <ShowArt
                    title={show.title}
                    station={show.station?.name}
                    artwork={show.artwork_url}
                  />
                </span>
                <span className="group-pick-text">
                  <span className="group-title">{show.title}</span>
                  <span className="muted">
                    {show.station?.name || "No station given"} ·{" "}
                    {plural(show.episode_count, "episode")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section
        className="group-detail group-detail--series"
        aria-label={current.title}
      >
        <RadioShow
          key={current.id}
          canEdit={canEdit}
          id={current.id}
          embedded
        />
      </section>
    </div>
  );
}

function RadioShows({ canEdit }: { canEdit: boolean }) {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") || "").slice(0, 100);
  const follow = params.get("follow");
  const sort = params.get("sort") === "newest" ? "newest" : "name";
  const [adding, setAdding] = useState(false);
  const layout = useCollectionView();
  const shows = useShows({
    followed:
      follow === "following" ? true : follow === "not" ? false : undefined,
  });
  const all = useShows({});
  const review = useRadioReview(canEdit);
  function change(key: string, value: string) {
    const next = currentParams();
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }
  const items = useMemo(() => {
    const words = q.toLocaleLowerCase();
    const list = (shows.data?.items ?? []).filter(
      (show) => !words || show.title.toLocaleLowerCase().includes(words),
    );
    if (sort === "newest")
      list.sort((a, b) =>
        (b.first_broadcast || "").localeCompare(a.first_broadcast || ""),
      );
    return list;
  }, [shows.data, q, sort]);
  const counts = all.data?.items ?? [];
  const followingCount = counts.filter((show) => show.follow !== "none").length;
  const episodes = counts.reduce((n, show) => n + show.episode_count, 0);
  return (
    <section aria-label="Radio shows" className="radio-library">
      <SectionToolbar
        title="Radio"
        summary={
          all.data
            ? `${plural(counts.length, "show")} · ${plural(episodes, "episode")}`
            : "Loading…"
        }
        start={<RadioSwitch current="shows" />}
        view={
          <CollectionViewSwitch view={layout.view} onChange={layout.setView} />
        }
        search={{
          label: "Search your radio shows",
          placeholder: "Show name",
          value: q,
          onSearch: (value) => change("q", value),
        }}
        chips={[
          {
            key: "following",
            label: "Following",
            count: all.data ? followingCount : undefined,
            pressed: follow === "following",
            onToggle: () =>
              change("follow", follow === "following" ? "" : "following"),
          },
          {
            key: "not",
            label: "Not followed",
            count: all.data ? counts.length - followingCount : undefined,
            pressed: follow === "not",
            onToggle: () => change("follow", follow === "not" ? "" : "not"),
          },
        ]}
        sort={{
          key: "sort",
          value: sort,
          options: [
            { value: "name", label: "Name" },
            { value: "newest", label: "Newest first broadcast" },
          ],
          onChange: (value) => change("sort", value === "name" ? "" : value),
        }}
        end={
          canEdit && (
            <button
              type="button"
              className="primary radio-add"
              onClick={() => setAdding(true)}
            >
              <Plus size={16} aria-hidden="true" /> Add a show
            </button>
          )
        }
        applied={[
          ...(q
            ? [{ key: "q", label: `“${q}”`, onRemove: () => change("q", "") }]
            : []),
          ...(follow
            ? [
                {
                  key: "follow",
                  label: follow === "following" ? "Following" : "Not followed",
                  onRemove: () => change("follow", ""),
                },
              ]
            : []),
        ]}
        onClearAll={() => setParams({})}
        showing={`Showing ${plural(items.length, "show")}`}
      />
      <Notice error={shows.error} />
      {canEdit && <RadioReviewNotice review={review.data} />}
      {shows.isPending && <Loading />}
      {shows.data &&
        (items.length ? (
          layout.view === "detail" ? (
            <ShowSplit
              shows={items}
              picked={params.get("pick")}
              onPick={(id) => {
                const next = currentParams();
                next.set("pick", id);
                setParams(next, { replace: true });
              }}
              canEdit={canEdit}
            />
          ) : (
            <ShowGrid shows={items} />
          )
        ) : (
          <Empty
            title={
              shows.data.items.length
                ? "No shows match this view"
                : "No radio shows yet"
            }
          >
            {shows.data.items.length
              ? "Try clearing the filters."
              : canEdit
                ? "Add a show from a BBC programmes or BBC Sounds link, or by its name."
                : "Shows appear here when someone adds them."}
          </Empty>
        ))}
      {adding && <AddShow close={() => setAdding(false)} />}
    </section>
  );
}

export function StationLogo({
  station,
}: {
  station: { name: string; logo_url?: string | null };
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="logo-tile" aria-hidden="true">
      {station.logo_url && !failed ? (
        <img src={station.logo_url} alt="" onError={() => setFailed(true)} />
      ) : (
        <span className="logo-tile__text">{station.name}</span>
      )}
    </span>
  );
}

function RadioStations() {
  const stations = useQuery({
    queryKey: ["radio", "stations"],
    queryFn: async () => result(await api.GET("/api/radio/stations")),
  });
  const shows = useShows({});
  const [params, setParams] = useSearchParams();
  const sort = params.get("sort") === "shows" ? "shows" : "name";
  const items = useMemo(() => {
    const list: Station[] = [...(stations.data?.items ?? [])];
    const without = (shows.data?.items ?? []).filter(
      (show) => !show.station && !show.stations.length,
    ).length;
    if (without)
      list.push({
        id: NO_STATION,
        name: "No station given",
        show_count: without,
      });
    if (sort === "shows") list.sort((a, b) => b.show_count - a.show_count);
    return list;
  }, [stations.data, shows.data, sort]);
  const following = (id: string) =>
    (shows.data?.items ?? []).filter(
      (show) =>
        show.follow !== "none" &&
        (id === NO_STATION
          ? !show.station && !show.stations.length
          : show.stations.some((station) => station.id === id) ||
            show.station?.id === id),
    ).length;
  return (
    <section aria-label="Radio stations" className="radio-library">
      <SectionToolbar
        title="Radio"
        summary={stations.data ? plural(items.length, "station") : "Loading…"}
        start={<RadioSwitch current="stations" />}
        sort={{
          key: "sort",
          value: sort,
          options: [
            { value: "name", label: "Name" },
            { value: "shows", label: "Most shows" },
          ],
          onChange: (value) =>
            setParams(value === "name" ? {} : { sort: value }),
        }}
      />
      <Notice error={stations.error} />
      {stations.isPending && <Loading />}
      {stations.data &&
        (items.length ? (
          <ul className="cards station-cards">
            {items.map((station) => (
              <li className="card station-card" key={station.id}>
                <StationLogo station={station} />
                <h3 className="card__title">
                  <Link to={stationPage(station.id)}>{station.name}</Link>
                </h3>
                <p className="small muted">
                  {plural(station.show_count, "show")} · {following(station.id)}{" "}
                  following
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No stations yet">
            Stations appear here when you add a radio show.
          </Empty>
        ))}
      {!!items.length && (
        <p className="muted small">
          A show is listed under each station that first broadcast one of its
          series. Repeats on other stations do not count.
        </p>
      )}
    </section>
  );
}

function RadioStation() {
  const { stationId = "" } = useParams();
  const stations = useQuery({
    queryKey: ["radio", "stations"],
    queryFn: async () => result(await api.GET("/api/radio/stations")),
  });
  const shows = useShows({ station: stationId });
  const none = stationId === NO_STATION;
  const station = none
    ? { id: NO_STATION, name: "No station given", logo_url: null }
    : stations.data?.items.find((item) => item.id === stationId);
  const list = (shows.data?.items ?? []).filter((show) =>
    none ? !show.station && !show.stations.length : true,
  );
  const own = list.filter((show) => none || show.station?.id === stationId);
  const also = list.filter((show) => !none && show.station?.id !== stationId);
  const name = station?.name ?? (stations.isPending ? "Station" : stationId);
  const following = list.filter((show) => show.follow !== "none").length;
  return (
    <section className="radio-station" aria-labelledby="station-name">
      <Link className="back-link" to={`${base}/stations`}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to Stations
      </Link>
      <header className="item-header radio-station-head">
        <div className="item-header__art">
          <StationLogo station={station ?? { name }} />
        </div>
        <div className="item-header__text">
          <h1 id="station-name">{name}</h1>
          <p className="item-header__byline">
            Station · {plural(list.length, "show")} in your library ·{" "}
            {following} following
          </p>
        </div>
      </header>
      <Notice error={shows.error || stations.error} />
      {shows.isPending && <Loading />}
      {shows.data &&
        (list.length ? (
          <>
            <h2 className="radio-section-title">Shows</h2>
            <ShowGrid shows={own} />
            {!!also.length && (
              <>
                <h2 className="radio-section-title">
                  Also first broadcast on {name}
                </h2>
                <p className="muted">
                  These shows started on another station; at least one of their
                  series was first broadcast on {name}.
                </p>
                <ShowGrid shows={also} />
              </>
            )}
          </>
        ) : (
          <Empty title="No shows on this station">
            Add a show from My library, Radio.
          </Empty>
        ))}
    </section>
  );
}

function broadcastCount(episodes: Episode[]) {
  const aired = episodes.filter((ep) => ep.status.kind !== "not_released");
  const have = aired.filter((ep) => ep.status.kind === "in_library").length;
  return { aired: aired.length, have };
}

function Progress({
  have,
  aired,
  label,
}: {
  have: number;
  aired: number;
  label: string;
}) {
  const percent = aired ? Math.round((have / aired) * 100) : 0;
  return (
    <div className="meter radio-progress">
      <span className="small">
        {have} of {plural(aired, "broadcast episode")} in your library (
        {percent}%)
      </span>
      <div
        className="progress"
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function RadioShow({
  canEdit,
  id,
  embedded = false,
}: {
  canEdit: boolean;
  /** The show to read, when it is not in the address (My library, Radio's list and detail). */
  id?: string;
  /** In the list's right-hand pane: no back link and the name as a level 2 heading. */
  embedded?: boolean;
}) {
  const params = useParams();
  const showId = id ?? params.showId ?? "";
  const Heading = embedded ? "h2" : "h1";
  const cache = useQueryClient();
  const show = useQuery({
    queryKey: ["radio", "show", showId],
    queryFn: async () =>
      result(
        await api.GET("/api/radio/shows/{show_id}", {
          params: { path: { show_id: showId } },
        }),
      ),
    refetchInterval: (query) =>
      query.state.data && refreshing(query.state.data) ? 3000 : false,
  });
  const follow = useMutation({
    mutationFn: async (value: Follow) =>
      result(
        await api.PATCH("/api/radio/shows/{show_id}", {
          params: { path: { show_id: showId } },
          body: { follow: value },
        }),
      ),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["radio"] }),
  });
  const refresh = useMutation({
    mutationFn: async () =>
      result(
        await api.POST("/api/radio/shows/{show_id}/refresh", {
          params: { path: { show_id: showId } },
        }),
      ),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["radio"] }),
  });
  // The calendar links to /library/radio/shows/{id}?episode={episode id}.
  const [search] = useSearchParams();
  const [episodeId, setEpisodeId] = useState<string | null>(() =>
    search.get("episode"),
  );
  const [logoOpen, setLogoOpen] = useState(false);
  const [logoMessage, setLogoMessage] = useState("");
  if (show.isPending) return <Loading />;
  if (show.error || !show.data)
    return (
      <>
        {!embedded && (
          <Link className="back-link" to={base}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to Radio
          </Link>
        )}
        <Notice error={show.error} />
      </>
    );
  const data = show.data;
  const episodes = data.series.flatMap((series) => series.episodes);
  const { aired, have } = broadcastCount(episodes);
  const others = data.stations.filter(
    (station) => station.id !== data.station?.id,
  );
  const meta = [
    data.station?.name,
    data.first_broadcast &&
      `First broadcast ${day(data.first_broadcast, true)}`,
    `${plural(data.series_count, "series", "series")}, ${plural(data.episode_count, "episode")}`,
    others.length &&
      `Also on ${others.map((station) => station.name).join(", ")}`,
  ].filter(Boolean);
  const pending = refreshing(data);
  const failed = data.refresh?.status === "failed";
  return (
    <article className="radio-show" aria-labelledby="show-name">
      {!embedded && (
        <Link className="back-link" to={base}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to Radio
        </Link>
      )}
      <header className="radio-show-head">
        <div className="radio-show-head__text">
          {/* The show logo in one colour (UX-43), or the name set as a wordmark. */}
          {data.logo && (
            <LogoMask
              url={data.logo.url}
              label={data.title}
              colour={data.logo.colour}
            />
          )}
          <Heading
            id="show-name"
            className={data.logo ? "series-head__name" : "radio-wordmark"}
          >
            {data.title}
          </Heading>
          <p className="radio-show-meta">
            {meta.map((item, index) => (
              <span key={index}>
                {data.station && index === 0 ? (
                  <Link to={stationPage(data.station.id)}>{item}</Link>
                ) : (
                  item
                )}
              </span>
            ))}
          </p>
          {data.synopsis && (
            <p className="radio-show-synopsis">{data.synopsis}</p>
          )}
          <div className="item-header__chips">
            <StatusChip
              label={followLabel(data.follow)}
              icon={Bookmark}
              tone={data.follow === "none" ? "muted" : "neutral"}
            />
            <StatusChip label="Radio" icon={RadioIcon} tone="neutral" />
          </div>
          <Progress
            have={have}
            aired={aired}
            label={`${data.title}: episodes in your library`}
          />
          {canEdit && (
            <div className="radio-show-actions">
              <fieldset className="radio-follow">
                <legend>Follow</legend>
                <div className="segmented">
                  {followChoices.map((choice) => (
                    <label key={choice.value} title={choice.hint}>
                      <input
                        type="radio"
                        name="radio-follow"
                        value={choice.value}
                        checked={
                          (follow.isPending
                            ? follow.variables
                            : data.follow) === choice.value
                        }
                        disabled={follow.isPending}
                        onChange={() => follow.mutate(choice.value)}
                      />
                      <span>{choice.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                type="button"
                className="radio-refresh"
                disabled={pending || refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                <RefreshCw
                  size={16}
                  aria-hidden="true"
                  className={pending ? "source-download-spinner" : undefined}
                />
                {pending ? "Refreshing…" : "Refresh"}
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                aria-haspopup="dialog"
                onClick={() => setLogoOpen(true)}
              >
                {data.logo ? "Change logo" : "Add a logo"}
              </button>
            </div>
          )}
          <p className="small radio-follow-note">
            {followNote(data.follow, data.followed_at, data.wanted_count ?? 0)}
            {(data.wanted_count ?? 0) > 0 && (
              <>
                {" "}
                <Link to={`/requests?q=${encodeURIComponent(data.title)}`}>
                  See them in Requests
                </Link>
              </>
            )}
          </p>
          <p className="small muted" role="status">
            {pending
              ? "Reading the BBC programme list. New series and episodes appear as they are found."
              : failed
                ? `The last refresh failed: ${data.refresh?.message}`
                : data.refreshed_at
                  ? `Episode list read ${day(data.refreshed_at, true)}.`
                  : ""}
            {follow.isSuccess && !follow.isPending && " Follow choice saved."}
            {logoMessage && ` ${logoMessage}`}
          </p>
          <Notice error={follow.error || refresh.error} />
        </div>
        <div className="radio-show-head__art">
          <ShowArt
            title={data.title}
            station={data.station?.name}
            artwork={data.artwork_url}
          />
        </div>
      </header>
      {logoOpen && (
        <LogoPanel
          target={{ kind: "show", showId: data.id }}
          name={data.title}
          people={[]}
          logo={data.logo}
          covers={
            data.artwork_url
              ? [{ label: "Artwork", title: data.title, url: data.artwork_url }]
              : []
          }
          onClose={() => setLogoOpen(false)}
          onChanged={(message) => {
            setLogoMessage(message);
            void cache.invalidateQueries({ queryKey: ["radio"] });
          }}
        />
      )}
      <ShowEpisodes data={data} open={(id) => setEpisodeId(id)} />
      {episodeId && (
        <EpisodePanel
          data={data}
          episodeId={episodeId}
          canEdit={canEdit}
          move={setEpisodeId}
          close={() => setEpisodeId(null)}
        />
      )}
    </article>
  );
}

function ShowEpisodes({
  data,
  open,
}: {
  data: Detail;
  open: (id: string) => void;
}) {
  const series = useMemo(
    () =>
      [...data.series].sort((a, b) =>
        a.kind !== b.kind
          ? a.kind === "specials"
            ? 1
            : -1
          : b.number - a.number,
      ),
    [data.series],
  );
  const [opened, setOpened] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      series.map((item, index) => [
        item.id,
        index === 0 ||
          item.episodes.some((ep) => ep.status.kind === "not_released"),
      ]),
    ),
  );
  const [filter, setFilter] = useState<string | null>(null);
  const counts = new Map<string, { label: string; count: number }>();
  for (const ep of series.flatMap((item) => item.episodes)) {
    const entry = counts.get(ep.status.kind) ?? {
      label: ep.status.label,
      count: 0,
    };
    entry.count += 1;
    counts.set(ep.status.kind, entry);
  }
  const jump = (id: string) => {
    setOpened((now) => ({ ...now, [id]: true }));
    requestAnimationFrame(() => {
      const element = document.getElementById(`series-${id}`);
      element?.scrollIntoView({ block: "start" });
      element?.querySelector("summary")?.focus({ preventScroll: true });
    });
  };
  const shown = series.filter(
    (item) => !filter || item.episodes.some((ep) => ep.status.kind === filter),
  );
  return (
    <section className="radio-episodes" aria-labelledby="episodes-title">
      <h2 id="episodes-title">Episodes</h2>
      <div className="radio-episodes-toolbar" role="group" aria-label="Filters">
        {series.length > 1 && (
          <label className="toolbar-menu">
            <span className="toolbar-menu-label">Go to series:</span>
            <select
              aria-label="Go to series"
              value=""
              onChange={(event) =>
                event.target.value && jump(event.target.value)
              }
            >
              <option value="">Choose a series</option>
              {series.map((item) => (
                <option key={item.id} value={item.id}>
                  {seriesName(item)}
                </option>
              ))}
            </select>
          </label>
        )}
        {[...counts].map(([kind, { label, count }]) => (
          <button
            key={kind}
            type="button"
            className="toolbar-chip"
            aria-pressed={filter === kind}
            onClick={() => setFilter(filter === kind ? null : kind)}
          >
            {label}
            <span className="toolbar-chip-count">{count}</span>
          </button>
        ))}
        <span className="muted small radio-episodes-count">
          {plural(data.series_count, "series", "series")} ·{" "}
          {plural(data.episode_count, "episode")}
        </span>
      </div>
      {!series.length && (
        <Empty title="No episodes yet">
          {refreshing(data)
            ? "Storyarr is reading the BBC programme list for this show."
            : "The BBC lists no series or episodes for this show yet."}
        </Empty>
      )}
      <div className="radio-series-list">
        {shown.map((item) => {
          const { aired, have } = broadcastCount(item.episodes);
          const year = item.first_broadcast?.slice(0, 4);
          const rows = item.episodes.filter(
            (ep) => !filter || ep.status.kind === filter,
          );
          const upcoming = item.episodes.filter(
            (ep) => ep.status.kind === "not_released",
          ).length;
          return (
            <details
              key={item.id}
              id={`series-${item.id}`}
              className="disclosure radio-series"
              open={!!filter || !!opened[item.id]}
              onToggle={(event) => {
                const now = event.currentTarget.open;
                setOpened((was) =>
                  was[item.id] === now ? was : { ...was, [item.id]: now },
                );
              }}
            >
              <summary>
                <span className="radio-series-summary">
                  <span>{seriesName(item)}</span>
                  <span className="disclosure__meta">
                    {[
                      year,
                      plural(item.episodes.length, "episode"),
                      `${have} of ${aired} broadcast in library`,
                      upcoming && `${upcoming} not released`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </summary>
              <div className="disclosure__body">
                {item.title && item.title !== seriesName(item) && (
                  <p className="muted small">{item.title}</p>
                )}
                <Progress
                  have={have}
                  aired={aired}
                  label={`${seriesName(item)} progress`}
                />
                {item.episodes.length ? (
                  <div className="table-wrap" data-stack="">
                    <table className="table radio-episode-table">
                      <caption className="sr-only">
                        {seriesName(item)} episodes
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Episode</th>
                          <th scope="col">Title</th>
                          <th scope="col">First broadcast</th>
                          <th scope="col">Length</th>
                          <th scope="col">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((ep) => (
                          <tr key={ep.id}>
                            <td data-label="Episode" className="radio-code">
                              {episodeCode(item, ep)}
                            </td>
                            <td data-label="Title">
                              <button
                                type="button"
                                className="text-button radio-episode-open"
                                onClick={() => open(ep.id)}
                              >
                                {ep.title}
                              </button>
                            </td>
                            <td data-label="First broadcast">
                              {day(ep.first_broadcast) || "Date not known"}
                            </td>
                            <td data-label="Length">
                              {minutes(ep.duration_seconds)}
                            </td>
                            <td data-label="Status">
                              <StatusChip {...chipFor(ep)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">
                    The BBC lists no episodes for this series yet.
                  </p>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function EpisodePanel({
  data,
  episodeId,
  canEdit,
  move,
  close,
}: {
  data: Detail;
  episodeId: string;
  canEdit: boolean;
  move: (id: string) => void;
  close: () => void;
}) {
  const order = data.series
    .slice()
    .sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === "specials"
          ? 1
          : -1
        : b.number - a.number,
    )
    .flatMap((series) => series.episodes.map((ep) => ({ series, ep })));
  const at = order.findIndex((item) => item.ep.id === episodeId);
  const current = order[at];
  if (!current) return null;
  const { series, ep } = current;
  const code = episodeCode(series, ep);
  const previous = order[at - 1];
  const next = order[at + 1];
  return (
    <SidePanel
      title={`Episode ${code}`}
      closeLabel="Close episode details"
      className="radio-episode-panel"
      onClose={close}
      footer={
        <div className="radio-episode-steps">
          <button
            type="button"
            disabled={!previous}
            onClick={() => previous && move(previous.ep.id)}
          >
            <ChevronLeft size={16} aria-hidden="true" /> Previous episode
          </button>
          <button
            type="button"
            disabled={!next}
            onClick={() => next && move(next.ep.id)}
          >
            Next episode <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      }
    >
      <div className="side-panel__lead radio-episode-lead">
        <ShowArt
          title={data.title}
          station={(series.station ?? data.station)?.name}
          artwork={data.artwork_url}
        />
        <div>
          <p className="small muted">
            {data.title} ·{" "}
            {series.kind === "specials"
              ? `Special ${ep.number}`
              : `Series ${series.number}, episode ${ep.number}`}
          </p>
          <h3 className="radio-episode-title">
            {code} · {ep.title}
          </h3>
          <StatusChip {...chipFor(ep)} />
          <p className="small muted">
            {minutes(ep.duration_seconds)}
            {ep.first_broadcast &&
              ` · first broadcast ${day(ep.first_broadcast, true)}`}
          </p>
        </div>
      </div>
      {ep.synopsis && <p>{ep.synopsis}</p>}
      {ep.status.detail && <p className="muted">{ep.status.detail}</p>}
      <dl className="facts">
        <dt>Station</dt>
        <dd>{(series.station ?? data.station)?.name || "No station given"}</dd>
        <dt>BBC programme ID</dt>
        <dd>
          <a
            href={`https://www.bbc.co.uk/programmes/${ep.pid}`}
            target="_blank"
            rel="noreferrer"
          >
            {ep.pid}
          </a>
        </dd>
        <EpisodeFile episodeId={ep.id} canEdit={canEdit} />
        <EpisodeRequest episodeId={ep.id} />
      </dl>
    </SidePanel>
  );
}

/** The open request for a wanted episode (R4), with a link to it in Requests. */
function EpisodeRequest({ episodeId }: { episodeId: string }) {
  const detail = useEpisodeDetail(episodeId);
  const request = detail.data?.request;
  if (!request) return null;
  return (
    <>
      <dt>Request</dt>
      <dd>
        {request.message}{" "}
        <Link to={`/requests?q=${encodeURIComponent(request.title)}`}>
          See it in Requests
        </Link>
      </dd>
    </>
  );
}

function useEpisodeDetail(episodeId: string) {
  return useQuery({
    queryKey: ["radio", "episode", episodeId],
    queryFn: async ({ signal }) =>
      result(
        await api.GET("/api/radio/episodes/{episode_id}", {
          params: { path: { episode_id: episodeId } },
          signal,
        }),
      ),
  });
}

/** The radio library file that holds an episode: its name, size and library. */
/** The file that holds the episode, with "Not this file" and, after a choice by hand, a way back. */
function EpisodeFile({
  episodeId,
  canEdit,
}: {
  episodeId: string;
  canEdit: boolean;
}) {
  const cache = useQueryClient();
  const change = useMutation({
    mutationFn: async (automatic: boolean) =>
      result(
        automatic
          ? await api.DELETE("/api/radio/episodes/{episode_id}/file", {
              params: { path: { episode_id: episodeId } },
            })
          : await api.PUT("/api/radio/episodes/{episode_id}/file", {
              params: { path: { episode_id: episodeId } },
              body: { file_id: null },
            }),
      ),
    onSuccess: (saved) => {
      cache.setQueryData(["radio", "episode", episodeId], saved);
      void cache.invalidateQueries({ queryKey: ["radio", "show"] });
      void cache.invalidateQueries({ queryKey: ["radio", "review"] });
    },
  });
  const detail = useEpisodeDetail(episodeId);
  const file = detail.data?.file;
  const manual = detail.data?.file_manual;
  if (!file && !manual) return null;
  return (
    <>
      <dt>File</dt>
      <dd>
        {file ? (
          <>
            {file.name}
            <span className="small muted">
              {" "}
              ·{" "}
              {(file.size / 1_000_000).toLocaleString("en-GB", {
                maximumFractionDigits: 1,
              })}{" "}
              MB in {file.library}
              {manual && " · chosen by hand"}
            </span>
          </>
        ) : (
          <span className="muted">No file (chosen by hand)</span>
        )}
        {canEdit && (
          <span className="button-row radio-file-actions">
            {file && (
              <button
                type="button"
                disabled={change.isPending}
                onClick={() => change.mutate(false)}
              >
                Not this file
              </button>
            )}
            {manual && (
              <button
                type="button"
                disabled={change.isPending}
                onClick={() => change.mutate(true)}
              >
                Match automatically again
              </button>
            )}
          </span>
        )}
        <Notice error={change.error} />
      </dd>
    </>
  );
}

const looksLikeLink = (value: string) =>
  /bbc\.co\.uk\//i.test(value) || /^[bpmw][0-9a-z]{7,15}$/i.test(value.trim());
const programmeLink = (pid: string) =>
  `https://www.bbc.co.uk/programmes/${pid}`;

/**
 * Add a show: a link or a name, a preview, the follow choice (From now on by default), then the
 * show. From the radio library review it starts with the library show's name and keeps its files.
 */
export function AddShow({
  close,
  pid,
  initialText = "",
  libraryItemId,
  onAdded,
}: {
  close: () => void;
  /** A show chosen elsewhere (Discover, For you, Radio): its preview opens straight away. */
  pid?: string;
  initialText?: string;
  libraryItemId?: string;
  onAdded?: (show: Show) => void;
}) {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [text, setText] = useState(pid ? programmeLink(pid) : initialText);
  const [query, setQuery] = useState<{
    kind: "link" | "name";
    value: string;
  } | null>(
    pid
      ? { kind: "link", value: pid }
      : initialText.trim().length >= 2
        ? { kind: "name", value: initialText.trim() }
        : null,
  );
  const [link, setLink] = useState<string | null>(
    pid ? programmeLink(pid) : null,
  );
  const [follow, setFollow] = useState<Follow>("from_now_on");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const search = useQuery({
    queryKey: ["radio", "search", query?.value],
    enabled: query?.kind === "name",
    queryFn: async () =>
      result(
        await api.GET("/api/radio/search", {
          params: { query: { q: query!.value } },
        }),
      ),
  });
  const preview = useQuery({
    queryKey: ["radio", "preview", link],
    enabled: !!link,
    retry: false,
    queryFn: async () =>
      result(
        await api.GET("/api/radio/preview", {
          params: { query: { link: link! } },
        }),
      ),
  });
  const add = useMutation({
    mutationFn: async () =>
      result(
        await api.POST("/api/radio/shows", {
          body: {
            link: link!,
            follow,
            ...(libraryItemId ? { library_item_id: libraryItemId } : {}),
          },
        }),
      ),
    onSuccess: async (show) => {
      await cache.invalidateQueries({ queryKey: ["radio"] });
      if (onAdded) return onAdded(show);
      close();
      navigate(showPage(show.id));
    },
  });
  function find(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (value.length < 2) return;
    add.reset();
    if (looksLikeLink(value)) {
      setQuery({ kind: "link", value });
      setLink(
        /^https?:/i.test(value) || value.includes("/")
          ? value
          : programmeLink(value),
      );
    } else {
      setQuery({ kind: "name", value });
      setLink(null);
    }
  }
  const data: Preview | undefined = preview.data;
  return (
    <BookDialog title="Add a show" close={close} className="radio-add-dialog">
      <form onSubmit={find} className="radio-add-find">
        <p className="muted">
          Paste a link from BBC programmes or BBC Sounds, or search by the
          show’s name.
        </p>
        <label className="field">
          Link or show name
          <input
            ref={field}
            value={text}
            maxLength={500}
            onChange={(event) => setText(event.target.value)}
            aria-describedby="radio-add-example"
          />
        </label>
        <p id="radio-add-example" className="small muted">
          For example bbc.co.uk/programmes/b006qykl or
          bbc.co.uk/sounds/brands/b006qykl
        </p>
        <button type="submit" disabled={text.trim().length < 2}>
          Find show
        </button>
      </form>
      {query?.kind === "name" && (
        <section aria-label="Shows found" className="radio-add-results">
          <Notice error={search.error} />
          {search.isPending && <Loading label="Searching the BBC…" />}
          {search.data && (
            <>
              <p className="small" role="status">
                {search.data.items.length
                  ? plural(search.data.items.length, "show") + " found"
                  : "No shows found. Try another name, or paste a link."}
              </p>
              <fieldset className="radio-add-choices">
                <legend className="sr-only">Choose a show</legend>
                {search.data.items.map((item) => (
                  <label key={item.pid} className="radio-add-choice">
                    <input
                      type="radio"
                      name="radio-add-result"
                      checked={link === programmeLink(item.pid)}
                      onChange={() => setLink(programmeLink(item.pid))}
                    />
                    <span>
                      <strong>{item.title}</strong>
                      <span className="small muted">
                        {item.station_name || "No station given"}
                        {item.synopsis ? ` · ${item.synopsis}` : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </>
          )}
        </section>
      )}
      {link && (
        <section aria-label="What will be added" className="radio-add-preview">
          <Notice error={preview.error} />
          {preview.isPending && <Loading label="Reading the BBC programme…" />}
          {data && (
            <>
              <h3>What will be added</h3>
              <div className="radio-add-show">
                <ShowArt title={data.title} station={data.station?.name} />
                <dl className="facts">
                  <dt>Show</dt>
                  <dd>{data.title}</dd>
                  <dt>Station</dt>
                  <dd>{data.station?.name || "No station given"}</dd>
                  {data.first_broadcast && (
                    <>
                      <dt>First broadcast</dt>
                      <dd>{day(data.first_broadcast, true)}</dd>
                    </>
                  )}
                  <dt>Series</dt>
                  <dd>
                    {plural(data.series_count, "series", "series")}
                    {data.episode_count != null &&
                      `, ${plural(data.episode_count, "episode")}`}
                  </dd>
                </dl>
              </div>
              {data.synopsis && <p className="small">{data.synopsis}</p>}
              {data.existing_show_id ? (
                <p className="notice" role="status">
                  This show is already in your library.{" "}
                  <Link to={showPage(data.existing_show_id)} onClick={close}>
                    Go to the show
                  </Link>
                </p>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    add.mutate();
                  }}
                >
                  <fieldset className="option-cards radio-add-follow">
                    <legend>Follow</legend>
                    {followChoices.map((choice) => (
                      <label key={choice.value} className="option-card">
                        <input
                          type="radio"
                          name="radio-add-follow"
                          value={choice.value}
                          checked={follow === choice.value}
                          onChange={() => setFollow(choice.value)}
                        />
                        <span>
                          <strong>{choice.label}</strong>
                          <span className="small muted">{choice.hint}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <Notice error={add.error} />
                  <div className="button-row">
                    <button
                      type="submit"
                      className="primary"
                      disabled={add.isPending}
                    >
                      {add.isPending ? "Adding…" : "Add show"}
                    </button>
                    <button type="button" onClick={close}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
      )}
    </BookDialog>
  );
}
