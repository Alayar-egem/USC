from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import insert, select, update
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.db.schema import accounts_user as users
from app.db.schema import companies_company as companies
from app.db.schema import companies_companymember as company_members
from app.core.config import settings
from app.utils.auth import create_access_token, create_refresh_token, make_legacy_password, verify_legacy_password
from app.utils.emailer import can_send, send_email

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginPayload(BaseModel):
    email: str
    password: str = Field(min_length=1)


class TokenPair(BaseModel):
    access: str
    refresh: Optional[str] = None


class RefreshPayload(BaseModel):
    refresh: str


class RegisterPayload(BaseModel):
    email: str
    password: str
    code: str = ""
    first_name: str = ""
    last_name: str = ""
    phone: str = ""
    role: str = "buyer"


class RegisterResponse(BaseModel):
    id: int
    email: str
    first_name: str = ""
    last_name: str = ""
    phone: str = ""
    role: str = "buyer"


class PhoneRequestPayload(BaseModel):
    phone: str


class PhoneRequestResponse(BaseModel):
    sent: bool
    code: Optional[str] = None
    expires_in: int = 300


class PhoneVerifyPayload(BaseModel):
    phone: str
    code: str
    role: str = "buyer"
    email: Optional[str] = None
    first_name: str = ""
    last_name: str = ""


class EmailRequestPayload(BaseModel):
    email: str


class EmailVerifyPayload(BaseModel):
    email: str
    code: str
    role: str = "buyer"
    first_name: str = ""
    last_name: str = ""
    phone: str = ""


def _col(name: str):
    c = users.c.get(name)
    if c is None:
        raise HTTPException(500, detail=f"DB schema mismatch: column 'accounts_user.{name}' not found")
    return c


def _normalize_phone(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit() or ch == "+")


def _is_valid_email(email: str) -> bool:
    if not email or "@" not in email:
        return False
    parts = email.split("@")
    return len(parts) == 2 and all(parts)


ROLE_COLUMNS = ("role", "user_role", "user_type", "account_type")


def _get_role_from_row(row: dict) -> Optional[str]:
    for col in ROLE_COLUMNS:
        if col in users.c and row.get(col) is not None:
            return str(row.get(col))
    return None


def _set_role_value(values: dict, role: str):
    for col in ROLE_COLUMNS:
        if col in users.c:
            values[col] = role
            break


def _make_placeholder_email(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    if not digits:
        digits = "user"
    return f"{digits}@phone.local"


def _default_company_name(email: str, first_name: str, last_name: str) -> str:
    label = "USC Company"
    name = " ".join([first_name.strip(), last_name.strip()]).strip()
    if name:
        label = name
    elif email and "@" in email:
        label = email.split("@", 1)[0]
    return f"{label} Co."


def _ensure_company_for_user(db: Session, *, user_id: int, role: str, email: str, first_name: str, last_name: str):
    exists = db.execute(select(company_members.c.id).where(company_members.c.user_id == user_id)).first()
    if exists:
        return

    now = datetime.now(timezone.utc)
    company_type = "SUPPLIER" if role.lower() == "supplier" else "BUYER"

    # Keep inserts robust even if DB columns are NOT NULL and do not have defaults.
    values = {"name": _default_company_name(email, first_name, last_name)}
    if "company_type" in companies.c:
        values["company_type"] = company_type
    if "phone" in companies.c:
        values["phone"] = ""
    if "address" in companies.c:
        values["address"] = ""
    if "created_at" in companies.c:
        values["created_at"] = now

    ins = insert(companies).values(values).returning(companies.c.id)
    company_id = int(db.execute(ins).scalar_one())

    member_values = {"user_id": user_id, "company_id": company_id}
    if "role" in company_members.c:
        member_values["role"] = "OWNER"
    if "created_at" in company_members.c:
        member_values["created_at"] = now

    db.execute(insert(company_members).values(member_values))


PHONE_CODES: dict[str, tuple[str, datetime]] = {}
EMAIL_CODES: dict[str, tuple[str, datetime]] = {}


def _code_expires_at() -> datetime:
    ttl = max(60, int(settings.EMAIL_CODE_EXPIRES_SECONDS or 300))
    return datetime.now(timezone.utc) + timedelta(seconds=ttl)


def _code_length() -> int:
    return max(4, min(8, int(settings.EMAIL_CODE_LENGTH or 6)))


def _generate_code() -> str:
    digits = _code_length()
    min_val = 10 ** (digits - 1)
    max_val = (10**digits) - 1
    return str(secrets.randbelow(max_val - min_val + 1) + min_val)


@router.post("/login/", response_model=TokenPair)
def login(payload: LoginPayload, db: Session = Depends(get_db)):
    if not _is_valid_email(payload.email):
        raise HTTPException(400, detail="Invalid email")
    u = db.execute(
        select(users).where(_col("email") == str(payload.email))
    ).mappings().first()
    if not u:
        raise HTTPException(401, detail="Invalid credentials")

    if not verify_legacy_password(payload.password, str(u.get("password") or "")):
        raise HTTPException(401, detail="Invalid credentials")

    role = _get_role_from_row(u) or None

    subject = str(u.get("id"))
    extra = {"email": u.get("email")}
    if role:
        extra["role"] = role
    access = create_access_token(subject=subject, extra=extra)
    refresh = create_refresh_token(subject=subject, extra=extra)
    return TokenPair(access=access, refresh=refresh)


# SimpleJWT-ish aliases (JSON body; not form-encoded)
@router.post("/token/", response_model=TokenPair)
def token(payload: LoginPayload, db: Session = Depends(get_db)):
    return login(payload, db)


@router.post("/token/refresh/", response_model=TokenPair)
def token_refresh(payload: RefreshPayload):
    from app.utils.auth import decode_token

    try:
        data = decode_token(payload.refresh)
    except Exception:
        raise HTTPException(401, detail="Invalid refresh token")

    if data.get("type") != "refresh":
        raise HTTPException(401, detail="Invalid refresh token")

    subject = str(data.get("sub"))
    extra = {"email": data.get("email")}
    if data.get("role"):
        extra["role"] = data.get("role")
    access = create_access_token(subject=subject, extra=extra)
    return TokenPair(access=access)


@router.post("/register/", response_model=RegisterResponse)
def register(payload: RegisterPayload, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    code_input = payload.code.strip()

    if not _is_valid_email(email):
        raise HTTPException(400, detail="Invalid email")
    if not payload.password or len(payload.password) < 6:
        raise HTTPException(400, detail="Password too short")
    if not code_input:
        raise HTTPException(400, detail="Email code required")
    entry = EMAIL_CODES.get(email)
    if not entry:
        raise HTTPException(400, detail="Code not requested")
    code, exp = entry
    if datetime.now(timezone.utc) > exp:
        EMAIL_CODES.pop(email, None)
        raise HTTPException(400, detail="Code expired")
    if code_input != code:
        raise HTTPException(400, detail="Invalid code")
    existing = db.execute(select(_col("id")).where(_col("email") == email)).first()
    if existing:
        raise HTTPException(400, detail="User with this email already exists")
    if payload.phone:
        existing_phone = db.execute(select(_col("id")).where(_col("phone") == _normalize_phone(payload.phone))).first()
        if existing_phone:
            raise HTTPException(400, detail="User with this phone already exists")

    password_hash = make_legacy_password(payload.password)
    now = datetime.now(timezone.utc)

    values = {
        "email": email,
        "password": password_hash,
        "first_name": payload.first_name or "",
        "last_name": payload.last_name or "",
        "phone": _normalize_phone(payload.phone) if payload.phone else "",
    }
    if payload.role:
        _set_role_value(values, payload.role)

    # defaults (if columns exist)
    if "is_active" in users.c:
        values["is_active"] = True
    if "is_staff" in users.c:
        values["is_staff"] = False
    if "is_superuser" in users.c:
        values["is_superuser"] = False
    if "is_courier_enabled" in users.c:
        values["is_courier_enabled"] = False
    if "created_at" in users.c:
        values["created_at"] = now
    if "last_login" in users.c:
        values["last_login"] = None

    try:
        ins = insert(users).values(values).returning(_col("id"))
        user_id = int(db.execute(ins).scalar_one())
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, detail=f"Register failed. DB says: {e}")

    try:
        _ensure_company_for_user(
            db,
            user_id=user_id,
            role=payload.role or "buyer",
            email=email,
            first_name=payload.first_name or "",
            last_name=payload.last_name or "",
        )
        db.commit()
    except Exception:
        db.rollback()

    return RegisterResponse(
        id=user_id,
        email=email,
        first_name=payload.first_name or "",
        last_name=payload.last_name or "",
        phone=payload.phone or "",
        role=payload.role or "buyer",
    )


@router.post("/phone/request/", response_model=PhoneRequestResponse)
def phone_request(payload: PhoneRequestPayload):
    phone = _normalize_phone(payload.phone)
    if not phone or len(phone) < 6:
        raise HTTPException(400, detail="Invalid phone")

    code = _generate_code()
    expires_at = _code_expires_at()
    PHONE_CODES[phone] = (code, expires_at)
    expires_in = max(60, int(settings.EMAIL_CODE_EXPIRES_SECONDS or 300))
    return PhoneRequestResponse(sent=True, code=code, expires_in=expires_in)


@router.post("/phone/verify/", response_model=TokenPair)
def phone_verify(payload: PhoneVerifyPayload, db: Session = Depends(get_db)):
    phone = _normalize_phone(payload.phone)
    if not phone or len(phone) < 6:
        raise HTTPException(400, detail="Invalid phone")
    if not payload.code or len(payload.code) < 4:
        raise HTTPException(400, detail="Invalid code")

    entry = PHONE_CODES.get(phone)
    if not entry:
        raise HTTPException(400, detail="Code not requested")

    code, exp = entry
    if datetime.now(timezone.utc) > exp:
        PHONE_CODES.pop(phone, None)
        raise HTTPException(400, detail="Code expired")
    if payload.code != code:
        raise HTTPException(400, detail="Invalid code")

    u = db.execute(select(users).where(_col("phone") == phone)).mappings().first()

    if not u:
        email = str(payload.email) if payload.email and _is_valid_email(payload.email) else _make_placeholder_email(phone)
        # ensure unique email
        while db.execute(select(_col("id")).where(_col("email") == email)).first():
            email = _make_placeholder_email(phone) + f".{secrets.randbelow(9999)}"

        password_hash = make_legacy_password(secrets.token_urlsafe(8))
        now = datetime.now(timezone.utc)
        values = {
            "email": email,
            "password": password_hash,
            "first_name": payload.first_name or "",
            "last_name": payload.last_name or "",
            "phone": phone,
        }
        if payload.role:
            _set_role_value(values, payload.role)
        if "is_active" in users.c:
            values["is_active"] = True
        if "is_staff" in users.c:
            values["is_staff"] = False
        if "is_superuser" in users.c:
            values["is_superuser"] = False
        if "is_courier_enabled" in users.c:
            values["is_courier_enabled"] = False
        if "created_at" in users.c:
            values["created_at"] = now
        if "last_login" in users.c:
            values["last_login"] = None

        try:
            ins = insert(users).values(values).returning(_col("id"))
            user_id = int(db.execute(ins).scalar_one())
            db.commit()
        except Exception as e:
            db.rollback()
            raise HTTPException(400, detail=f"Register failed. DB says: {e}")

        try:
            _ensure_company_for_user(
                db,
                user_id=user_id,
                role=payload.role or "buyer",
                email=email,
                first_name=payload.first_name or "",
                last_name=payload.last_name or "",
            )
            db.commit()
        except Exception:
            db.rollback()

        u = {"id": user_id, "email": email}
        if payload.role:
            u["role"] = payload.role
    else:
        if payload.role:
            # update role if column exists
            values = {}
            _set_role_value(values, payload.role)
            if values:
                db.execute(update(users).where(_col("id") == u.get("id")).values(values))
                db.commit()

        try:
            _ensure_company_for_user(
                db,
                user_id=int(u.get("id")),
                role=payload.role or _get_role_from_row(u) or "buyer",
                email=str(u.get("email") or ""),
                first_name=str(u.get("first_name") or ""),
                last_name=str(u.get("last_name") or ""),
            )
            db.commit()
        except Exception:
            db.rollback()

    role = _get_role_from_row(u) or payload.role
    subject = str(u.get("id"))
    extra = {"email": u.get("email")}
    if role:
        extra["role"] = role
    access = create_access_token(subject=subject, extra=extra)
    refresh = create_refresh_token(subject=subject, extra=extra)
    return TokenPair(access=access, refresh=refresh)


@router.post("/email/request/", response_model=PhoneRequestResponse)
def email_request(payload: EmailRequestPayload):
    email = payload.email.strip().lower()
    if not _is_valid_email(email):
        raise HTTPException(400, detail="Invalid email")

    code = _generate_code()
    expires_at = _code_expires_at()
    EMAIL_CODES[email] = (code, expires_at)
    expires_in = max(60, int(settings.EMAIL_CODE_EXPIRES_SECONDS or 300))
    if can_send():
        try:
            send_email(
                email,
                subject="USC verification code",
                text=f"Your USC verification code: {code}\nValid for {expires_in // 60} minutes.",
            )
            return PhoneRequestResponse(sent=True, code=None, expires_in=expires_in)
        except Exception:
            raise HTTPException(502, detail="Failed to send email code")

    if settings.EMAIL_CODE_DEV_FALLBACK:
        return PhoneRequestResponse(sent=True, code=code, expires_in=expires_in)
    raise HTTPException(503, detail="Email provider is not configured")


@router.post("/email/verify/", response_model=TokenPair)
def email_verify(payload: EmailVerifyPayload, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if not _is_valid_email(email):
        raise HTTPException(400, detail="Invalid email")
    if not payload.code or len(payload.code) < 4:
        raise HTTPException(400, detail="Invalid code")

    entry = EMAIL_CODES.get(email)
    if not entry:
        raise HTTPException(400, detail="Code not requested")
    code, exp = entry
    if datetime.now(timezone.utc) > exp:
        EMAIL_CODES.pop(email, None)
        raise HTTPException(400, detail="Code expired")
    if payload.code != code:
        raise HTTPException(400, detail="Invalid code")

    u = db.execute(select(users).where(_col("email") == email)).mappings().first()

    if not u:
        password_hash = make_legacy_password(secrets.token_urlsafe(8))
        now = datetime.now(timezone.utc)
        values = {
            "email": email,
            "password": password_hash,
            "first_name": payload.first_name or "",
            "last_name": payload.last_name or "",
            "phone": _normalize_phone(payload.phone) if payload.phone else "",
        }
        if payload.role:
            _set_role_value(values, payload.role)
        if "is_active" in users.c:
            values["is_active"] = True
        if "is_staff" in users.c:
            values["is_staff"] = False
        if "is_superuser" in users.c:
            values["is_superuser"] = False
        if "is_courier_enabled" in users.c:
            values["is_courier_enabled"] = False
        if "created_at" in users.c:
            values["created_at"] = now
        if "last_login" in users.c:
            values["last_login"] = None

        try:
            ins = insert(users).values(values).returning(_col("id"))
            user_id = int(db.execute(ins).scalar_one())
            db.commit()
        except Exception as e:
            db.rollback()
            raise HTTPException(400, detail=f"Register failed. DB says: {e}")

        try:
            _ensure_company_for_user(
                db,
                user_id=user_id,
                role=payload.role or "buyer",
                email=email,
                first_name=payload.first_name or "",
                last_name=payload.last_name or "",
            )
            db.commit()
        except Exception:
            db.rollback()

        u = {"id": user_id, "email": email}
        if payload.role:
            u["role"] = payload.role
    else:
        if payload.role:
            values = {}
            _set_role_value(values, payload.role)
            if values:
                db.execute(update(users).where(_col("id") == u.get("id")).values(values))
                db.commit()

        try:
            _ensure_company_for_user(
                db,
                user_id=int(u.get("id")),
                role=payload.role or _get_role_from_row(u) or "buyer",
                email=str(u.get("email") or ""),
                first_name=str(u.get("first_name") or ""),
                last_name=str(u.get("last_name") or ""),
            )
            db.commit()
        except Exception:
            db.rollback()

    role = _get_role_from_row(u) or payload.role
    subject = str(u.get("id"))
    extra = {"email": u.get("email")}
    if role:
        extra["role"] = role
    access = create_access_token(subject=subject, extra=extra)
    refresh = create_refresh_token(subject=subject, extra=extra)
    return TokenPair(access=access, refresh=refresh)
