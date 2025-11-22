"""
File: llm_models.py
Purpose: Pydantic models for LLM Gateway API
Dependencies: pydantic
Last Updated: November 21, 2025

This module defines request/response models for the LLM Gateway API.
These models provide a unified, LLM-friendly view of restaurant data,
consolidating information from Google Places, Michelin, entities, and curations.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# ============================================================================
# CORE SNAPSHOT MODEL
# ============================================================================

class LLMRestaurantGeo(BaseModel):
    """Geographic information"""
    lat: float = Field(..., description="Latitude")
    lng: float = Field(..., description="Longitude")
    city: Optional[str] = Field(None, description="City name")
    state: Optional[str] = Field(None, description="State/region")
    country: Optional[str] = Field(None, description="Country code (e.g., BR, US)")
    postal_code: Optional[str] = Field(None, description="Postal/ZIP code")


class LLMRestaurantStatus(BaseModel):
    """Operational status information"""
    is_open_now: Optional[bool] = Field(None, description="Whether the place is currently open")
    open_on_weekend: Optional[bool] = Field(None, description="Whether the place opens on weekends")
    weekend_days_open: Optional[List[str]] = Field(None, description="Which weekend days are open (e.g., ['saturday', 'sunday'])")
    supports_reservation: Optional[bool] = Field(None, description="Whether reservations are supported")
    business_status: Optional[str] = Field(None, description="Business operational status (e.g., OPERATIONAL, CLOSED)")


class LLMRestaurantHoursPeriod(BaseModel):
    """Single opening/closing period"""
    open: str = Field(..., description="Opening time in HH:MM format")
    close: str = Field(..., description="Closing time in HH:MM format")


class LLMRestaurantOpeningHours(BaseModel):
    """Opening hours information"""
    source: Optional[str] = Field(None, description="Data source (e.g., google_places)")
    timezone: Optional[str] = Field(None, description="Timezone (e.g., America/Sao_Paulo)")
    regular_hours: Optional[Dict[str, List[LLMRestaurantHoursPeriod]]] = Field(
        None,
        description="Regular hours by day of week"
    )
    notes: Optional[List[str]] = Field(None, description="Additional notes about hours")


class LLMRestaurantMichelin(BaseModel):
    """Michelin guide information"""
    has_star: bool = Field(False, description="Whether the restaurant has Michelin star(s)")
    stars: Optional[int] = Field(None, description="Number of Michelin stars (1-3)")
    guide_year: Optional[int] = Field(None, description="Year of Michelin guide")
    bib_gourmand: bool = Field(False, description="Whether the restaurant has Bib Gourmand")
    comment: Optional[str] = Field(None, description="Michelin guide comment/description")
    cuisine: Optional[str] = Field(None, description="Cuisine type from Michelin")
    price: Optional[str] = Field(None, description="Price level from Michelin")


class LLMRestaurantCurationSource(BaseModel):
    """Curation source information"""
    curator_id: str = Field(..., description="Curator identifier")
    curator_name: Optional[str] = Field(None, description="Curator display name")
    strength: Optional[str] = Field(None, description="Recommendation strength (e.g., strong, medium, weak)")


class LLMRestaurantCuration(BaseModel):
    """Curated information about the restaurant"""
    tags: Optional[List[str]] = Field(None, description="Curated tags (e.g., ['romantic', 'good-wines'])")
    avoid_for: Optional[List[str]] = Field(None, description="Situations to avoid (e.g., ['large-groups'])")
    highlights: Optional[List[str]] = Field(None, description="Key highlights from curators")
    sources: Optional[List[LLMRestaurantCurationSource]] = Field(None, description="Curation sources")


class LLMRestaurantScores(BaseModel):
    """Rating and scoring information"""
    google_rating: Optional[float] = Field(None, description="Google rating (0-5)")
    google_reviews_count: Optional[int] = Field(None, description="Number of Google reviews")
    internal_quality_score: Optional[float] = Field(None, description="Internal quality score (0-1)")


class LLMRestaurantSnapshot(BaseModel):
    """
    Complete snapshot of a restaurant, unified from multiple sources.
    This is the main data structure that LLMs will interact with.
    """
    # Core identifiers
    entity_id: Optional[str] = Field(None, description="Internal entity ID")
    place_id: Optional[str] = Field(None, description="Google Place ID")
    external_refs: Optional[Dict[str, Any]] = Field(None, description="External reference IDs")
    
    # Basic information
    name: str = Field(..., description="Restaurant name")
    canonical_address: Optional[str] = Field(None, description="Full formatted address")
    geo: Optional[LLMRestaurantGeo] = Field(None, description="Geographic information")
    
    # Status and availability
    status: Optional[LLMRestaurantStatus] = Field(None, description="Operational status")
    opening_hours: Optional[LLMRestaurantOpeningHours] = Field(None, description="Opening hours information")
    
    # Quality indicators
    michelin: Optional[LLMRestaurantMichelin] = Field(None, description="Michelin guide information")
    curation: Optional[LLMRestaurantCuration] = Field(None, description="Curated information")
    scores: Optional[LLMRestaurantScores] = Field(None, description="Ratings and scores")
    
    # Contact and booking
    phone: Optional[str] = Field(None, description="Phone number")
    website: Optional[str] = Field(None, description="Website URL")
    
    # Additional metadata
    types: Optional[List[str]] = Field(None, description="Place types (e.g., ['restaurant', 'italian_restaurant'])")
    price_level: Optional[str] = Field(None, description="Price level (e.g., MODERATE, EXPENSIVE)")
    
    # Raw sources (optional, for debugging or advanced use)
    raw_sources: Optional[Dict[str, Any]] = Field(None, description="Raw data from sources")


# ============================================================================
# SEARCH RESTAURANTS
# ============================================================================

class LLMSearchRestaurantsRequest(BaseModel):
    """Request to search for restaurants"""
    query: str = Field(..., description="Restaurant name or search query")
    latitude: Optional[float] = Field(None, description="Latitude for location bias")
    longitude: Optional[float] = Field(None, description="Longitude for location bias")
    radius_m: int = Field(5000, description="Search radius in meters", ge=100, le=50000)
    max_results: int = Field(5, description="Maximum number of results", ge=1, le=20)
    language: str = Field("pt-BR", description="Language code for results")
    region: str = Field("BR", description="Region code for results")


class LLMSearchRestaurantItem(BaseModel):
    """Single search result item"""
    place_id: Optional[str] = Field(None, description="Google Place ID")
    entity_id: Optional[str] = Field(None, description="Internal entity ID (if exists)")
    name: str = Field(..., description="Restaurant name")
    canonical_address: Optional[str] = Field(None, description="Full address")
    geo: Optional[LLMRestaurantGeo] = Field(None, description="Geographic coordinates")
    google_rating: Optional[float] = Field(None, description="Google rating")
    has_entity: bool = Field(False, description="Whether this place has an entity record")
    has_michelin_data: bool = Field(False, description="Whether this place has Michelin data")
    michelin: Optional[LLMRestaurantMichelin] = Field(None, description="Basic Michelin info if available")


class LLMSearchRestaurantsResponse(BaseModel):
    """Response from restaurant search"""
    items: List[LLMSearchRestaurantItem] = Field(..., description="Search results")
    total_results: int = Field(..., description="Number of results returned")
    search_metadata: Optional[Dict[str, Any]] = Field(None, description="Additional search metadata")


# ============================================================================
# GET RESTAURANT SNAPSHOT
# ============================================================================

class LLMGetRestaurantSnapshotRequest(BaseModel):
    """Request to get complete restaurant snapshot"""
    place_id: Optional[str] = Field(None, description="Google Place ID")
    entity_id: Optional[str] = Field(None, description="Internal entity ID")
    
    # Source control flags
    include_google_places: bool = Field(True, description="Include Google Places data")
    include_michelin: bool = Field(True, description="Include Michelin guide data")
    include_curations: bool = Field(True, description="Include curation data")
    include_raw_sources: bool = Field(False, description="Include raw source data")
    
    # For time-based calculations
    reference_datetime_iso: Optional[str] = Field(None, description="Reference datetime in ISO format")
    timezone: str = Field("America/Sao_Paulo", description="Timezone for time calculations")


class LLMGetRestaurantSnapshotResponse(BaseModel):
    """Response with complete restaurant snapshot"""
    snapshot: LLMRestaurantSnapshot = Field(..., description="Complete restaurant data")
    sources_used: List[str] = Field(..., description="List of data sources used")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


# ============================================================================
# GET RESTAURANT AVAILABILITY
# ============================================================================

class LLMGetRestaurantAvailabilityRequest(BaseModel):
    """Request to get restaurant availability information"""
    place_id: Optional[str] = Field(None, description="Google Place ID")
    entity_id: Optional[str] = Field(None, description="Internal entity ID")
    
    # Time parameters
    date_iso: Optional[str] = Field(None, description="Date in ISO format (YYYY-MM-DD)")
    datetime_iso: Optional[str] = Field(None, description="Datetime in ISO format")
    timezone: str = Field("America/Sao_Paulo", description="Timezone")
    
    # Weekend configuration
    weekend_days: List[str] = Field(
        ["saturday", "sunday"],
        description="Days considered as weekend"
    )


class LLMDayAvailability(BaseModel):
    """Availability for a specific day"""
    is_open: bool = Field(..., description="Whether the place is open on this day")
    periods: List[LLMRestaurantHoursPeriod] = Field(..., description="Opening periods for this day")


class LLMGetRestaurantAvailabilityResponse(BaseModel):
    """Response with restaurant availability information"""
    resolved_entity_id: Optional[str] = Field(None, description="Resolved entity ID")
    resolved_place_id: Optional[str] = Field(None, description="Resolved place ID")
    name: Optional[str] = Field(None, description="Restaurant name")
    
    # Current status
    is_open_now: Optional[bool] = Field(None, description="Whether currently open")
    
    # Weekend availability
    open_on_weekend: Optional[bool] = Field(None, description="Whether open on any weekend day")
    weekend_days_open: Optional[List[str]] = Field(None, description="Which weekend days are open")
    
    # Detailed availability by day
    availability_by_day: Optional[Dict[str, LLMDayAvailability]] = Field(
        None,
        description="Detailed availability by day of week"
    )
    
    # Additional notes
    notes: Optional[List[str]] = Field(None, description="Additional availability notes")
    timezone: Optional[str] = Field(None, description="Timezone used for calculations")
