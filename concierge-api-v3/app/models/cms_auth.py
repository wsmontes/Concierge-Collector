"""Schemas shared by the CMS handoff and introspection contracts."""

from pydantic import BaseModel, EmailStr

from app.models.user import UserRole


class CmsAuthorization(BaseModel):
    """The current operational authorization for a CMS administrator."""

    user_id: str
    email: EmailStr
    name: str
    picture: str | None = None
    role: UserRole
    authorized: bool
    authz_revision: str


class CmsExchangeRequest(BaseModel):
    """Payload accepted by the server-to-server one-shot exchange endpoint."""

    code: str
    state: str
    target_origin: str


class CmsIntrospectionRequest(BaseModel):
    """Payload accepted by the CMS introspection endpoint."""

    subject: str
