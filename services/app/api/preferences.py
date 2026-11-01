"""Each person's own preferences, saved with their account rather than in one browser."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from app.api.dependencies import CurrentUser, Database
from app.db.models import User

router = APIRouter(prefix="/preferences", tags=["preferences"])


LibrarySection = Literal["books", "authors", "series", "saved"]


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


class PreferencesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    collection_view: Literal["detail", "list"] | None = None
    # Replaces every saved view: send all the ones to keep, or {} to reset them all.
    library_views: dict[LibrarySection, SavedView] | None = None


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
    row = await db.get(User, user.id, with_for_update=True)
    row.preferences = {**(row.preferences or {}), **changes}
    await db.commit()
    return view(row.preferences)
