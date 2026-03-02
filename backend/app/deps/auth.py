from __future__ import annotations

import sentry_sdk
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.db.schema import accounts_user
from app.utils.auth import decode_token


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail="Not authenticated")

    token = authorization.split(" ", 1)[1].strip()
    try:
        data = decode_token(token)
    except Exception:
        raise HTTPException(401, detail="Invalid token")

    if data.get("type") != "access":
        raise HTTPException(401, detail="Invalid token")

    sub = data.get("sub")
    if sub is None:
        raise HTTPException(401, detail="Invalid token")

    row = db.execute(select(accounts_user).where(accounts_user.c.id == int(sub))).mappings().first()
    if not row:
        raise HTTPException(401, detail="User not found")

    if "is_active" in accounts_user.c and not row.get("is_active", True):
        raise HTTPException(401, detail="User inactive")

    sentry_sdk.set_user({"id": str(row.get("id")), "email": str(row.get("email") or "")})
    return dict(row)
