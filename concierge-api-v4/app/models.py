"""
app/models.py

Purpose: Pydantic models for Entity-Curation architecture
Responsibilities:
  - Define Entity model (restaurants, hotels, venues)
  - Define Curation model (curator reviews, concepts)
  - Define Metadata model (extensible data structure)
  - Validation and serialization
Dependencies: pydantic
"""

from datetime import datetime
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field, EmailStr, field_validator


# ============================================================================
# METADATA MODELS
# ============================================================================

class Metadata(BaseModel):
    """
    Extensible metadata model for entities and curations
    Allows storing data from multiple sources (Google Places, Michelin, Concierge)
    """
    type: str = Field(..., description="Metadata type (e.g., 'google_places', 'michelin', 'concierge_embeddings')")
    source: str = Field(..., description="Data source identifier")
    data: Dict[str, Any] = Field(default_factory=dict, description="Flexible data storage")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="When metadata was added")


# ============================================================================
# LOCATION MODELS
# ============================================================================

class Coordinates(BaseModel):
    """Geographic coordinates"""
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)


class Location(BaseModel):
    """Physical location information"""
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    postalCode: Optional[str] = Field(None, alias="postal_code")
    coordinates: Optional[Coordinates] = None


class Contact(BaseModel):
    """Contact information"""
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    website: Optional[str] = None


# ============================================================================
# SYNC MODELS
# ============================================================================

class SyncInfo(BaseModel):
    """Synchronization metadata"""
    lastSyncedAt: Optional[datetime] = Field(None, alias="last_synced_at")
    syncStatus: str = Field(default="pending", alias="sync_status")  # pending, synced, conflict, error
    syncSource: Optional[str] = Field(None, alias="sync_source")  # collector, concierge
    remoteVersion: Optional[int] = Field(None, alias="remote_version")


# ============================================================================
# ENTITY MODEL
# ============================================================================

EntityType = Literal["restaurant", "hotel", "venue", "bar", "cafe", "other"]
EntityStatus = Literal["active", "archived", "deleted", "draft"]

class EntityBase(BaseModel):
    """Base Entity model (shared fields)"""
    type: EntityType = Field(..., description="Entity type: restaurant, hotel, venue, etc.")
    name: str = Field(..., min_length=1, max_length=255)
    status: EntityStatus = Field(default="active", description="active, archived, deleted, draft")
    location: Optional[Location] = None
    contact: Optional[Contact] = None
    metadata: List[Metadata] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    notes: Optional[str] = None


class EntityCreate(EntityBase):
    """Entity creation model"""
    createdBy: str = Field(..., alias="created_by", description="Curator ID who created this entity")


class EntityUpdate(BaseModel):
    """Entity update model (all fields optional)"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    status: Optional[EntityStatus] = None
    location: Optional[Location] = None
    contact: Optional[Contact] = None
    metadata: Optional[List[Metadata]] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    version: int = Field(..., description="Current version for optimistic locking")


class Entity(EntityBase):
    """Complete Entity model (database representation)"""
    entity_id: str = Field(..., alias="entity_id", description="Unique entity identifier")
    createdBy: str = Field(..., alias="created_by")
    createdAt: datetime = Field(default_factory=datetime.utcnow, alias="created_at")
    updatedAt: datetime = Field(default_factory=datetime.utcnow, alias="updated_at")
    version: int = Field(default=1, description="Optimistic locking version")
    syncInfo: Optional[SyncInfo] = Field(None, alias="sync_info")

    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "entity_id": "entity_1234567890",
                "type": "restaurant",
                "name": "Le Bernardin",
                "status": "active",
                "location": {
                    "address": "155 W 51st St",
                    "city": "New York",
                    "state": "NY",
                    "country": "USA",
                    "postal_code": "10019",
                    "coordinates": {
                        "latitude": 40.7614,
                        "longitude": -73.9776
                    }
                },
                "contact": {
                    "phone": "+1 212-554-1515",
                    "website": "https://le-bernardin.com"
                },
                "metadata": [
                    {
                        "type": "google_places",
                        "source": "google_places_api",
                        "data": {
                            "place_id": "ChIJexample123",
                            "rating": 4.7,
                            "user_ratings_total": 2453
                        }
                    },
                    {
                        "type": "michelin",
                        "source": "michelin_guide",
                        "data": {
                            "stars": 3,
                            "year": 2024
                        }
                    }
                ],
                "tags": ["fine-dining", "seafood", "michelin-starred"],
                "created_by": "curator_123",
                "created_at": "2024-01-15T10:30:00Z",
                "updated_at": "2024-01-15T10:30:00Z",
                "version": 1
            }
        }


# ============================================================================
# PAGINATION MODELS
# ============================================================================

class EntityListResponse(BaseModel):
    """Paginated entity list response"""
    entities: List['Entity'] = Field(default_factory=list, description="List of entities")
    total: int = Field(..., description="Total number of entities matching filters")
    skip: int = Field(default=0, description="Number of records skipped")
    limit: int = Field(default=100, description="Maximum records returned")


class CurationListResponse(BaseModel):
    """Paginated curation list response"""
    curations: List['Curation'] = Field(default_factory=list, description="List of curations")
    total: int = Field(..., description="Total number of curations matching filters")
    skip: int = Field(default=0, description="Number of records skipped")
    limit: int = Field(default=100, description="Maximum records returned")


# ============================================================================
# CURATION MODEL
# ============================================================================

class CurationBase(BaseModel):
    """Base Curation model (shared fields)"""
    entity_id: str = Field(..., description="Associated entity ID")
    category: str = Field(..., description="Curation category (e.g., 'ambiance', 'service', 'food')")
    concept: str = Field(..., min_length=1, description="Curator's concept/review")
    notes: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    metadata: List[Metadata] = Field(default_factory=list)


class CurationCreate(CurationBase):
    """Curation creation model"""
    curator_id: str = Field(..., description="Curator who created this curation")


class CurationUpdate(BaseModel):
    """Curation update model (all fields optional)"""
    category: Optional[str] = None
    concept: Optional[str] = Field(None, min_length=1)
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    metadata: Optional[List[Metadata]] = None
    version: int = Field(..., description="Current version for optimistic locking")


class Curation(CurationBase):
    """Complete Curation model (database representation)"""
    curation_id: str = Field(..., description="Unique curation identifier")
    curator_id: str = Field(..., description="Curator who created this")
    createdAt: datetime = Field(default_factory=datetime.utcnow, alias="created_at")
    updatedAt: datetime = Field(default_factory=datetime.utcnow, alias="updated_at")
    version: int = Field(default=1, description="Optimistic locking version")
    is_deleted: bool = Field(default=False, description="Soft delete flag")
    syncInfo: Optional[SyncInfo] = Field(None, alias="sync_info")

    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "curation_id": "curation_1234567890",
                "entity_id": "entity_1234567890",
                "curator_id": "curator_123",
                "category": "ambiance",
                "concept": "Intimate fine dining experience with exceptional attention to detail",
                "notes": "Perfect for special occasions",
                "tags": ["romantic", "quiet", "elegant"],
                "created_at": "2024-01-15T10:30:00Z",
                "updated_at": "2024-01-15T10:30:00Z",
                "version": 1
            }
        }


# ============================================================================
# CURATOR MODEL
# ============================================================================

class CuratorBase(BaseModel):
    """Base Curator model"""
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    status: str = Field(default="active", description="active, inactive, suspended")


class CuratorCreate(CuratorBase):
    """Curator creation model"""
    password: str = Field(..., min_length=8, description="Minimum 8 characters")


class Curator(CuratorBase):
    """Complete Curator model (database representation)"""
    curator_id: str = Field(..., description="Unique curator identifier")
    hashed_password: str = Field(..., exclude=True, description="Bcrypt hashed password")
    createdAt: datetime = Field(default_factory=datetime.utcnow, alias="created_at")
    lastActive: datetime = Field(default_factory=datetime.utcnow, alias="last_active")

    class Config:
        populate_by_name = True


# ============================================================================
# SYNC REQUEST/RESPONSE MODELS
# ============================================================================

class SyncPullRequest(BaseModel):
    """Request to pull changes from server"""
    curator_id: str
    last_sync_timestamp: Optional[datetime] = None
    entity_ids: Optional[List[str]] = Field(None, description="Specific entities to sync (optional)")


class SyncPullResponse(BaseModel):
    """Response with changes to pull"""
    entities: List[Entity] = Field(default_factory=list)
    curations: List[Curation] = Field(default_factory=list)
    deleted_entity_ids: List[str] = Field(default_factory=list)
    deleted_curation_ids: List[str] = Field(default_factory=list)
    sync_timestamp: datetime = Field(default_factory=datetime.utcnow)
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Alias for sync_timestamp")


class SyncPushRequest(BaseModel):
    """Request to push changes to server"""
    curator_id: str
    entities: List[Dict[str, Any]] = Field(default_factory=list, description="New/updated entities (flexible format)")
    curations: List[Dict[str, Any]] = Field(default_factory=list, description="New/updated curations (flexible format)")
    deleted_entity_ids: List[str] = Field(default_factory=list)
    deleted_curation_ids: List[str] = Field(default_factory=list)


class SyncPushResponse(BaseModel):
    """Response after pushing changes"""
    entities_created: int = 0
    entities_updated: int = 0
    entities_deleted: int = 0
    curations_created: int = 0
    curations_updated: int = 0
    curations_deleted: int = 0
    conflicts: List[Dict[str, Any]] = Field(default_factory=list)
    sync_timestamp: datetime = Field(default_factory=datetime.utcnow)


# ============================================================================
# CONCIERGE INTEGRATION MODELS
# ============================================================================

class ConciergeEmbedding(BaseModel):
    """Embeddings and analysis from Concierge platform"""
    entity_id: str
    embeddings: List[float] = Field(..., description="Vector embeddings")
    analysis: Dict[str, Any] = Field(default_factory=dict, description="AI analysis results")
    generated_at: datetime = Field(default_factory=datetime.utcnow)


class ConciergeUploadRequest(BaseModel):
    """Request from Concierge to store embeddings"""
    embeddings: List[ConciergeEmbedding]
    source: str = Field(default="concierge-platform")


class ConciergeUploadResponse(BaseModel):
    """Response after storing embeddings"""
    entities_updated: int = 0
    errors: List[Dict[str, Any]] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ============================================================================
# AUTHENTICATION MODELS
# ============================================================================

class UserRegister(BaseModel):
    """User registration request"""
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)
    email: EmailStr


class Token(BaseModel):
    """JWT token response"""
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Decoded token data"""
    curator_id: Optional[str] = None
    email: Optional[str] = None
