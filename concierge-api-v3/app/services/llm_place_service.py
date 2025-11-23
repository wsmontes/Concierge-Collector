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
import threading

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
from app.core.config import settings
import httpx

logger = logging.getLogger(__name__)

# Google Places API URLs
PLACES_API_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
PLACES_API_DETAILS_URL = "https://places.googleapis.com/v1/places"


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
    # HELPER METHODS - PLACES API INTEGRATION
    # =========================================================================
    
    def fetch_google_place_details(self, place_id: str, language: str = "pt-BR", region: str = "BR") -> Optional[Dict[str, Any]]:
        """
        Fetch place details from Google Places API directly.
        
        Args:
            place_id: Google Place ID
            language: Language code
            region: Region code
            
        Returns:
            Place details dictionary or None if failed
        """
        try:
            headers = {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": settings.google_places_api_key,
                "X-Goog-FieldMask": "id,displayName,formattedAddress,location,rating,types,priceLevel,nationalPhoneNumber,websiteUri,regularOpeningHours"
            }
            
            params = {}
            if language:
                params["languageCode"] = language
            if region:
                params["regionCode"] = region
            
            with httpx.Client(timeout=30.0) as client:
                response = client.get(
                    f"{PLACES_API_DETAILS_URL}/{place_id}",
                    headers=headers,
                    params=params
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    self.logger.warning(f"Places API returned {response.status_code} for place_id={place_id}")
                    
        except Exception as e:
            self.logger.error(f"Failed to fetch Google place details for {place_id}: {e}")
        
        return None
    
    def search_google_places(
        self,
        query: str,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        radius_m: int = 5000,
        max_results: int = 5,
        language: str = "pt-BR",
        region: str = "BR"
    ) -> List[Dict[str, Any]]:
        """
        Search Google Places API directly.
        
        Args:
            query: Search query
            latitude: Optional latitude
            longitude: Optional longitude
            radius_m: Search radius in meters
            max_results: Max results
            language: Language code
            region: Region code
            
        Returns:
            List of place dictionaries
        """
        try:
            headers = {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": settings.google_places_api_key,
                "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.priceLevel"
            }
            
            body = {
                "textQuery": query,
                "pageSize": min(max_results, 20),
                "languageCode": language
            }
            
            # Add location bias if coordinates provided
            if latitude is not None and longitude is not None:
                body["locationBias"] = {
                    "circle": {
                        "center": {
                            "latitude": latitude,
                            "longitude": longitude
                        },
                        "radius": radius_m
                    }
                }
            
            if region:
                body["regionCode"] = region
            
            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    PLACES_API_TEXT_SEARCH_URL,
                    headers=headers,
                    json=body
                )
                
                if response.status_code == 200:
                    data = response.json()
                    return data.get("places", [])
                else:
                    self.logger.warning(f"Places API search returned {response.status_code}: {response.text}")
                    
        except Exception as e:
            self.logger.error(f"Failed to search Google Places: {e}")
        
        return []
    
    def create_entity_from_google_data(self, google_data: Dict[str, Any]) -> Optional[str]:
        """
        Create a new entity from Google Places data.
        Includes duplicate prevention.
        
        Args:
            google_data: Google Places data dictionary
            
        Returns:
            Entity ID if created, None if duplicate or failed
        """
        try:
            place_id = google_data.get("id")
            if not place_id:
                self.logger.warning("Cannot create entity: missing place_id")
                return None
            
            # Check for duplicates
            existing = self.db.entities.find_one({
                "$or": [
                    {"externalId": place_id},
                    {"data.place_id": place_id},
                    {"data.google_place_id": place_id}
                ]
            })
            
            if existing:
                self.logger.debug(f"Entity already exists for place_id={place_id}")
                return existing.get("_id")
            
            # Extract name
            name = google_data.get("displayName", {})
            if isinstance(name, dict):
                name = name.get("text", "Unknown")
            elif not name:
                name = "Unknown"
            
            # Extract location
            location = google_data.get("location", {})
            coordinates = []
            if location.get("longitude") and location.get("latitude"):
                coordinates = [location["longitude"], location["latitude"]]
            
            # Build entity document
            now = datetime.utcnow()
            entity_doc = {
                "name": name,
                "externalId": place_id,
                "coordinates": coordinates,
                "location": {
                    "type": "Point",
                    "coordinates": coordinates
                } if coordinates else None,
                "address": google_data.get("formattedAddress"),
                "data": {
                    "place_id": place_id,
                    "google_place_id": place_id,
                    "google_name": name,
                    "formatted_address": google_data.get("formattedAddress"),
                    "location": location,
                    "rating": google_data.get("rating"),
                    "google_rating": google_data.get("rating"),
                    "types": google_data.get("types", []),
                    "priceLevel": google_data.get("priceLevel"),
                    "google_last_updated": now.isoformat(),
                    "auto_created": True,
                    "source": "google_places_api"
                },
                "createdAt": now,
                "updatedAt": now
            }
            
            # Insert entity
            result = self.db.entities.insert_one(entity_doc)
            entity_id = result.inserted_id
            
            self.logger.info(f"Created new entity {entity_id} for place_id={place_id} ({name})")
            return entity_id
            
        except Exception as e:
            self.logger.error(f"Failed to create entity from Google data: {e}", exc_info=True)
            return None
    
    def create_entity_in_background(self, google_data: Dict[str, Any]):
        """
        Create entity in background thread without blocking response.
        
        Args:
            google_data: Google Places data dictionary
        """
        def _create():
            try:
                self.create_entity_from_google_data(google_data)
            except Exception as e:
                self.logger.error(f"Background entity creation failed: {e}")
        
        thread = threading.Thread(target=_create, daemon=True)
        thread.start()
    
    def update_entity_with_google_data(self, entity_id: str, google_data: Dict[str, Any], force_update: bool = False) -> bool:
        """
        Update entity with Google Places data incrementally.
        Only updates fields that are missing or force_update=True.
        
        Args:
            entity_id: Entity ID
            google_data: Google Places data dictionary
            force_update: If True, updates all fields regardless
            
        Returns:
            True if update succeeded
        """
        try:
            # Get current entity to check existing fields
            entity = self.db.entities.find_one({"_id": entity_id})
            if not entity:
                self.logger.warning(f"Entity {entity_id} not found")
                return False
            
            entity_data = entity.get("data", {})
            
            self.logger.info(f"Updating entity {entity_id} with Google Places data (force={force_update})")
            
            # Extract key fields from Google data
            update_fields = {}
            
            # Core fields - only update if missing or force
            if google_data.get("id") and (force_update or not entity_data.get("place_id")):
                update_fields["data.place_id"] = google_data["id"]
                update_fields["externalId"] = google_data["id"]
            
            if google_data.get("displayName", {}).get("text") and (force_update or not entity_data.get("google_name")):
                update_fields["data.google_name"] = google_data["displayName"]["text"]
            
            if google_data.get("formattedAddress") and (force_update or not entity_data.get("formatted_address")):
                update_fields["data.formatted_address"] = google_data["formattedAddress"]
            
            # Location - only update if missing or force
            if google_data.get("location"):
                loc = google_data["location"]
                if force_update or not entity_data.get("location"):
                    update_fields["data.location"] = loc
                    if loc.get("latitude") and loc.get("longitude"):
                        update_fields["location"] = {
                            "type": "Point",
                            "coordinates": [loc["longitude"], loc["latitude"]]
                        }
            
            # Rating - always update (can change)
            if google_data.get("rating") is not None:
                update_fields["data.google_rating"] = google_data["rating"]
            
            # Opening hours - always update (can change)
            if google_data.get("regularOpeningHours"):
                update_fields["data.opening_hours"] = google_data["regularOpeningHours"]
            
            # Types - only if missing
            if google_data.get("types") and (force_update or not entity_data.get("types")):
                update_fields["data.types"] = google_data["types"]
            
            # Contact info - only if missing
            if google_data.get("nationalPhoneNumber") and (force_update or not entity_data.get("phone")):
                update_fields["data.phone"] = google_data["nationalPhoneNumber"]
            
            if google_data.get("websiteUri") and (force_update or not entity_data.get("website")):
                update_fields["data.website"] = google_data["websiteUri"]
            
            # Price level - only if missing
            if google_data.get("priceLevel") and (force_update or not entity_data.get("priceLevel")):
                update_fields["data.priceLevel"] = google_data["priceLevel"]
            
            # Always update timestamp
            update_fields["data.google_last_updated"] = datetime.utcnow().isoformat()
            update_fields["updatedAt"] = datetime.utcnow()
            
            # Perform update only if there are fields to update
            if update_fields:
                result = self.db.entities.update_one(
                    {"_id": entity_id},
                    {"$set": update_fields}
                )
                
                if result.modified_count > 0:
                    self.logger.info(f"Updated {len(update_fields)} fields in entity {entity_id}")
                    return True
                else:
                    self.logger.debug(f"No changes needed for entity {entity_id}")
                    return True
            else:
                self.logger.debug(f"All fields up to date for entity {entity_id}")
                return True
                
        except Exception as e:
            self.logger.error(f"Failed to update entity {entity_id} with Google data: {e}")
            return False
    
    # =========================================================================
    # SEARCH RESTAURANTS
    # =========================================================================
    
    def search_restaurants(
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
        4. Updates entities with fresh Google data
        
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
        
        # 1. Search Google Places API
        google_places = self.search_google_places(
            query=query,
            latitude=latitude,
            longitude=longitude,
            radius_m=radius_m,
            max_results=max_results,
            language=language,
            region=region
        )
        
        # 2. Process each Google result
        for google_place in google_places:
            place_id = google_place.get("id")
            if not place_id:
                continue
            
            # Extract name
            name = google_place.get("displayName", {})
            if isinstance(name, dict):
                name = name.get("text", "Unknown")
            elif not name:
                name = "Unknown"
            
            # Extract coordinates
            location = google_place.get("location", {})
            geo = None
            if location.get("latitude") and location.get("longitude"):
                geo = LLMRestaurantGeo(
                    lat=location["latitude"],
                    lng=location["longitude"]
                )
            
            # Extract address
            address = google_place.get("formattedAddress")
            
            # Extract rating
            rating = google_place.get("rating")
            
            # 3. Check if entity exists for this place_id
            entity = self.db.entities.find_one({
                "$or": [
                    {"externalId": place_id},
                    {"data.place_id": place_id},
                    {"data.google_place_id": place_id}
                ]
            })
            
            entity_id = None
            has_michelin = False
            michelin_info = None
            
            if entity:
                entity_id = entity.get("_id")
                
                # Update entity with fresh Google data (incremental)
                self.update_entity_with_google_data(entity_id, google_place)
                
                # Check for Michelin data
                michelin_data = entity.get("data", {}).get("michelin", {})
                has_michelin = bool(michelin_data)
                
                if has_michelin:
                    michelin_info = LLMRestaurantMichelin(
                        has_star=bool(michelin_data.get("stars", 0) > 0),
                        stars=michelin_data.get("stars"),
                        guide_year=michelin_data.get("year"),
                        bib_gourmand=michelin_data.get("bib_gourmand", False),
                        cuisine=michelin_data.get("cuisine"),
                        price=michelin_data.get("price")
                    )
            else:
                # Entity doesn't exist - create in background
                self.logger.info(f"Creating entity in background for new place_id={place_id}")
                self.create_entity_in_background(google_place)
            
            # 4. Build search result item
            results.append(LLMSearchRestaurantItem(
                place_id=place_id,
                entity_id=entity_id,
                name=name,
                canonical_address=address,
                geo=geo,
                google_rating=rating,
                has_entity=entity is not None,
                has_michelin_data=has_michelin,
                michelin=michelin_info
            ))
        
        # 5. If no Google results, fallback to entity search
        if not results:
            self.logger.info(f"No Google Places results for query='{query}', falling back to entity search")
            
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
        
        return results
    
    # =========================================================================
    # GET RESTAURANT SNAPSHOT
    # =========================================================================
    
    def get_restaurant_snapshot(
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
        
        # 1. Resolve entity - PRIORITY: Check entity first
        entity = None
        if entity_id:
            entity = self.db.entities.find_one({"_id": entity_id})
            if entity:
                sources_used.append("entity")
                self.logger.debug(f"Found entity by entity_id={entity_id}")
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
                self.logger.debug(f"Found entity by place_id={place_id}")
        
        # Extract place_id from entity if not provided
        if entity and not place_id:
            data = entity.get("data", {})
            place_id = (
                data.get("place_id") or
                data.get("google_place_id") or
                entity.get("externalId")
            )
        
        # 2. Get Google Places data only if needed
        google_data = None
        entity_data = entity.get("data", {}) if entity else {}
        
        # Check if we need to fetch from Google Places
        needs_google_fetch = False
        if include_google_places and place_id:
            # Check if entity is missing critical fields
            if not entity:
                needs_google_fetch = True
                self.logger.info(f"Entity not found for place_id={place_id}, fetching from Google")
            elif not entity_data.get("opening_hours"):
                needs_google_fetch = True
                self.logger.info(f"Entity missing opening_hours, fetching from Google")
            elif not entity_data.get("google_rating"):
                needs_google_fetch = True
                self.logger.info(f"Entity missing rating, fetching from Google")
            else:
                # Use entity data
                google_data = entity_data
                sources_used.append("google_places")
                self.logger.debug(f"Using entity data for place_id={place_id}")
        
        # Fetch from Google if needed
        if needs_google_fetch and place_id:
            google_data = self.fetch_google_place_details(
                place_id=place_id,
                language="pt-BR",
                region="BR"
            )
            
            if google_data:
                sources_used.append("google_places")
                
                # Update or create entity
                if entity:
                    # Update existing entity with fresh data
                    self.update_entity_with_google_data(entity.get("_id"), google_data)
                else:
                    # Create new entity in background
                    self.logger.info(f"Creating entity for place_id={place_id}")
                    new_entity_id = self.create_entity_from_google_data(google_data)
                    if new_entity_id:
                        # Reload entity for use in this response
                        entity = self.db.entities.find_one({"_id": new_entity_id})
                        sources_used.append("entity")
            elif entity:
                # Fallback to entity data if Google API fails
                google_data = entity.get("data", {})
                sources_used.append("google_places")
                self.logger.warning(f"Using entity data as fallback for place_id={place_id}")
        
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
    
    def get_restaurant_availability(
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
        snapshot, _ = self.get_restaurant_snapshot(
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
                
                # Convert periods to dict for JSON serialization
                periods_dict = [p.dict() if hasattr(p, 'dict') else p for p in periods]
                
                availability_by_day[day] = {
                    "is_open": is_open,
                    "periods": periods_dict
                }
                
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
