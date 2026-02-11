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


CurationStatus = Literal["draft", "linked", "active", "deleted", "archived"]


class CurationBase(BaseModel):
    """Base Curation model"""
    status: CurationStatus = Field(default="draft", description="Curation lifecycle status")
    notes: Optional[CurationNotes] = None
    categories: CurationCategories = Field(default_factory=CurationCategories)
    sources: List[str] = Field(default_factory=list)
    items: Optional[List[Dict[str, Any]]] = Field(default=None, description="Detailed items/concepts list")


class CurationCreate(CurationBase):
    """Curation creation request"""
    curation_id: str = Field(..., description="Unique curation ID")
    entity_id: Optional[str] = Field(None, description="Entity this curation is about (null for orphaned curations)")
    curator_id: str = Field(..., description="Curator ID for filtering")
    curator: CuratorInfo


class CurationUpdate(BaseModel):
    """Curation update request (all optional for PATCH)"""
    entity_id: Optional[str] = None
    status: Optional[CurationStatus] = None
    notes: Optional[CurationNotes] = None
    categories: Optional[CurationCategories] = None
    sources: Optional[List[str]] = None
    embeddings: Optional[List[Dict]] = None
    embeddings_metadata: Optional[Dict] = None
    items: Optional[List[Dict[str, Any]]] = None


class Curation(CurationBase):
    """Complete Curation with system fields"""
    id: str = Field(..., alias="_id")
    curation_id: str
    entity_id: Optional[str] = None
    curator_id: Optional[str] = None
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


# ============================================================================
# SEMANTIC SEARCH MODELS
# ============================================================================

class SemanticSearchRequest(BaseModel):
    """Request para busca semântica por embeddings"""
    query: str = Field(..., min_length=1, max_length=500, description="Query text for semantic search")
    limit: int = Field(default=10, ge=1, le=100, description="Maximum number of results")
    min_similarity: float = Field(default=0.0, ge=0.0, le=1.0, description="Minimum cosine similarity threshold (0.0 returns all results ranked)")
    entity_types: Optional[List[str]] = Field(None, description="Filter by entity types (e.g., ['restaurant'])")
    categories: Optional[List[str]] = Field(None, description="Filter by specific categories")
    include_entity: bool = Field(default=True, description="Include entity data in response")


class ConceptMatch(BaseModel):
    """Individual concept match with similarity score"""
    text: str = Field(..., description="Full text of the match (e.g., 'cuisine japanese')")
    category: str = Field(..., description="Category of the concept")
    concept: str = Field(..., description="Concept value")
    similarity: float = Field(..., description="Cosine similarity score (0-1)")


class SemanticSearchResult(BaseModel):
    """Individual result from semantic search"""
    entity_id: str
    entity: Optional[Dict] = None
    curation: Dict
    matches: List[ConceptMatch]
    avg_similarity: float
    max_similarity: float
    match_count: int


class SemanticSearchResponse(BaseModel):
    """Complete semantic search response"""
    results: List[SemanticSearchResult]
    query: str
    query_embedding_time: float
    search_time: float
    total_results: int


class HybridSearchRequest(BaseModel):
    """Request para busca híbrida (entities + semantic curations)"""
    query: str = Field(..., min_length=1, max_length=500, description="Search query text")
    location: Optional[str] = Field(None, description="Location filter (city, neighborhood)")
    limit: int = Field(default=10, ge=1, le=100, description="Maximum number of results")
    min_similarity: float = Field(default=0.5, ge=0.0, le=1.0, description="Minimum cosine similarity for semantic matches")
    categories: Optional[List[str]] = Field(None, description="Filter by specific categories")
    boost_semantic: float = Field(default=0.7, ge=0.0, le=1.0, description="Weight for semantic score (0-1)")


class HybridSearchResult(BaseModel):
    """Resultado combinado de busca híbrida"""
    entity_id: str = Field(..., description="Entity ID")
    entity: dict = Field(..., description="Entity data")
    curation: Optional[dict] = Field(None, description="Curation data if available")
    score: float = Field(..., description="Combined score (0-1)")
    match_type: str = Field(..., description="Type of match: 'entity', 'semantic', 'hybrid'")
    entity_score: float = Field(default=0.0, description="Entity match score")
    semantic_score: float = Field(default=0.0, description="Semantic match score")
    semantic_matches: Optional[List[ConceptMatch]] = Field(None, description="Top semantic matches")


class HybridSearchResponse(BaseModel):
    """Response da busca híbrida"""
    results: List[HybridSearchResult] = Field(..., description="Ranked results")
    query: str = Field(..., description="Original query")
    entity_search_time: float = Field(..., description="Time for entity search (seconds)")
    semantic_search_time: float = Field(..., description="Time for semantic search (seconds)")
    total_time: float = Field(..., description="Total search time (seconds)")
    total_results: int = Field(..., description="Total number of results")
