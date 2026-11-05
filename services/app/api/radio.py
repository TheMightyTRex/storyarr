"""Radio shows (FEAT-R): stations, shows, series and episodes from the BBC, podcast feeds
(Apple Podcasts shows are saved as their feed) and the Internet Archive.

Shows are owned by the person who added them; stations are shared. Adding a show is two steps:
a preview that saves nothing, then a save with a follow choice. Images are served by id from
the copies Storyarr keeps in its config folder.
"""

import asyncio
import os
from datetime import datetime
from pathlib import PurePosixPath
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select

from app.adapters.bbc_programmes import SERVICE_ID, ShowData
from app.adapters.contracts import AdapterError, FailureKind
from app.api.dependencies import CurrentUser, Database, Member
from app.api.logos import LogoView, show_view
from app.api.metadata import adapter_http_error
from app.api.operations import OperationView
from app.api.preferences import view as preferences_view
from app.db.models import (
    AcquisitionIntent,
    AcquisitionReason,
    AcquisitionTarget,
    AuditEvent,
    Integration,
    Operation,
    RadioEpisode,
    RadioLibrary,
    RadioLibraryFile,
    RadioSeries,
    RadioShow,
    RadioStation,
    Work,
)
from app.domain import radio, radio_images, radio_sources, radio_wanted
from app.domain.follow_status import StatusKind
from app.domain.radio_library import relink, show_files

router = APIRouter(prefix="/radio", tags=["radio"])

Follow = Literal["all", "from_now_on", "none"]
Provider = Literal["bbc", "feed", "archive"]
NumberSource = Literal["bbc", "broadcast_order", "source"]
STATUS_LABELS = {
    "in_library": "In library",
    "downloading": "Downloading",
    "importing": "Importing",
    "searching": "Searching",
    "waiting": "Waiting",
    "not_released": "Not released",
    "attention": "Needs attention",
    "wanted": "Wanted",
    "excluded": "Excluded",
    "not_requested": "Not requested",
}


class RadioStationRef(BaseModel):
    id: str
    name: str
    logo_url: str | None = None


class RadioStationView(RadioStationRef):
    show_count: int


class RadioStationList(BaseModel):
    items: list[RadioStationView]


class RadioPreviewSeries(BaseModel):
    pid: str
    kind: Literal["series", "specials"]
    number: int
    title: str
    expected_episodes: int | None
    first_broadcast: datetime | None


class RadioShowPreview(BaseModel):
    # The show's id at its source: a BBC pid, a feed address or an Internet Archive item.
    pid: str
    provider: Provider = "bbc"
    source_name: str = "BBC"
    title: str
    synopsis: str | None
    author: str | None = None
    web_url: str | None = None
    first_broadcast: datetime | None
    station: RadioStationRef | None
    image_pid: str | None
    # Feeds and the Internet Archive: where the artwork is (shown straight from there).
    artwork_url: str | None = None
    # The Internet Archive only: the licence it gives, or None when it gives none.
    licence: str | None = None
    series_count: int
    episode_count: int | None
    series: list[RadioPreviewSeries]
    # Set when this show is already in the person's radio shows.
    existing_show_id: UUID | None = None


class RadioSearchItem(BaseModel):
    source: Literal["bbc", "apple", "archive"] = "bbc"
    source_name: str = "BBC"
    # What to preview and add (a BBC programmes link, a feed or an archive.org link).
    link: str
    title: str
    synopsis: str | None
    author: str | None = None
    station_id: str | None
    station_name: str | None
    # BBC only: the programme and image ids.
    pid: str | None = None
    image_pid: str | None
    artwork_url: str | None = None
    licence: str | None = None
    # Set when this show is already in the person's radio shows.
    existing_show_id: UUID | None = None


class RadioSearchView(BaseModel):
    # The sources asked, in the order their results are listed, and those that did not answer.
    sources: list[str] = []
    failed: list[str] = []
    items: list[RadioSearchItem]


class RadioShowInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # A link to the show: BBC programmes or Sounds (or a programme id), Apple Podcasts,
    # archive.org, or a podcast feed (or a page that links to one).
    link: str = Field(min_length=8, max_length=1000)
    follow: Follow = "from_now_on"
    # The radio library show (Audiobookshelf item id) this show is added from, if any.
    library_item_id: str | None = Field(default=None, min_length=1, max_length=200)


class RadioShowEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    follow: Follow | None = None
    # Use this radio library show's files for the show (from the radio library review).
    library_item_id: str | None = Field(default=None, min_length=1, max_length=200)


class RadioMonitoredInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # True wants the episodes, False does not; None hands them back to the follow choice.
    monitored: bool | None


class RadioEpisodeFileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # A radio library file, or None for "no file": the episode is not in any file seen so far.
    file_id: UUID | None


class RadioEpisodeStatus(BaseModel):
    kind: StatusKind
    label: str
    detail: str | None = None


class RadioEpisodeView(BaseModel):
    id: UUID
    pid: str
    number: int
    number_source: NumberSource
    title: str
    synopsis: str | None
    first_broadcast: datetime | None
    duration_seconds: int | None
    status: RadioEpisodeStatus
    # Chosen by hand: True wanted, False not wanted; None follows the follow choice.
    monitored: bool | None = None
    # When the source stopped listing it; it is kept with its file and request.
    removed_at: datetime | None = None


class RadioSeriesView(BaseModel):
    id: UUID
    pid: str
    kind: Literal["series", "specials"]
    number: int
    number_source: NumberSource
    removed_at: datetime | None = None
    title: str
    synopsis: str | None
    station: RadioStationRef | None
    expected_episodes: int | None
    first_broadcast: datetime | None
    episode_count: int
    episodes: list[RadioEpisodeView]


class RadioShowSummary(BaseModel):
    id: UUID
    provider: Provider
    source_name: str = "BBC"
    external_id: str
    title: str
    synopsis: str | None
    author: str | None = None
    web_url: str | None = None
    # The Internet Archive only: the licence it gives, or None when it gives none.
    licence: str | None = None
    first_broadcast: datetime | None
    station: RadioStationRef | None
    # Every station the show's series were on, the show's own station first.
    stations: list[RadioStationRef]
    follow: Follow
    followed_at: datetime | None
    artwork_url: str | None
    logo_colour: str | None
    logo_source: str | None
    # The saved show logo (UX-43); None shows the title as a wordmark.
    logo: LogoView | None = None
    series_count: int
    episode_count: int
    # Episodes Storyarr wants for this show (R4): wanted, searching, downloading and so on.
    wanted_count: int = 0
    refreshed_at: datetime | None
    refresh: OperationView | None


class RadioShowList(BaseModel):
    items: list[RadioShowSummary]
    total: int


class RadioShowDetail(RadioShowSummary):
    series: list[RadioSeriesView]
    # The show in Audiobookshelf, when the radio library holds it ("Open in Audiobookshelf").
    library_url: str | None = None


class RadioEpisodeShow(BaseModel):
    id: UUID
    title: str
    artwork_url: str | None


class RadioEpisodeSeries(BaseModel):
    id: UUID
    kind: Literal["series", "specials"]
    number: int
    title: str
    station: RadioStationRef | None


class RadioEpisodeFile(BaseModel):
    """The radio library file that holds the episode: its name only, never the folder."""

    id: UUID
    name: str
    size: int
    library: str


class RadioEpisodeRequest(BaseModel):
    """The open request for a wanted episode (R4), as Activity shows it."""

    id: UUID
    # The request's title in Requests: Show - S20E03 - Title.
    title: str
    state: str
    message: str


class RadioEpisodeDetail(RadioEpisodeView):
    show: RadioEpisodeShow
    series: RadioEpisodeSeries
    # Where the episode is at its source: its BBC page, its audio in the feed, or its file.
    source_url: str | None = None
    request: RadioEpisodeRequest | None = None
    file: RadioEpisodeFile | None = None
    # True when the file (or no file) was chosen by hand in the radio library review.
    file_manual: bool = False


def station_ref(station: RadioStation | None) -> RadioStationRef | None:
    if not station:
        return None
    return RadioStationRef(
        id=station.id,
        name=station.name,
        logo_url=f"/api/radio/stations/{station.id}/logo" if station.logo_path else None,
    )


def artwork_url(show: RadioShow) -> str | None:
    return f"/api/radio/shows/{show.id}/artwork" if show.artwork_path else None


def status_view(episode: RadioEpisode, follow: str | None = None) -> RadioEpisodeStatus:
    detail = None
    if episode.status == "not_released" and episode.first_broadcast:
        day = episode.first_broadcast.date()
        detail = f"First broadcast {day.day} {day:%B %Y}"
    elif episode.status == "wanted":
        detail = (
            "Wanted by hand"
            if episode.monitored
            else "You follow all series"
            if follow == "all"
            else "Broadcast while you follow this show"
        )
    elif episode.status == "not_requested" and episode.monitored is False:
        detail = "Not wanted, chosen by hand"
    elif episode.status == "excluded":
        detail = "Withdrawn in Activity. Change the follow choice to want it again."
    return RadioEpisodeStatus(
        kind=episode.status, label=STATUS_LABELS.get(episode.status, "Unknown"), detail=detail
    )


def episode_view(episode: RadioEpisode, follow: str | None = None) -> RadioEpisodeView:
    return RadioEpisodeView(
        id=episode.id,
        pid=episode.pid,
        number=episode.number,
        number_source=episode.number_source,
        title=episode.title,
        synopsis=episode.synopsis,
        first_broadcast=episode.first_broadcast,
        duration_seconds=episode.duration_seconds,
        status=status_view(episode, follow),
        monitored=episode.monitored,
        removed_at=episode.removed_at,
    )


async def stations_by_id(db, ids) -> dict[str, RadioStation]:
    ids = {value for value in ids if value}
    if not ids:
        return {}
    return {
        row.id: row
        for row in await db.scalars(select(RadioStation).where(RadioStation.id.in_(ids)))
    }


async def summaries(db, shows: list[RadioShow]) -> list[RadioShowSummary]:
    if not shows:
        return []
    ids = [show.id for show in shows]
    series_counts = dict(
        (
            await db.execute(
                select(RadioSeries.show_id, func.count())
                .where(RadioSeries.show_id.in_(ids), RadioSeries.kind == "series")
                .group_by(RadioSeries.show_id)
            )
        ).all()
    )
    episode_counts = dict(
        (
            await db.execute(
                select(RadioEpisode.show_id, func.count())
                .where(RadioEpisode.show_id.in_(ids))
                .group_by(RadioEpisode.show_id)
            )
        ).all()
    )
    wanted_counts = dict(
        (
            await db.execute(
                select(RadioEpisode.show_id, func.count())
                .where(
                    RadioEpisode.show_id.in_(ids),
                    RadioEpisode.status.in_(radio_wanted.WANTING),
                )
                .group_by(RadioEpisode.show_id)
            )
        ).all()
    )
    series_stations: dict[UUID, list[str]] = {}
    for show_id, station_id in (
        await db.execute(
            select(RadioSeries.show_id, RadioSeries.station_id)
            .where(RadioSeries.show_id.in_(ids), RadioSeries.station_id.is_not(None))
            .group_by(RadioSeries.show_id, RadioSeries.station_id)
            .order_by(RadioSeries.show_id, func.min(RadioSeries.number))
        )
    ).all():
        series_stations.setdefault(show_id, []).append(station_id)
    stations = await stations_by_id(
        db,
        {show.station_id for show in shows}
        | {value for values in series_stations.values() for value in values},
    )
    operations = {
        row.id: row
        for row in await db.scalars(
            select(Operation).where(
                Operation.id.in_([show.operation_id for show in shows if show.operation_id])
            )
        )
    }
    result = []
    for show in shows:
        order = list(dict.fromkeys([show.station_id, *series_stations.get(show.id, [])]))
        operation = operations.get(show.operation_id)
        result.append(
            RadioShowSummary(
                id=show.id,
                provider=show.provider,
                source_name=radio_sources.SOURCE_NAMES.get(show.provider, "BBC"),
                external_id=show.external_id,
                title=show.title,
                synopsis=show.synopsis,
                author=show.author,
                web_url=show.web_url,
                licence=show.licence,
                first_broadcast=show.first_broadcast,
                station=station_ref(stations.get(show.station_id)),
                stations=[station_ref(stations[value]) for value in order if value in stations],
                follow=show.follow,
                followed_at=show.followed_at,
                artwork_url=artwork_url(show),
                logo_colour=show.logo_colour,
                logo_source=show.logo_source,
                logo=show_view(show),
                series_count=series_counts.get(show.id, 0),
                episode_count=episode_counts.get(show.id, 0),
                wanted_count=wanted_counts.get(show.id, 0),
                refreshed_at=show.refreshed_at,
                refresh=OperationView.model_validate(operation) if operation else None,
            )
        )
    return result


async def detail_view(db, show: RadioShow) -> RadioShowDetail:
    (summary,) = await summaries(db, [show])
    series = list(
        await db.scalars(
            select(RadioSeries)
            .where(RadioSeries.show_id == show.id)
            .order_by(
                (RadioSeries.kind == "specials").asc(),
                RadioSeries.number,
                RadioSeries.first_broadcast,
            )
        )
    )
    episodes: dict[UUID, list[RadioEpisode]] = {}
    for episode in await db.scalars(
        select(RadioEpisode)
        .where(RadioEpisode.show_id == show.id)
        .order_by(RadioEpisode.number, RadioEpisode.first_broadcast)
    ):
        episodes.setdefault(episode.series_id, []).append(episode)
    stations = await stations_by_id(db, {row.station_id for row in series})
    return RadioShowDetail(
        **summary.model_dump(),
        library_url=await library_url(db, show),
        series=[
            RadioSeriesView(
                id=row.id,
                pid=row.pid,
                kind=row.kind,
                number=row.number,
                number_source=row.number_source,
                removed_at=row.removed_at,
                title=row.title,
                synopsis=row.synopsis,
                station=station_ref(stations.get(row.station_id)),
                expected_episodes=row.expected_episodes,
                first_broadcast=row.first_broadcast,
                episode_count=len(episodes.get(row.id, [])),
                episodes=[
                    episode_view(episode, show.follow) for episode in episodes.get(row.id, [])
                ],
            )
            for row in series
        ],
    )


def preview_view(data: ShowData, existing: UUID | None) -> RadioShowPreview:
    station = RadioStationRef(id=data.station[0], name=data.station[1]) if data.station else None
    return RadioShowPreview(
        pid=data.pid,
        provider=data.provider,
        source_name=radio_sources.SOURCE_NAMES.get(data.provider, "BBC"),
        author=data.author,
        web_url=data.web_url,
        artwork_url=data.artwork_url,
        licence=data.licence,
        title=data.title,
        synopsis=data.synopsis,
        first_broadcast=data.first_broadcast,
        station=station,
        image_pid=data.image_pid,
        series_count=sum(1 for item in data.series if item.kind == "series"),
        episode_count=data.episode_count,
        series=[
            RadioPreviewSeries(
                pid=item.pid,
                kind=item.kind,
                number=item.number,
                title=item.title,
                expected_episodes=item.expected_episodes,
                first_broadcast=item.first_broadcast,
            )
            for item in data.series
        ],
        existing_show_id=existing,
    )


async def library_url(db, show: RadioShow) -> str | None:
    """The show's page in Audiobookshelf: the library show it was added from, or the one that
    holds its linked files. Uses the server address Storyarr connects to."""
    item_id = show.library_item_id
    library_id = None
    if not item_id:
        row = (
            await db.execute(
                select(RadioLibraryFile.item_id, RadioLibraryFile.library_id, func.count())
                .join(RadioEpisode, RadioEpisode.file_id == RadioLibraryFile.id)
                .where(RadioEpisode.show_id == show.id)
                .group_by(RadioLibraryFile.item_id, RadioLibraryFile.library_id)
                .order_by(func.count().desc())
                .limit(1)
            )
        ).first()
        if not row:
            return None
        item_id, library_id = row[0], row[1]
    library = (
        await db.get(RadioLibrary, library_id)
        if library_id
        else await db.scalar(select(RadioLibrary).limit(1))
    )
    integration = await db.get(Integration, library.integration_id) if library else None
    if not integration or not integration.enabled or not integration.base_url:
        return None
    return f"{integration.base_url.rstrip('/')}/item/{item_id}"


def prefs(user) -> radio_sources.Prefs:
    saved = preferences_view(user.preferences)
    return radio_sources.Prefs(
        country=saved.radio_country,
        language=saved.radio_language,
        sources=tuple(saved.radio_sources),
    )


async def _read_bbc(db, call):
    # No request transaction is held while the source answers.
    await db.rollback()
    try:
        return await call()
    except AdapterError as error:
        if error.kind == FailureKind.PERMISSION:
            # A link to a private address: the person can fix the link.
            raise HTTPException(422, str(error)) from None
        raise adapter_http_error(error) from None


@router.get("/search", response_model=RadioSearchView)
async def search(user: Member, db: Database, q: str = Query(min_length=2, max_length=100)):
    """Find shows by name in the sources the person has turned on that suit their country and
    language (Settings, Radio): the BBC, Apple Podcasts and the Internet Archive."""
    user_id, choices = user.id, prefs(user)
    outcome = await _read_bbc(db, lambda: radio_sources.search(q.strip(), choices))
    items = []
    for hit in outcome.hits[:40]:
        items.append(
            RadioSearchItem(
                source=hit.source,
                source_name=radio_sources.SOURCE_NAMES[hit.source],
                link=hit.link,
                title=hit.title,
                synopsis=hit.synopsis,
                author=hit.author,
                station_id=hit.station_id,
                station_name=hit.station_name,
                pid=hit.pid,
                image_pid=hit.image_pid,
                artwork_url=hit.artwork_url,
                licence=hit.licence,
                existing_show_id=await radio.existing_show(db, user_id, hit.keys),
            )
        )
    return RadioSearchView(
        sources=[radio_sources.SOURCE_NAMES[name] for name in radio_sources.offered(choices)],
        failed=outcome.failed,
        items=items,
    )


@router.get("/preview", response_model=RadioShowPreview)
async def preview(user: Member, db: Database, link: str = Query(min_length=8, max_length=1000)):
    """What a link points to, without saving anything."""
    user_id = user.id
    radio.check_link(link)
    data = await _read_bbc(db, lambda: radio.preview(link))
    existing = await radio.existing_show(db, user_id, radio.show_keys(data))
    return preview_view(data, existing)


@router.post("/shows", response_model=RadioShowSummary, status_code=201)
async def add_show(body: RadioShowInput, user: Member, db: Database):
    """Save a show with a follow choice; a background refresh then reads every series."""
    user_id = user.id
    radio.check_link(body.link)
    data = await _read_bbc(db, lambda: radio.preview(body.link))
    show, _ = await radio.add(db, user_id, data, body.follow, body.library_item_id)
    db.add(
        AuditEvent(
            actor_id=user_id,
            action="radio.show.added",
            detail={
                "show_id": str(show.id),
                "provider": show.provider,
                # Feed addresses can carry a private key, so only BBC and archive ids are kept.
                "pid": show.external_id if show.provider != "feed" else None,
                "follow": show.follow,
            },
        )
    )
    await db.commit()
    (summary,) = await summaries(db, [show])
    return summary


@router.get("/shows", response_model=RadioShowList)
async def list_shows(
    user: CurrentUser,
    db: Database,
    station: str | None = Query(default=None, max_length=60),
    followed: bool | None = None,
):
    query = select(RadioShow).where(RadioShow.owner_id == user.id)
    if station:
        if not SERVICE_ID.fullmatch(station):
            raise HTTPException(422, "Unknown station id")
        on_station = select(RadioSeries.show_id).where(RadioSeries.station_id == station)
        query = query.where(or_(RadioShow.station_id == station, RadioShow.id.in_(on_station)))
    if followed is True:
        query = query.where(RadioShow.follow != "none")
    elif followed is False:
        query = query.where(RadioShow.follow == "none")
    shows = list(await db.scalars(query.order_by(func.lower(RadioShow.title), RadioShow.id)))
    return RadioShowList(items=await summaries(db, shows), total=len(shows))


@router.get("/stations", response_model=RadioStationList)
async def list_stations(user: CurrentUser, db: Database):
    """Stations of the person's shows, with how many shows each has (any series counts)."""
    owned = select(RadioShow.id).where(RadioShow.owner_id == user.id)
    pairs = (
        select(RadioShow.id.label("show_id"), RadioShow.station_id)
        .where(RadioShow.owner_id == user.id)
        .union(
            select(RadioSeries.show_id, RadioSeries.station_id).where(
                RadioSeries.show_id.in_(owned)
            )
        )
        .subquery()
    )
    rows = (
        await db.execute(
            select(RadioStation, func.count(func.distinct(pairs.c.show_id)))
            .join(pairs, pairs.c.station_id == RadioStation.id)
            .group_by(RadioStation.id)
            .order_by(RadioStation.name)
        )
    ).all()
    return RadioStationList(
        items=[
            RadioStationView(**station_ref(station).model_dump(), show_count=count)
            for station, count in rows
        ]
    )


@router.get("/shows/{show_id}", response_model=RadioShowDetail)
async def show_detail(show_id: UUID, user: CurrentUser, db: Database):
    return await detail_view(db, await radio.owned_show(db, user, show_id))


@router.patch("/shows/{show_id}", response_model=RadioShowSummary)
async def edit_show(show_id: UUID, body: RadioShowEdit, user: Member, db: Database):
    """Change the follow choice (episode statuses follow it), or the radio library show to use."""
    show = await radio.owned_show(db, user, show_id, lock=True)
    if body.follow:
        previous = show.follow
        await radio.set_follow(db, show, body.follow)
        if previous != show.follow:
            db.add(
                AuditEvent(
                    actor_id=user.id,
                    action="radio.show.follow",
                    detail={"show_id": str(show.id), "follow": show.follow},
                )
            )
    if body.library_item_id:
        show.library_item_id = body.library_item_id
        await relink(db, show_id=show.id)
    await db.commit()
    (summary,) = await summaries(db, [show])
    return summary


@router.post("/shows/{show_id}/refresh", response_model=OperationView, status_code=202)
async def refresh_show(show_id: UUID, user: Member, db: Database):
    """Read the show from the BBC again, and fetch its images again."""
    show = await radio.owned_show(db, user, show_id, lock=True)
    operation = await radio.start_refresh(db, user.id, show)
    await db.commit()
    await db.refresh(operation)
    return operation


@router.delete("/shows/{show_id}", status_code=204)
async def remove_show(show_id: UUID, user: Member, db: Database):
    """Remove the show with its series and episodes. Saved images stay (other people may share
    them); stations stay."""
    show = await radio.owned_show(db, user, show_id, lock=True)
    db.add(
        AuditEvent(
            actor_id=user.id,
            action="radio.show.removed",
            detail={
                "show_id": str(show.id),
                "pid": show.external_id if show.provider != "feed" else None,
            },
        )
    )
    if show.operation_id:
        operation = await db.get(Operation, show.operation_id)
        if operation and operation.status in radio.ACTIVE:
            operation.status, operation.message = "cancelled", "The show was removed"
    # Its episode requests are withdrawn; the private records stay for the request history.
    await radio_wanted.sync(db, [show.id], removing=True)
    await db.delete(show)
    await db.commit()
    return Response(status_code=204)


@router.get("/episodes/{episode_id}", response_model=RadioEpisodeDetail)
async def episode_detail(episode_id: UUID, user: CurrentUser, db: Database):
    row = (
        await db.execute(
            select(RadioEpisode, RadioSeries, RadioShow)
            .join(RadioSeries, RadioSeries.id == RadioEpisode.series_id)
            .join(RadioShow, RadioShow.id == RadioEpisode.show_id)
            .where(RadioEpisode.id == episode_id, RadioShow.owner_id == user.id)
        )
    ).first()
    if not row:
        raise HTTPException(404, "Episode not found")
    episode, series, show = row
    station = await db.get(RadioStation, series.station_id) if series.station_id else None
    file = await db.get(RadioLibraryFile, episode.file_id) if episode.file_id else None
    library = await db.get(RadioLibrary, file.library_id) if file else None
    request = None
    if episode.work_id:
        found = (
            await db.execute(
                select(
                    AcquisitionIntent.id,
                    AcquisitionTarget.state,
                    AcquisitionTarget.message,
                    Work.title,
                )
                .join(Work, Work.id == AcquisitionIntent.work_id)
                .join(AcquisitionReason, AcquisitionReason.intent_id == AcquisitionIntent.id)
                .join(AcquisitionTarget, AcquisitionTarget.intent_id == AcquisitionIntent.id)
                .where(
                    AcquisitionIntent.work_id == episode.work_id,
                    AcquisitionIntent.owner_id == user.id,
                    AcquisitionReason.kind == radio_wanted.KIND,
                    AcquisitionReason.reference == str(episode.id),
                    AcquisitionReason.active.is_(True),
                )
                .limit(1)
            )
        ).first()
        if found:
            request = RadioEpisodeRequest(
                id=found[0],
                title=found[3],
                state=found[1],
                message=radio_wanted.shown_message(found[1], found[2]),
            )
    if show.provider == "bbc":
        source_url = f"https://www.bbc.co.uk/programmes/{episode.pid}"
    else:
        source_url = episode.enclosure_url
    return RadioEpisodeDetail(
        **episode_view(episode, show.follow).model_dump(),
        source_url=source_url,
        request=request,
        show=RadioEpisodeShow(id=show.id, title=show.title, artwork_url=artwork_url(show)),
        series=RadioEpisodeSeries(
            id=series.id,
            kind=series.kind,
            number=series.number,
            title=series.title,
            station=station_ref(station),
        ),
        file=RadioEpisodeFile(
            id=file.id, name=PurePosixPath(file.path).name, size=file.size, library=library.name
        )
        if file and library
        else None,
        file_manual=episode.file_manual,
    )


async def _owned_episode(db, user, episode_id: UUID) -> tuple[RadioEpisode, RadioShow]:
    row = (
        await db.execute(
            select(RadioEpisode, RadioShow)
            .join(RadioShow, RadioShow.id == RadioEpisode.show_id)
            .where(RadioEpisode.id == episode_id, RadioShow.owner_id == user.id)
            .with_for_update(of=RadioEpisode)
        )
    ).first()
    if not row:
        raise HTTPException(404, "Episode not found")
    return row[0], row[1]


@router.put("/episodes/{episode_id}/file", response_model=RadioEpisodeDetail)
async def choose_episode_file(
    episode_id: UUID, body: RadioEpisodeFileInput, user: Member, db: Database
):
    """Link the episode to a file of its show by hand, or, with no file, say the file it has is
    not this episode ("Not this file"): that file is never offered to it again and automatic
    matching looks for another. With no file linked, no file is chosen by hand."""
    episode, show = await _owned_episode(db, user, episode_id)
    if not body.file_id and episode.file_id:
        rejected = episode.file_id
        episode.rejected_files = [*(episode.rejected_files or []), rejected]
        episode.file_id, episode.file_manual = None, False
        db.add(
            AuditEvent(
                actor_id=user.id,
                action="radio.episode.file.rejected",
                entity_id=episode.id,
                detail={"file_id": str(rejected)},
            )
        )
        await relink(db, show_id=show.id)
        await db.commit()
        return await episode_detail(episode_id, user, db)
    if body.file_id:
        file = await db.get(RadioLibraryFile, body.file_id)
        if not file or not show_files(show, [file]):
            raise HTTPException(422, "Choose a file of this show from the radio library.")
        other = await db.scalar(
            select(RadioEpisode).where(
                RadioEpisode.show_id == show.id,
                RadioEpisode.file_id == file.id,
                RadioEpisode.file_manual.is_(True),
                RadioEpisode.id != episode.id,
            )
        )
        if other:
            raise HTTPException(
                409, "This file is linked to another episode by hand. Unlink it there first."
            )
    episode.file_id, episode.file_manual = body.file_id, True
    db.add(
        AuditEvent(
            actor_id=user.id,
            action="radio.episode.file",
            entity_id=episode.id,
            detail={"file_id": str(body.file_id) if body.file_id else None},
        )
    )
    await relink(db, show_id=show.id)
    await db.commit()
    return await episode_detail(episode_id, user, db)


@router.delete("/episodes/{episode_id}/file", response_model=RadioEpisodeDetail)
async def automatic_episode_file(episode_id: UUID, user: Member, db: Database):
    """Let the radio sync find the episode's file again, including files said to be not it."""
    episode, show = await _owned_episode(db, user, episode_id)
    episode.file_id, episode.file_manual, episode.rejected_files = None, False, []
    await relink(db, show_id=show.id)
    await db.commit()
    return await episode_detail(episode_id, user, db)


@router.put("/episodes/{episode_id}/monitored", response_model=RadioEpisodeDetail)
async def monitor_episode(episode_id: UUID, body: RadioMonitoredInput, user: Member, db: Database):
    """Want or do not want one episode by hand, or hand it back to the follow choice (None).
    Its request in Activity follows."""
    episode, show = await _owned_episode(db, user, episode_id)
    await radio.set_monitored(db, show, [episode], body.monitored)
    db.add(
        AuditEvent(
            actor_id=user.id,
            action="radio.episode.monitored",
            entity_id=episode.id,
            detail={"monitored": body.monitored},
        )
    )
    await db.commit()
    return await episode_detail(episode_id, user, db)


@router.put("/series/{series_id}/monitored", response_model=RadioShowSummary)
async def monitor_series(series_id: UUID, body: RadioMonitoredInput, user: Member, db: Database):
    """Want or do not want every episode of a series by hand, or hand them back to the follow
    choice (None)."""
    row = (
        await db.execute(
            select(RadioSeries, RadioShow)
            .join(RadioShow, RadioShow.id == RadioSeries.show_id)
            .where(RadioSeries.id == series_id, RadioShow.owner_id == user.id)
            .with_for_update(of=RadioShow)
        )
    ).first()
    if not row:
        raise HTTPException(404, "Series not found")
    series, show = row
    episodes = await db.scalars(
        select(RadioEpisode).where(RadioEpisode.series_id == series.id).with_for_update()
    )
    await radio.set_monitored(db, show, episodes, body.monitored)
    db.add(
        AuditEvent(
            actor_id=user.id,
            action="radio.series.monitored",
            entity_id=series.id,
            detail={"monitored": body.monitored},
        )
    )
    await db.commit()
    (summary,) = await summaries(db, [show])
    return summary


def folder_problem(folder: str | None) -> str | None:
    if not folder or not os.path.isdir(folder):
        return "Storyarr cannot see the radio folder. Check that it is mounted."
    if not os.access(folder, os.W_OK):
        return "Storyarr cannot write to the radio folder, so it cannot file episodes."
    return None


class RadioHealthItem(BaseModel):
    kind: Literal["warning", "error"]
    message: str
    # Where to put it right: the radio library settings, or None.
    fix: Literal["radio_library"] | None = None


class RadioHealthView(BaseModel):
    items: list[RadioHealthItem]


@router.get("/health", response_model=RadioHealthView)
async def radio_health(user: CurrentUser, db: Database):
    """Why followed shows may not reach Audiobookshelf. Checked only while the person follows
    a show: no radio library chosen, Audiobookshelf not answering, or the radio folder missing
    or not writable from Storyarr."""
    following = await db.scalar(
        select(func.count())
        .select_from(RadioShow)
        .where(RadioShow.owner_id == user.id, RadioShow.follow != "none")
    )
    if not following:
        return RadioHealthView(items=[])
    items = []
    library = await db.scalar(select(RadioLibrary).order_by(RadioLibrary.id).limit(1))
    if not library:
        items.append(
            RadioHealthItem(
                kind="warning",
                message="No radio library is chosen, so episodes you follow have nowhere to go.",
                fix="radio_library",
            )
        )
        return RadioHealthView(items=items)
    integration = await db.get(Integration, library.integration_id)
    if not integration or not integration.enabled:
        items.append(
            RadioHealthItem(
                kind="error",
                message="The Audiobookshelf server of the radio library is not connected.",
                fix="radio_library",
            )
        )
    elif library.last_error:
        items.append(
            RadioHealthItem(
                kind="error",
                message=f"The radio library could not be read: {library.last_error}",
                fix="radio_library",
            )
        )
    problem = await asyncio.to_thread(folder_problem, library.local_path)
    if problem:
        items.append(RadioHealthItem(kind="warning", message=problem, fix="radio_library"))
    return RadioHealthView(items=items)


def _image(data: bytes, kind: str, if_none_match: str | None, extra=None) -> Response:
    tag = radio_images.etag(data)
    headers = {"Cache-Control": "private, max-age=86400", "ETag": tag, **(extra or {})}
    if tag in {value.strip().removeprefix("W/") for value in (if_none_match or "").split(",")}:
        return Response(status_code=304, headers=headers)
    return Response(data, media_type=kind, headers=headers)


IMAGE_RESPONSES = {
    200: {"content": {"image/jpeg": {}, "image/png": {}, "image/svg+xml": {}}},
    404: {},
}


@router.get("/shows/{show_id}/artwork", response_class=Response, responses=IMAGE_RESPONSES)
async def show_artwork(
    show_id: UUID,
    user: CurrentUser,
    db: Database,
    if_none_match: str | None = Header(default=None),
):
    """The saved copy of the show's artwork (the BBC's is a 640 by 640 JPEG)."""
    show = await radio.owned_show(db, user, show_id)
    data = radio_images.read(show.artwork_path)
    if not data:
        raise HTTPException(404, "No artwork saved for this show")
    return _image(data, radio_images.media_type(show.artwork_path), if_none_match)


@router.get("/stations/{station_id}/logo", response_class=Response, responses=IMAGE_RESPONSES)
async def station_logo(
    station_id: str,
    user: CurrentUser,
    db: Database,
    if_none_match: str | None = Header(default=None),
):
    """The saved, cleaned copy of the station's BBC Sounds logo (SVG)."""
    station = await db.get(RadioStation, station_id) if SERVICE_ID.fullmatch(station_id) else None
    data = radio_images.read(station.logo_path) if station else None
    if not data:
        raise HTTPException(404, "No logo saved for this station")
    return _image(data, "image/svg+xml", if_none_match, radio_images.SVG_HEADERS)
