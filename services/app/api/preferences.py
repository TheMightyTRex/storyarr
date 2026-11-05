"""Each person's own preferences, saved with their account rather than in one browser."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.api.dependencies import CurrentUser, Database
from app.db.models import User

router = APIRouter(prefix="/preferences", tags=["preferences"])


LibrarySection = Literal["books", "authors", "series", "saved"]
# Radio types for Discover, For you, Radio: the BBC Sounds category id, the name and its group.
# BBC Sounds has no science fiction category of its own; it sits under Drama.
RADIO_TYPES = (
    ("comedy", "All comedy", "Comedy"),
    ("comedy-sitcoms", "Sitcoms", "Comedy"),
    ("comedy-satire", "Satire", "Comedy"),
    ("comedy-standup", "Stand-up", "Comedy"),
    ("comedy-sketch", "Sketches", "Comedy"),
    ("comedy-chat", "Chat", "Comedy"),
    ("gamesandquizzes", "Panel games and quizzes", "Comedy"),
    ("drama", "All drama", "Drama"),
    ("drama-scifiandfantasy", "Science fiction and fantasy", "Drama"),
    ("drama-crime", "Crime", "Drama"),
    ("drama-thriller", "Thrillers", "Drama"),
    ("drama-horrorandsupernatural", "Horror and supernatural", "Drama"),
    ("drama-historical", "Historical", "Drama"),
    ("drama-classicandperiod", "Classic and period", "Drama"),
    ("drama-relationshipsandromance", "Relationships and romance", "Drama"),
    ("drama-soaps", "Soaps", "Drama"),
    ("readings", "Readings", "Drama"),
    ("audiobooks", "Audiobooks", "Drama"),
    ("news", "News", "Factual"),
    ("documentaries", "Documentaries", "Factual"),
    ("factual-history", "History", "Factual"),
    ("factual-scienceandnature", "Science and nature", "Factual"),
    ("factual-politics", "Politics", "Factual"),
    ("factual-crimeandjustice", "Crime and justice", "Factual"),
    ("factual-artscultureandthemedia", "Arts, culture and media", "Factual"),
    ("factual-healthandwellbeing", "Health and wellbeing", "Factual"),
    ("factual-foodanddrink", "Food and drink", "Factual"),
    ("discussionandtalk", "Discussion and talk", "Factual"),
    ("sport", "Sport", "Sport and music"),
    ("music", "Music", "Sport and music"),
)
RadioTypeId = Literal[tuple(key for key, _, _ in RADIO_TYPES)]  # type: ignore[valid-type]
# Where Add a show searches by name (RADIO-02). Podcast feeds and links work whatever is chosen.
RadioSource = Literal["bbc", "apple", "archive"]
COUNTRY = r"^[A-Z]{2}$"
LANGUAGE = r"^[a-z]{2,3}$"


class SavedView(BaseModel):
    """The filters and order a person chose as their default for one Library tab."""

    model_config = ConfigDict(extra="forbid")
    medium: Literal["ebook", "audio"] | None = None
    library: UUID | None = None
    sort: str | None = Field(default=None, max_length=30, pattern=r"^[a-z]+$")
    reverse: bool | None = None


class UserPreferences(BaseModel):
    # How Series, Authors and Following are laid out. "detail": the list beside the chosen
    # series or author; "list": one aligned row each.
    collection_view: Literal["detail", "list"] = "detail"
    # Default views saved from the Library tabs' toolbar; an empty object means none saved.
    library_views: dict[LibrarySection, SavedView] = {}
    # How big covers are on My library's cover wall.
    cover_size: Literal["small", "medium", "large"] = "medium"
    # Where a cover's actions sit: "on" the cover's right edge, shown on hover and focus (the
    # default), or "beside" the cover, always shown.
    cover_actions: Literal["on", "beside"] = "on"
    # The radio types shown on Discover, For you, Radio, in the order chosen.
    radio_types: list[RadioTypeId] = ["comedy", "drama-scifiandfantasy", "news"]
    # The country and language radio search suits (None: anywhere, any language), and the
    # sources it asks. The BBC is only asked for the United Kingdom and English, Welsh or Gaelic.
    radio_country: str | None = Field(default=None, pattern=COUNTRY)
    radio_language: str | None = Field(default=None, pattern=LANGUAGE)
    radio_sources: list[RadioSource] = ["bbc", "apple", "archive"]


class PreferencesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    collection_view: Literal["detail", "list"] | None = None
    # Replaces every saved view: send all the ones to keep, or {} to reset them all.
    library_views: dict[LibrarySection, SavedView] | None = None
    cover_size: Literal["small", "medium", "large"] | None = None
    cover_actions: Literal["on", "beside"] | None = None
    radio_types: list[RadioTypeId] | None = Field(default=None, max_length=12)
    # An empty string clears the country or language (anywhere, any language).
    radio_country: str | None = Field(default=None, pattern=r"^([A-Z]{2})?$")
    radio_language: str | None = Field(default=None, pattern=r"^([a-z]{2,3})?$")
    radio_sources: list[RadioSource] | None = Field(default=None, min_length=1, max_length=3)

    @field_validator("radio_sources")
    @classmethod
    def unique_sources(cls, value):
        if value is not None and len(set(value)) != len(value):
            raise ValueError("Choose each radio source once")
        return value

    @field_validator("radio_types")
    @classmethod
    def unique_types(cls, value):
        if value is not None and len(set(value)) != len(value):
            raise ValueError("Choose each radio type once")
        return value


def view(saved: dict | None) -> UserPreferences:
    known = UserPreferences.model_fields
    try:
        return UserPreferences(**{k: v for k, v in (saved or {}).items() if k in known})
    except ValueError:
        # A value an older or newer version saved that this one cannot read: fall back to defaults.
        return UserPreferences()


@router.get("", response_model=UserPreferences)
async def read_preferences(user: CurrentUser):
    return view(user.preferences)


@router.patch("", response_model=UserPreferences)
async def save_preferences(body: PreferencesInput, user: CurrentUser, db: Database):
    changes = body.model_dump(exclude_none=True, mode="json")
    for name in ("radio_country", "radio_language"):
        if changes.get(name) == "":
            changes[name] = None
    row = await db.get(User, user.id, with_for_update=True)
    row.preferences = {**(row.preferences or {}), **changes}
    await db.commit()
    return view(row.preferences)
