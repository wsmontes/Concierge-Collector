"""
Pydantic models for API V3 Entity-Curation architecture
Professional data validation and serialization
"""

from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field, EmailStr, ConfigDict


# ============================================================================
# METADATA MODELS
# ============================================================================

class Metadata(BaseModel):
    """Extensible metadata from multiple sources"""
    type: str = Field(..., description="Metadata type (e.g., 'google_places', 'michelin')")
    source: str = Field(..., description="Data source identifier")
    importedAt: Optional[datetime] = Field(None, description="Import timestamp")
    data: Dict[str, Any] = Field(default_factory=dict, description="Flexible data storage")


class SyncInfo(BaseModel):
    """Client-server synchronization metadata"""
    serverId: Optional[int] = Field(None, description="Server-side ID")
    status: str = Field(default="pending", description="Sync status")
    lastSyncedAt: Optional[datetime] = Field(None, description="Last sync timestamp")


# ============================================================================
# ENTITY MODELS
# ============================================================================

EntityType = Literal["restaurant", "hotel", "venue", "bar", "cafe", "other"]
EntityStatus = Literal["active", "inactive", "draft"]


class EntityBase(BaseModel):
    """Base Entity model"""
    type: EntityType
    name: str = Field(..., min_length=1, max_length=500)
    status: EntityStatus = Field(default="active")
    externalId: Optional[str] = None
    metadata: List[Metadata] = Field(default_factory=list)
    sync: Optional[SyncInfo] = None
    data: Optional[Dict[str, Any]] = Field(default=None, description="Flexible data storage (location, contacts, media, attributes, etc.)")


class EntityCreate(EntityBase):
    """Entity creation request"""
    entity_id: str = Field(..., description="Unique entity ID")
    createdBy: Optional[str] = Field(None, description="Curator ID who created this")


class EntityUpdate(BaseModel):
    """Entity update request (all optional for PATCH)"""
    name: Optional[str] = Field(None, min_length=1, max_length=500)
    type: Optional[EntityType] = None
    status: Optional[EntityStatus] = None
    externalId: Optional[str] = None
    metadata: Optional[List[Metadata]] = None
    sync: Optional[SyncInfo] = None
    data: Optional[Dict[str, Any]] = Field(None, description="Flexible data storage")
    updatedBy: Optional[str] = Field(None, description="Curator ID who updated this")


class Entity(EntityBase):
    """Complete Entity with system fields"""
    id: str = Field(..., alias="_id")
    entity_id: str
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    createdBy: Optional[str] = None
    updatedBy: Optional[str] = None
    version: int = Field(default=1, description="Optimistic locking version")
    
    model_config = ConfigDict(populate_by_name=True)


# ============================================================================
# CURATION MODELS
# ============================================================================

class CuratorInfo(BaseModel):
    """Curator information"""
    id: str
    name: str
    email: Optional[EmailStr] = None


class CurationNotes(BaseModel):
    """Public and private notes"""
    public: Optional[str] = None
    private: Optional[str] = None


class CurationCategories(BaseModel):
    """
    Concept categories - flexible structure loaded from MongoDB concepts collection
    Categories are NOT hardcoded - they come from database and can change dynamically
    """
    model_config = ConfigDict(extra='allow')  # Allow any additional fields from MongoDB


class CurationBase(BaseModel):
    """Base Curation model"""
    notes: Optional[CurationNotes] = None
    categories: CurationCategories = Field(default_factory=CurationCategories)
    sources: List[str] = Field(default_factory=list)


class CurationCreate(CurationBase):
    """Curation creation request"""
    curation_id: str = Field(..., description="Unique curation ID")
    entity_id: str = Field(..., description="Entity this curation is about")
    curator: CuratorInfo


class CurationUpdate(BaseModel):
    """Curation update request (all optional for PATCH)"""
    notes: Optional[CurationNotes] = None
    categories: Optional[CurationCategories] = None
    sources: Optional[List[str]] = None
    embeddings: Optional[List[Dict]] = None
    embeddings_metadata: Optional[Dict] = None


class Curation(CurationBase):
    """Complete Curation with system fields"""
    id: str = Field(..., alias="_id")
    curation_id: str
    entity_id: str
    curator: CuratorInfo
    embeddings: Optional[List[Dict]] = None
    embeddings_metadata: Optional[Dict] = None
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    version: int = Field(default=1)
    
    model_config = ConfigDict(populate_by_name=True)


# ============================================================================
# RESPONSE MODELS
# ============================================================================

class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    timestamp: datetime
    database: str


class APIInfo(BaseModel):
    """API information"""
    name: str
    version: str
    description: str


class ErrorResponse(BaseModel):
    """Error response"""
    error: str
    message: str
    details: Optional[Dict[str, Any]] = None


class PaginatedResponse(BaseModel):
    """Paginated list response"""
    items: List[Any]
    total: int
    limit: int
    offset: int
