"""Each person's own preferences, saved with their account rather than in one browser."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.api.dependencies import CurrentUser, Database
from app.db.models import User

router = APIRouter(prefix="/preferences", tags=["preferences"])


class UserPreferences(BaseModel):
    # How Series, Authors and Following are laid out. "detail": the list beside the chosen
    # series or author; "list": one aligned row each.
    collection_view: Literal["detail", "list"] = "detail"


class PreferencesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    collection_view: Literal["detail", "list"] | None = None


def view(saved: dict | None) -> UserPreferences:
    known = UserPreferences.model_fields
    return UserPreferences(**{k: v for k, v in (saved or {}).items() if k in known})


@router.get("", response_model=UserPreferences)
async def read_preferences(user: CurrentUser):
    return view(user.preferences)


@router.patch("", response_model=UserPreferences)
async def save_preferences(body: PreferencesInput, user: CurrentUser, db: Database):
    changes = body.model_dump(exclude_none=True)
    row = await db.get(User, user.id, with_for_update=True)
    row.preferences = {**(row.preferences or {}), **changes}
    await db.commit()
    return view(row.preferences)
