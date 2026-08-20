"""Public, minimal Collection association response models."""

from pydantic import BaseModel, Field


class PublishedCollectionAssociation(BaseModel):
    collection_id: str = Field(min_length=1)
    slug: str
    title: str
    current_published_version: int = Field(ge=1)


class PublishedCollectionAssociationResponse(BaseModel):
    items: list[PublishedCollectionAssociation]
