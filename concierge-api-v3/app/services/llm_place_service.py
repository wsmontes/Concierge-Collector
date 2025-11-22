"""
File: llm_place_service.py
Purpose: Service layer for LLM Gateway - consolidates restaurant data from multiple sources
Dependencies: pymongo, app.models.llm_models, app.core.database
Last Updated: November 21, 2025

This service orchestrates data from Google Places, MongoDB entities, Michelin data,
and curations to provide a unified, LLM-friendly view of restaurant information.
"""

from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, time
import pytz
import logging

from app.models.llm_models import (
    LLMRestaurantSnapshot,
    LLMRestaurantGeo,
    LLMRestaurantStatus,
    LLMRestaurantOpeningHours,
    LLMRestaurantHoursPeriod,
    LLMRestaurantMichelin,
    LLMRestaurantCuration,
    LLMRestaurantCurationSource,
    LLMRestaurantScores,
    LLMSearchRestaurantItem,
    LLMDayAvailability,
)
from app.core.database import get_database

logger = logging.getLogger(__name__)


class LLMPlaceService:
    """
    Service for consolidating restaurant data from multiple sources
    into LLM-friendly formats.
    """
    
    def __init__(self, database=None):
        """
        Initialize the service with database connection.
        
        Args:
            database: MongoDB database instance (defaults to get_database())
        """
        self.db = database if database is not None else get_database()
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    # =========================================================================
    # SEARCH RESTAURANTS
    # =========================================================================
    
    async def search_restaurants(
        self,
        query: str,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        radius_m: int = 5000,
        max_results: int = 5,
        language: str = "pt-BR",
        region: str = "BR"
    ) -> List[LLMSearchRestaurantItem]:
        """
        Search for restaurants and return LLM-friendly results.
        
        This method:
        1. Searches Google Places using orchestration
        2. Checks if entities exist for each result
        3. Enriches with Michelin data if available
        
        Args:
            query: Restaurant name or search query
            latitude: Optional latitude for location bias
            longitude: Optional longitude for location bias
            radius_m: Search radius in meters
            max_results: Maximum results to return
            language: Language code
            region: Region code
            
        Returns:
            List of LLMSearchRestaurantItem
        """
        results = []
        
        # TODO: Call Places orchestration endpoint
        # For now, search entities by name as fallback
        try:
            entities_cursor = self.db.entities.find({
                "name": {"$regex": query, "$options": "i"}
            }).limit(max_results)
            
            entities = list(entities_cursor)
            
            for entity in entities:
                data = entity.get("data", {})
                
                # Extract place_id
                place_id = (
                    data.get("place_id") or
                    data.get("google_place_id") or
                    entity.get("externalId")
                )
                
                # Extract coordinates
                coords = entity.get("coordinates", [])
                geo = None
                if len(coords) >= 2:
                    geo = LLMRestaurantGeo(
                        lat=coords[1] if isinstance(coords[1], (int, float)) else 0,
                        lng=coords[0] if isinstance(coords[0], (int, float)) else 0,
                        city=entity.get("city"),
                        country=entity.get("country")
                    )
                
                # Check for Michelin data
                michelin_data = data.get("michelin", {})
                has_michelin = bool(michelin_data)
                michelin_info = None
                
                if has_michelin:
                    michelin_info = LLMRestaurantMichelin(
                        has_star=bool(michelin_data.get("stars", 0) > 0),
                        stars=michelin_data.get("stars"),
                        guide_year=michelin_data.get("year"),
                        bib_gourmand=michelin_data.get("bib_gourmand", False),
                        cuisine=michelin_data.get("cuisine"),
                        price=michelin_data.get("price")
                    )
                
                # Extract rating
                rating = data.get("rating") or entity.get("rating")
                
                item = LLMSearchRestaurantItem(
                    place_id=place_id,
                    entity_id=entity.get("_id"),
                    name=entity.get("name", "Unknown"),
                    canonical_address=entity.get("address"),
                    geo=geo,
                    google_rating=rating,
                    has_entity=True,
                    has_michelin_data=has_michelin,
                    michelin=michelin_info
                )
                
                results.append(item)
        
        except Exception as e:
            self.logger.error(f"Error searching restaurants: {e}")
        
        return results
    
    # =========================================================================
    # GET RESTAURANT SNAPSHOT
    # =========================================================================
    
    async def get_restaurant_snapshot(
        self,
        place_id: Optional[str] = None,
        entity_id: Optional[str] = None,
        include_google_places: bool = True,
        include_michelin: bool = True,
        include_curations: bool = True,
        include_raw_sources: bool = False,
        reference_datetime_iso: Optional[str] = None,
        timezone: str = "America/Sao_Paulo"
    ) -> Tuple[LLMRestaurantSnapshot, List[str]]:
        """
        Get complete restaurant snapshot from all sources.
        
        Args:
            place_id: Google Place ID
            entity_id: Internal entity ID
            include_google_places: Whether to include Google Places data
            include_michelin: Whether to include Michelin data
            include_curations: Whether to include curation data
            include_raw_sources: Whether to include raw source data
            reference_datetime_iso: Reference datetime for time calculations
            timezone: Timezone for time calculations
            
        Returns:
            Tuple of (snapshot, sources_used)
        """
        sources_used = []
        
        # 1. Resolve entity
        entity = None
        if entity_id:
            entity = self.db.entities.find_one({"_id": entity_id})
            if entity:
                sources_used.append("entity")
        elif place_id:
            # Try to find entity by place_id
            entity = self.db.entities.find_one({
                "$or": [
                    {"data.place_id": place_id},
                    {"data.google_place_id": place_id},
                    {"externalId": place_id}
                ]
            })
            if entity:
                sources_used.append("entity")
        
        # Extract place_id from entity if not provided
        if entity and not place_id:
            data = entity.get("data", {})
            place_id = (
                data.get("place_id") or
                data.get("google_place_id") or
                entity.get("externalId")
            )
        
        # 2. Get Google Places data
        google_data = None
        if include_google_places and place_id:
            # TODO: Call Places details API
            # For now, use entity data as fallback
            if entity:
                google_data = entity.get("data", {})
                sources_used.append("google_places")
        
        # 3. Get Michelin data
        michelin_data = None
        if include_michelin and entity:
            michelin_data = entity.get("data", {}).get("michelin", {})
            if michelin_data:
                sources_used.append("michelin")
        
        # 4. Get curations
        curations = []
        if include_curations and entity:
            curations_cursor = self.db.curations.find({"entity_id": entity.get("_id")})
            curations = list(curations_cursor)
            if curations:
                sources_used.append("curations")
        
        # 5. Build opening hours block
        opening_hours_block = None
        status_block = None
        if google_data:
            opening_hours_block, status_block = self.build_opening_hours_block(
                google_data,
                reference_datetime_iso,
                timezone
            )
        
        # 6. Build snapshot
        snapshot = self.build_snapshot(
            entity=entity,
            google_data=google_data,
            michelin_data=michelin_data,
            curations=curations,
            opening_hours_block=opening_hours_block,
            status_block=status_block,
            include_raw=include_raw_sources
        )
        
        return snapshot, sources_used
    
    # =========================================================================
    # GET RESTAURANT AVAILABILITY
    # =========================================================================
    
    async def get_restaurant_availability(
        self,
        place_id: Optional[str] = None,
        entity_id: Optional[str] = None,
        date_iso: Optional[str] = None,
        datetime_iso: Optional[str] = None,
        timezone: str = "America/Sao_Paulo",
        weekend_days: List[str] = ["saturday", "sunday"]
    ) -> Dict[str, Any]:
        """
        Get restaurant availability information.
        
        Args:
            place_id: Google Place ID
            entity_id: Internal entity ID
            date_iso: Date in ISO format
            datetime_iso: Datetime in ISO format
            timezone: Timezone
            weekend_days: Days considered as weekend
            
        Returns:
            Dictionary with availability information
        """
        # Get snapshot to reuse logic
        snapshot, _ = await self.get_restaurant_snapshot(
            place_id=place_id,
            entity_id=entity_id,
            include_google_places=True,
            include_michelin=False,
            include_curations=False,
            reference_datetime_iso=datetime_iso,
            timezone=timezone
        )
        
        # Build availability response
        availability_by_day = {}
        weekend_days_open = []
        open_on_weekend = False
        
        if snapshot.opening_hours and snapshot.opening_hours.regular_hours:
            for day, periods in snapshot.opening_hours.regular_hours.items():
                is_open = len(periods) > 0
                availability_by_day[day] = LLMDayAvailability(
                    is_open=is_open,
                    periods=periods
                )
                
                # Check weekend
                if day in weekend_days and is_open:
                    weekend_days_open.append(day)
                    open_on_weekend = True
        
        # Generate notes
        notes = []
        if open_on_weekend:
            if len(weekend_days_open) == len(weekend_days):
                notes.append(f"Aberto todos os dias do fim de semana ({', '.join(weekend_days_open)})")
            else:
                notes.append(f"Aberto apenas: {', '.join(weekend_days_open)}")
        else:
            notes.append("Fechado aos finais de semana")
        
        return {
            "resolved_entity_id": snapshot.entity_id,
            "resolved_place_id": snapshot.place_id,
            "name": snapshot.name,
            "is_open_now": snapshot.status.is_open_now if snapshot.status else None,
            "open_on_weekend": open_on_weekend,
            "weekend_days_open": weekend_days_open if weekend_days_open else None,
            "availability_by_day": availability_by_day,
            "notes": notes,
            "timezone": timezone
        }
    
    # =========================================================================
    # HELPER METHODS
    # =========================================================================
    
    def build_opening_hours_block(
        self,
        google_data: Dict[str, Any],
        reference_datetime_iso: Optional[str],
        timezone_str: str
    ) -> Tuple[Optional[LLMRestaurantOpeningHours], Optional[LLMRestaurantStatus]]:
        """
        Build opening hours and status blocks from Google Places data.
        
        Args:
            google_data: Google Places data
            reference_datetime_iso: Reference datetime
            timezone_str: Timezone string
            
        Returns:
            Tuple of (opening_hours, status)
        """
        opening_hours = None
        status = None
        
        try:
            # Extract opening hours from Google data
            regular_hours_data = google_data.get("regularOpeningHours") or google_data.get("opening_hours")
            
            if not regular_hours_data:
                return None, None
            
            # Parse regular hours
            regular_hours = {}
            day_names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
            
            periods = regular_hours_data.get("periods", [])
            for period in periods:
                open_info = period.get("open", {})
                close_info = period.get("close", {})
                
                day_index = open_info.get("day")
                if day_index is None:
                    continue
                
                day_name = day_names[day_index] if 0 <= day_index < 7 else None
                if not day_name:
                    continue
                
                if day_name not in regular_hours:
                    regular_hours[day_name] = []
                
                # Format time
                open_hour = open_info.get("hour", 0)
                open_minute = open_info.get("minute", 0)
                close_hour = close_info.get("hour", 0) if close_info else 23
                close_minute = close_info.get("minute", 0) if close_info else 59
                
                period_obj = LLMRestaurantHoursPeriod(
                    open=f"{open_hour:02d}:{open_minute:02d}",
                    close=f"{close_hour:02d}:{close_minute:02d}"
                )
                
                regular_hours[day_name].append(period_obj)
            
            # Ensure all days are present
            for day in day_names:
                if day not in regular_hours:
                    regular_hours[day] = []
            
            opening_hours = LLMRestaurantOpeningHours(
                source="google_places",
                timezone=timezone_str,
                regular_hours=regular_hours,
                notes=[]
            )
            
            # Calculate status
            is_open_now = None
            open_on_weekend = False
            weekend_days_open = []
            
            # Check current opening hours
            current_opening = google_data.get("currentOpeningHours")
            if current_opening:
                is_open_now = current_opening.get("openNow")
            elif "open_now" in google_data:
                is_open_now = google_data.get("open_now")
            
            # Check weekend availability
            weekend_check = ["saturday", "sunday"]
            for day in weekend_check:
                if day in regular_hours and len(regular_hours[day]) > 0:
                    open_on_weekend = True
                    weekend_days_open.append(day)
            
            status = LLMRestaurantStatus(
                is_open_now=is_open_now,
                open_on_weekend=open_on_weekend,
                weekend_days_open=weekend_days_open if weekend_days_open else None,
                supports_reservation=google_data.get("reservable"),
                business_status=google_data.get("businessStatus")
            )
            
        except Exception as e:
            self.logger.error(f"Error building opening hours: {e}")
        
        return opening_hours, status
    
    def build_snapshot(
        self,
        entity: Optional[Dict[str, Any]],
        google_data: Optional[Dict[str, Any]],
        michelin_data: Optional[Dict[str, Any]],
        curations: List[Dict[str, Any]],
        opening_hours_block: Optional[LLMRestaurantOpeningHours],
        status_block: Optional[LLMRestaurantStatus],
        include_raw: bool = False
    ) -> LLMRestaurantSnapshot:
        """
        Build complete restaurant snapshot from all sources.
        
        Args:
            entity: Entity data from MongoDB
            google_data: Google Places data
            michelin_data: Michelin guide data
            curations: List of curations
            opening_hours_block: Processed opening hours
            status_block: Processed status
            include_raw: Whether to include raw source data
            
        Returns:
            LLMRestaurantSnapshot
        """
        # Extract basic info
        name = "Unknown"
        if entity:
            name = entity.get("name", "Unknown")
        elif google_data:
            display_name = google_data.get("displayName", {})
            name = display_name.get("text") if isinstance(display_name, dict) else google_data.get("name", "Unknown")
        
        # Extract IDs
        entity_id = entity.get("_id") if entity else None
        
        place_id = None
        if google_data:
            place_id = google_data.get("id") or google_data.get("place_id")
        elif entity:
            data = entity.get("data", {})
            place_id = data.get("place_id") or data.get("google_place_id") or entity.get("externalId")
        
        # Build geo
        geo = None
        if entity:
            coords = entity.get("coordinates", [])
            if len(coords) >= 2:
                geo = LLMRestaurantGeo(
                    lat=coords[1] if isinstance(coords[1], (int, float)) else 0,
                    lng=coords[0] if isinstance(coords[0], (int, float)) else 0,
                    city=entity.get("city"),
                    country=entity.get("country")
                )
        elif google_data and "location" in google_data:
            location = google_data["location"]
            geo = LLMRestaurantGeo(
                lat=location.get("latitude", 0),
                lng=location.get("longitude", 0)
            )
        
        # Build Michelin block
        michelin_block = None
        if michelin_data:
            michelin_block = LLMRestaurantMichelin(
                has_star=bool(michelin_data.get("stars", 0) > 0),
                stars=michelin_data.get("stars"),
                guide_year=michelin_data.get("year"),
                bib_gourmand=michelin_data.get("bib_gourmand", False),
                comment=michelin_data.get("comment") or michelin_data.get("review"),
                cuisine=michelin_data.get("cuisine"),
                price=michelin_data.get("price")
            )
        
        # Build curation block
        curation_block = None
        if curations:
            all_tags = []
            all_highlights = []
            sources = []
            
            for curation in curations:
                data = curation.get("data", {})
                
                # Extract tags
                tags = data.get("tags", [])
                if isinstance(tags, list):
                    all_tags.extend(tags)
                
                # Extract highlights
                highlights = data.get("highlights", [])
                if isinstance(highlights, list):
                    all_highlights.extend(highlights)
                
                # Extract curator info
                curator_id = curation.get("curator_id")
                if curator_id:
                    sources.append(LLMRestaurantCurationSource(
                        curator_id=curator_id,
                        strength=data.get("strength")
                    ))
            
            curation_block = LLMRestaurantCuration(
                tags=list(set(all_tags)) if all_tags else None,
                highlights=list(set(all_highlights)) if all_highlights else None,
                sources=sources if sources else None
            )
        
        # Build scores
        scores = None
        rating = None
        reviews_count = None
        
        if google_data:
            rating = google_data.get("rating")
            reviews_count = google_data.get("userRatingCount") or google_data.get("user_ratings_total")
        elif entity:
            data = entity.get("data", {})
            rating = data.get("rating") or entity.get("rating")
            reviews_count = data.get("user_ratings_total")
        
        if rating or reviews_count:
            scores = LLMRestaurantScores(
                google_rating=rating,
                google_reviews_count=reviews_count
            )
        
        # Extract contact info
        phone = None
        website = None
        address = None
        
        if google_data:
            phone = google_data.get("nationalPhoneNumber") or google_data.get("formatted_phone_number")
            website = google_data.get("websiteUri") or google_data.get("website")
            address = google_data.get("formattedAddress") or google_data.get("formatted_address")
        elif entity:
            data = entity.get("data", {})
            phone = data.get("phone") or data.get("formatted_phone_number")
            website = data.get("website")
            address = entity.get("address")
        
        # Extract types
        types = None
        if google_data:
            types = google_data.get("types", [])
        elif entity:
            types = entity.get("data", {}).get("types", [])
        
        # Price level
        price_level = None
        if google_data:
            price_level = google_data.get("priceLevel")
        
        # Build raw sources if requested
        raw_sources = None
        if include_raw:
            raw_sources = {
                "google_places": google_data,
                "michelin": michelin_data,
                "curations": curations,
                "entity": entity
            }
        
        return LLMRestaurantSnapshot(
            entity_id=entity_id,
            place_id=place_id,
            external_refs={
                "google_place_id": place_id,
                "michelin_id": michelin_data.get("id") if michelin_data else None
            } if place_id or michelin_data else None,
            name=name,
            canonical_address=address,
            geo=geo,
            status=status_block,
            opening_hours=opening_hours_block,
            michelin=michelin_block,
            curation=curation_block,
            scores=scores,
            phone=phone,
            website=website,
            types=types,
            price_level=price_level,
            raw_sources=raw_sources
        )
