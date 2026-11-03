import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, Radio as RadioIcon } from "lucide-react";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Loading, Notice } from "../components";
import { usePreferences } from "../hooks/usePreferences";
import { AddShow, showPage, StationLogo } from "../pages/Radio";
import BookDialog from "./BookDialog";
import DeferredShelf from "./DeferredShelf";
import ShelfScroller from "./ShelfScroller";
import ShowArt from "./ShowArt";
import StatusChip from "./StatusChip";

type Setup = components["schemas"]["RadioDiscoverView"];
type Popular = components["schemas"]["PopularShowView"];
type TypeId = components["schemas"]["UserPreferences"]["radio_types"][number];

/**
 * Discover, For you, Radio: five stations, then the most popular BBC Sounds shows for each type
 * the person chose (saved with their account). Choosing a station adds its popular shows first.
 */
export default function DiscoverRadio({
  choosing,
  setChoosing,
}: {
  choosing: boolean;
  setChoosing: (open: boolean) => void;
}) {
  const setup = useQuery({
    queryKey: ["radio", "discover"],
    queryFn: async () => result(await api.GET("/api/radio/discover")),
    staleTime: 300_000,
  });
  const { preferences } = usePreferences();
  const [station, setStation] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const chosen = preferences?.radio_types ?? setup.data?.chosen ?? [];
  const label = (id: string) =>
    setup.data?.types.find((type) => type.id === id)?.label ?? id;
  const picked = setup.data?.stations.find((item) => item.id === station);
  return (
    <section className="discover-radio" aria-label="Radio">
      <Notice error={setup.error} />
      {setup.isPending && <Loading />}
      {setup.data && (
        <>
          <div className="section-heading discovery-heading">
            <h2>Stations</h2>
          </div>
          <ul className="cards station-cards discover-stations">
            {setup.data.stations.map((item) => (
              <li className="card station-card" key={item.id}>
                <button
                  type="button"
                  className="discover-station"
                  aria-pressed={station === item.id}
                  onClick={() =>
                    setStation(station === item.id ? null : item.id)
                  }
                >
                  <StationLogo station={item} />
                  <span className="card__title">{item.name}</span>
                  <span className="small muted">
                    {item.show_count
                      ? `${item.show_count} of your shows`
                      : "Popular shows"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {picked && (
            <PopularRow
              key={picked.id}
              title={`Popular on ${picked.name}`}
              query={{ station: picked.id }}
              add={setAdding}
            />
          )}
          {chosen.map((type, index) => (
            <DeferredShelf
              key={type}
              title={`Popular in ${label(type)}`}
              immediate={index < 3}
            >
              <PopularRow
                title={`Popular in ${label(type)}`}
                query={{ type }}
                add={setAdding}
              />
            </DeferredShelf>
          ))}
          {!chosen.length && (
            <p className="explore-empty">
              No types chosen. Choose the types of radio you like to see their
              most popular shows.
            </p>
          )}
          <p className="muted small">
            Popular shows come from BBC Sounds and change through the day.
          </p>
        </>
      )}
      {choosing && setup.data && (
        <ChooseTypes
          setup={setup.data}
          chosen={chosen}
          close={() => setChoosing(false)}
        />
      )}
      {adding && <AddShow pid={adding} close={() => setAdding(null)} />}
    </section>
  );
}

function PopularRow({
  title,
  query,
  add,
}: {
  title: string;
  query: { type?: string; station?: string };
  add: (pid: string) => void;
}) {
  const shows = useQuery({
    queryKey: ["radio", "popular", query],
    queryFn: async ({ signal }) =>
      result(
        await api.GET("/api/radio/discover/popular", {
          params: { query },
          signal,
        }),
      ),
    staleTime: 600_000,
  });
  const items = shows.data?.items ?? [];
  return (
    <>
      <div className="section-heading discovery-heading">
        <h2>{title}</h2>
      </div>
      <Notice error={shows.error} />
      {shows.isPending && <Loading label="Reading BBC Sounds…" />}
      {shows.data && !items.length && (
        <p className="muted">BBC Sounds has no popular shows here today.</p>
      )}
      {items.length > 0 && (
        <ShelfScroller label={title}>
          {items.map((show) => (
            <li key={show.pid}>
              <PopularCard show={show} add={add} />
            </li>
          ))}
        </ShelfScroller>
      )}
    </>
  );
}

function PopularCard({
  show,
  add,
}: {
  show: Popular;
  add: (pid: string) => void;
}) {
  return (
    <div className="media-card cover-card show-card">
      {show.show_id ? (
        <Link
          className="cover-card__open"
          to={showPage(show.show_id)}
          aria-label={`${show.title}, in your radio`}
        />
      ) : (
        <button
          type="button"
          className="cover-card__open"
          aria-label={`Add ${show.title}`}
          onClick={() => add(show.pid)}
        />
      )}
      <div className="cover-card__art">
        <ShowArt
          title={show.title}
          station={show.station_name}
          artwork={show.image_url}
        />
      </div>
      <h3 className="media-card__title" title={show.title}>
        {show.title}
      </h3>
      <span className="media-card__meta">
        {show.station_name || "No station given"}
      </span>
      {show.show_id ? (
        <StatusChip
          className="show-card__chip"
          label="In your radio"
          icon={Check}
          tone="neutral"
        />
      ) : (
        <span className="media-card__meta discover-radio__add">
          <RadioIcon size={14} aria-hidden="true" /> Add show
        </span>
      )}
    </div>
  );
}

/** The types of radio to show, in groups, saved with the account. */
function ChooseTypes({
  setup,
  chosen,
  close,
}: {
  setup: Setup;
  chosen: string[];
  close: () => void;
}) {
  const { save } = usePreferences();
  const [draft, setDraft] = useState<string[]>(chosen);
  const groups = [...new Set(setup.types.map((type) => type.group))];
  const toggle = (id: string) =>
    setDraft((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  return (
    <BookDialog title="Choose radio types" close={close}>
      <form
        className="radio-types"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ radio_types: draft as TypeId[] }, { onSuccess: close });
        }}
      >
        <p className="muted">
          Choose up to 12. Each type is a row of its most popular shows on BBC
          Sounds, in the order you choose them.
        </p>
        {groups.map((group) => (
          <fieldset key={group} className="radio-types__group">
            <legend>{group}</legend>
            {setup.types
              .filter((type) => type.group === group)
              .map((type) => (
                <label key={type.id} className="check-label">
                  <input
                    type="checkbox"
                    checked={draft.includes(type.id)}
                    disabled={!draft.includes(type.id) && draft.length >= 12}
                    onChange={() => toggle(type.id)}
                  />
                  {type.label}
                </label>
              ))}
          </fieldset>
        ))}
        <Notice error={save.error} />
        <div className="button-row">
          <button type="submit" className="primary" disabled={save.isPending}>
            {save.isPending ? "Saving" : "Save types"}
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </BookDialog>
  );
}
