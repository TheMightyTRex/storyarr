"""Discover, For you, Radio: five stations and the popular shows of the types a person chose.

Popular shows come from BBC Sounds (public, no sign-in), read through the cached, paced BBC
reader. The chosen types save with the person's account (preferences.radio_types).
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select

from app.adapters.bbc_programmes import SERVICE_ID, PopularShow
from app.adapters.contracts import AdapterError
from app.api.dependencies import CurrentUser, Database
from app.api.metadata import adapter_http_error
from app.api.preferences import RADIO_TYPES, view
from app.db.models import RadioSeries, RadioShow, RadioStation
from app.domain import radio

router = APIRouter(prefix="/radio/discover", tags=["radio"])
STATION_COUNT = 5
# Used after the stations of the person's own shows, in this order.
DEFAULT_STATIONS = (
    ("bbc_radio_four", "Radio 4"),
    ("bbc_radio_four_extra", "Radio 4 Extra"),
    ("bbc_radio_two", "Radio 2"),
    ("bbc_radio_five_live", "Radio 5 Live"),
    ("bbc_world_service", "World Service"),
    ("bbc_6music", "Radio 6 Music"),
)
BBC_LOGO = "https://sounds.files.bbci.co.uk/3.12.0/networks/{id}/blocks-colour_default.svg"
ARTWORK = "https://ichef.bbci.co.uk/images/ic/320x320/{pid}.jpg"


class RadioType(BaseModel):
    id: str
    label: str
    group: str


class DiscoverStation(BaseModel):
    id: str
    name: str
    logo_url: str
    show_count: int


class RadioDiscoverView(BaseModel):
    stations: list[DiscoverStation]
    types: list[RadioType]
    chosen: list[str]


class PopularShowView(BaseModel):
    pid: str
    title: str
    synopsis: str | None = None
    station_id: str | None = None
    station_name: str | None = None
    image_url: str | None = None
    # The person's own copy of this show, when they have added it.
    show_id: str | None = None


class PopularShowList(BaseModel):
    items: list[PopularShowView]


@router.get("", response_model=RadioDiscoverView)
async def discover(user: CurrentUser, db: Database):
    """Five stations (those of the person's shows first) and the types they chose."""
    counts = (
        select(RadioSeries.station_id.label("station_id"), RadioSeries.show_id)
        .join(RadioShow, RadioShow.id == RadioSeries.show_id)
        .where(RadioShow.owner_id == user.id, RadioSeries.station_id.is_not(None))
        .union(
            select(RadioShow.station_id, RadioShow.id).where(
                RadioShow.owner_id == user.id, RadioShow.station_id.is_not(None)
            )
        )
        .subquery()
    )
    rows = (
        await db.execute(
            select(RadioStation, func.count(func.distinct(counts.c.show_id)).label("shows"))
            .join(counts, counts.c.station_id == RadioStation.id)
            .group_by(RadioStation.id)
            .order_by(func.count(func.distinct(counts.c.show_id)).desc(), RadioStation.name)
        )
    ).all()
    stations = [
        DiscoverStation(
            id=station.id,
            name=station.name,
            logo_url=f"/api/radio/stations/{station.id}/logo"
            if station.logo_path
            else BBC_LOGO.format(id=station.id),
            show_count=count,
        )
        for station, count in rows[:STATION_COUNT]
    ]
    for service_id, name in DEFAULT_STATIONS:
        if len(stations) >= STATION_COUNT:
            break
        if all(station.id != service_id for station in stations):
            stations.append(
                DiscoverStation(
                    id=service_id, name=name, logo_url=BBC_LOGO.format(id=service_id), show_count=0
                )
            )
    return RadioDiscoverView(
        stations=stations,
        types=[RadioType(id=key, label=label, group=group) for key, label, group in RADIO_TYPES],
        chosen=view(user.preferences).radio_types,
    )


@router.get("/popular", response_model=PopularShowList)
async def popular(
    user: CurrentUser,
    db: Database,
    type: str | None = Query(default=None, max_length=60),
    station: str | None = Query(default=None, max_length=60),
):
    """Popular shows on BBC Sounds for one type or one station, marked when already added."""
    known = {key for key, _, _ in RADIO_TYPES}
    if (type is None) == (station is None):
        raise HTTPException(422, "Choose a type or a station")
    if type is not None and type not in known:
        raise HTTPException(422, "Unknown radio type")
    if station is not None and not SERVICE_ID.fullmatch(station):
        raise HTTPException(422, "Unknown station id")
    user_id = user.id
    await db.rollback()
    try:
        shows: list[PopularShow] = await radio.popular(category=type, network=station)
    except AdapterError as error:
        raise adapter_http_error(error) from None
    owned = dict(
        (
            await db.execute(
                select(RadioShow.external_id, RadioShow.id).where(
                    RadioShow.owner_id == user_id,
                    RadioShow.external_id.in_([show.pid for show in shows]),
                )
            )
        ).all()
    )
    return PopularShowList(
        items=[
            PopularShowView(
                pid=show.pid,
                title=show.title,
                synopsis=show.synopsis,
                station_id=show.station_id,
                station_name=show.station_name,
                image_url=ARTWORK.format(pid=show.image_pid) if show.image_pid else None,
                show_id=str(owned[show.pid]) if show.pid in owned else None,
            )
            for show in shows
        ]
    )
