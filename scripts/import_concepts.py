#!/usr/bin/env python3
"""
File: import_concepts.py
Purpose: Interactive script to import restaurant concepts from JSON using API v3
Dependencies: requests, python-dotenv (use concierge-api-v3/venv)
Last Updated: November 23, 2025

Interactive CLI tool that:
1. Loads concepts from data/restaurants - 2025-10-15.json
2. Searches for matching entities via API v3
3. Presents options for user approval
4. Updates entities via API v3 with approved concept mappings

Usage:
  cd concierge-api-v3
  source venv/bin/activate
  cd ../scripts
  python import_concepts.py
"""

import json
import os
import sys
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timezone
import re

import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '..', 'concierge-api-v3', '.env'))

# Configuration
API_BASE_URL = os.getenv('API_V3_URL', 'http://localhost:8000')
GOOGLE_PLACES_API_KEY = os.getenv('GOOGLE_PLACES_API_KEY')
CONCEPTS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'restaurants - 2025-10-15.json')

# API Endpoints
API_ENTITIES_URL = f"{API_BASE_URL}/api/v3/entities"
API_PLACES_URL = f"{API_BASE_URL}/api/v3/places"

# Google Places API endpoint
PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

# Colors for terminal output
class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'


def normalize_name(name: str) -> str:
    """Normalize restaurant name for comparison"""
    # Remove special chars, lowercase, remove extra spaces
    normalized = re.sub(r'[^\w\s]', '', name.lower())
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    return normalized


def search_mongodb_entities(db, restaurant_name: str) -> List[Dict]:
    """Search for entities in MongoDB by name similarity"""
    normalized = normalize_name(restaurant_name)
    
    # Try exact match first
    results = list(db.entities.find({
        "$or": [
            {"name": {"$regex": f"^{re.escape(restaurant_name)}$", "$options": "i"}},
            {"data.name": {"$regex": f"^{re.escape(restaurant_name)}$", "$options": "i"}},
        ]
    }).limit(5))
    
    if results:
        return results
    
    # Try partial match
    search_terms = normalized.split()
    if search_terms:
        regex_pattern = ".*".join([re.escape(term) for term in search_terms])
        results = list(db.entities.find({
            "$or": [
                {"name": {"$regex": regex_pattern, "$options": "i"}},
                {"data.name": {"$regex": regex_pattern, "$options": "i"}},
            ]
        }).limit(5))
    
    return results


def search_google_places(restaurant_name: str) -> List[Dict]:
    """Search Google Places API for restaurant"""
    try:
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount"
        }
        
        payload = {
            "textQuery": f"{restaurant_name} São Paulo restaurant",
            "languageCode": "pt-BR",
            "regionCode": "BR",
            "maxResultCount": 5
        }
        
        response = requests.post(PLACES_TEXT_SEARCH_URL, json=payload, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            places = data.get("places", [])
            
            # Convert to simplified format
            results = []
            for place in places:
                results.append({
                    "place_id": place.get("id", "").replace("places/", ""),
                    "name": place.get("displayName", {}).get("text", ""),
                    "address": place.get("formattedAddress", ""),
                    "rating": place.get("rating"),
                    "rating_count": place.get("userRatingCount")
                })
            return results
        
    except Exception as e:
        print(f"{Colors.WARNING}Google Places search error: {e}{Colors.ENDC}")
    
    return []


def display_concepts(concepts: Dict) -> None:
    """Display restaurant concepts in a readable format"""
    print(f"\n{Colors.OKCYAN}Concepts:{Colors.ENDC}")
    for category, values in concepts.items():
        if values:
            print(f"  {Colors.BOLD}{category}:{Colors.ENDC} {', '.join(values[:5])}" + 
                  (f" (+{len(values)-5} more)" if len(values) > 5 else ""))


def display_candidate(idx: int, candidate: Dict, source: str) -> None:
    """Display a candidate entity or place"""
    print(f"\n{Colors.OKBLUE}[{idx}] {source}{Colors.ENDC}")
    
    if source == "MongoDB Entity":
        entity_id = candidate.get("_id", "")
        name = candidate.get("name") or candidate.get("data", {}).get("name", "N/A")
        place_id = candidate.get("data", {}).get("place_id") or candidate.get("externalId", "N/A")
        address = candidate.get("data", {}).get("formatted_address", "N/A")
        
        print(f"  Entity ID: {entity_id}")
        print(f"  Name: {name}")
        print(f"  Place ID: {place_id}")
        print(f"  Address: {address}")
        
        # Show if already has concepts
        if candidate.get("concepts"):
            print(f"  {Colors.WARNING}⚠️  Already has concepts{Colors.ENDC}")
    
    else:  # Google Places
        print(f"  Place ID: {candidate.get('place_id', 'N/A')}")
        print(f"  Name: {candidate.get('name', 'N/A')}")
        print(f"  Address: {candidate.get('address', 'N/A')}")
        rating = candidate.get('rating')
        rating_count = candidate.get('rating_count')
        if rating:
            print(f"  Rating: {rating} ⭐ ({rating_count} reviews)")


def create_entity_from_place_id(db, place_id: str, concepts: Dict) -> Optional[str]:
    """Create a new entity from place_id with concepts"""
    try:
        # Fetch place details from Google Places
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask": "id,displayName,formattedAddress,location,rating,userRatingCount,types"
        }
        
        url = f"https://places.googleapis.com/v1/places/{place_id}"
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code != 200:
            error_msg = f"Failed to fetch place details: {response.status_code}"
            try:
                error_data = response.json()
                if "error" in error_data:
                    error_msg += f" - {error_data['error'].get('message', '')}"
            except:
                error_msg += f" - {response.text[:200]}"
            print(f"{Colors.FAIL}{error_msg}{Colors.ENDC}")
            return None
        
        place_data = response.json()
        
        # Generate entity_id using Google Place ID
        entity_id = f"entity_{place_id}"
        
        # Create entity document following the schema
        entity = {
            "_id": entity_id,
            "entity_id": entity_id,
            "name": place_data.get("displayName", {}).get("text", "Unknown"),
            "type": "restaurant",
            "status": "active",
            "externalId": place_id,
            "metadata": [],
            "data": {
                "place_id": place_id,
                "name": place_data.get("displayName", {}).get("text", "Unknown"),
                "formatted_address": place_data.get("formattedAddress", ""),
                "location": place_data.get("location", {}),
                "rating": place_data.get("rating"),
                "user_ratings_total": place_data.get("userRatingCount"),
                "types": place_data.get("types", [])
            },
            "concepts": concepts,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
            "version": 1
        }
        
        # Insert with retry and proper error handling
        for attempt in range(3):
            try:
                result = db.entities.insert_one(entity)
                return str(result.inserted_id)
            except DuplicateKeyError:
                print(f"{Colors.WARNING}Entity already exists with ID: {entity_id}{Colors.ENDC}")
                return None
            except (ConnectionFailure, ServerSelectionTimeoutError) as conn_error:
                if attempt < 2:
                    print(f"{Colors.WARNING}Connection issue, retry {attempt + 1}/3...{Colors.ENDC}")
                    continue
                raise conn_error
        
    except Exception as e:
        print(f"{Colors.FAIL}Error creating entity: {e}{Colors.ENDC}")
        return None


def update_entity_concepts(db, entity_id: str, concepts: Dict) -> bool:
    """Update entity with concepts"""
    try:
        update_doc = {
            "$set": {
                "concepts": concepts,
                "updatedAt": datetime.now(timezone.utc)
            }
        }
        
        # Update with retry and proper error handling
        for attempt in range(3):
            try:
                result = db.entities.update_one({"_id": entity_id}, update_doc)
                return result.modified_count > 0 or result.matched_count > 0
            except (ConnectionFailure, ServerSelectionTimeoutError) as conn_error:
                if attempt < 2:
                    print(f"{Colors.WARNING}Connection issue, retry {attempt + 1}/3...{Colors.ENDC}")
                    continue
                raise conn_error
        
        return False
        
    except Exception as e:
        print(f"{Colors.FAIL}Error updating entity: {e}{Colors.ENDC}")
        return False


def process_restaurant(db, restaurant_name: str, concepts: Dict, stats: Dict) -> None:
    """Process a single restaurant - interactive approval flow"""
    print(f"\n{'='*80}")
    print(f"{Colors.HEADER}{Colors.BOLD}Restaurant: {restaurant_name.upper()}{Colors.ENDC}")
    print(f"{'='*80}")
    
    # Display concepts
    display_concepts(concepts)
    
    # Search MongoDB
    print(f"\n{Colors.OKCYAN}Searching MongoDB...{Colors.ENDC}")
    mongo_results = search_mongodb_entities(db, restaurant_name)
    
    # Search Google Places
    print(f"{Colors.OKCYAN}Searching Google Places...{Colors.ENDC}")
    google_results = search_google_places(restaurant_name)
    
    # Display all candidates
    candidates = []
    idx = 1
    
    for entity in mongo_results:
        display_candidate(idx, entity, "MongoDB Entity")
        candidates.append(("mongo", entity))
        idx += 1
    
    for place in google_results:
        display_candidate(idx, place, "Google Places")
        candidates.append(("google", place))
        idx += 1
    
    if not candidates:
        print(f"\n{Colors.WARNING}No candidates found{Colors.ENDC}")
    
    # Get user choice
    print(f"\n{Colors.BOLD}Options:{Colors.ENDC}")
    if candidates:
        print(f"  [1-{len(candidates)}] Select candidate")
    print(f"  [m] Manual place_id entry")
    print(f"  [d] Delete and recreate (if exists)")
    print(f"  [s] Skip this restaurant")
    print(f"  [q] Quit")
    
    while True:
        choice = input(f"\n{Colors.BOLD}Your choice: {Colors.ENDC}").strip().lower()
        
        if choice == 'q':
            print(f"\n{Colors.WARNING}Exiting...{Colors.ENDC}")
            sys.exit(0)
        
        elif choice == 's':
            print(f"{Colors.WARNING}Skipped{Colors.ENDC}")
            stats['skipped'] += 1
            return
        
        elif choice == 'd':
            # Delete and recreate
            place_id = input(f"{Colors.BOLD}Enter place_id to delete and recreate: {Colors.ENDC}").strip()
            if not place_id:
                print(f"{Colors.FAIL}No place_id provided{Colors.ENDC}")
                return
            
            entity_id = f"entity_{place_id}"
            
            # Try to delete existing
            try:
                delete_result = db.entities.delete_one({"_id": entity_id})
                if delete_result.deleted_count > 0:
                    print(f"{Colors.OKGREEN}✓ Deleted existing entity{Colors.ENDC}")
                else:
                    print(f"{Colors.WARNING}No existing entity found{Colors.ENDC}")
            except Exception as e:
                print(f"{Colors.FAIL}Error deleting: {e}{Colors.ENDC}")
            
            # Create new
            print(f"{Colors.OKCYAN}Creating new entity...{Colors.ENDC}")
            entity_id = create_entity_from_place_id(db, place_id, concepts)
            if entity_id:
                print(f"{Colors.OKGREEN}✓ Created entity: {entity_id}{Colors.ENDC}")
                stats['created'] += 1
            else:
                print(f"{Colors.FAIL}✗ Failed to create entity{Colors.ENDC}")
                stats['failed'] += 1
            return
        
        elif choice == 'm':
            place_id = input(f"{Colors.BOLD}Enter place_id: {Colors.ENDC}").strip()
            if place_id:
                print(f"{Colors.OKCYAN}Creating new entity...{Colors.ENDC}")
                entity_id = create_entity_from_place_id(db, place_id, concepts)
                if entity_id:
                    print(f"{Colors.OKGREEN}✓ Created entity: {entity_id}{Colors.ENDC}")
                    stats['created'] += 1
                else:
                    print(f"{Colors.FAIL}✗ Failed to create entity{Colors.ENDC}")
                    stats['failed'] += 1
            return
        
        elif choice.isdigit():
            idx = int(choice)
            if 1 <= idx <= len(candidates):
                source_type, candidate = candidates[idx - 1]
                
                if source_type == "mongo":
                    # Update existing entity
                    entity_id = candidate.get("_id")
                    print(f"{Colors.OKCYAN}Updating entity {entity_id}...{Colors.ENDC}")
                    
                    if update_entity_concepts(db, entity_id, concepts):
                        print(f"{Colors.OKGREEN}✓ Updated entity{Colors.ENDC}")
                        stats['updated'] += 1
                    else:
                        print(f"{Colors.FAIL}✗ Failed to update entity{Colors.ENDC}")
                        stats['failed'] += 1
                
                else:  # google
                    # Create new entity from Google place
                    place_id = candidate.get("place_id")
                    print(f"{Colors.OKCYAN}Creating new entity from place_id {place_id}...{Colors.ENDC}")
                    
                    entity_id = create_entity_from_place_id(db, place_id, concepts)
                    if entity_id:
                        print(f"{Colors.OKGREEN}✓ Created entity: {entity_id}{Colors.ENDC}")
                        stats['created'] += 1
                    else:
                        print(f"{Colors.FAIL}✗ Failed to create entity{Colors.ENDC}")
                        stats['failed'] += 1
                
                return
        
        print(f"{Colors.FAIL}Invalid choice. Try again.{Colors.ENDC}")


def main():
    """Main script execution"""
    print(f"{Colors.HEADER}{Colors.BOLD}")
    print("="*80)
    print("Restaurant Concepts Import Tool")
    print("="*80)
    print(f"{Colors.ENDC}")
    
    # Validate configuration
    if not MONGODB_URL:
        print(f"{Colors.FAIL}Error: MONGODB_URL not configured{Colors.ENDC}")
        sys.exit(1)
    
    if not GOOGLE_PLACES_API_KEY:
        print(f"{Colors.FAIL}Error: GOOGLE_PLACES_API_KEY not configured{Colors.ENDC}")
        sys.exit(1)
    
    if not os.path.exists(CONCEPTS_FILE):
        print(f"{Colors.FAIL}Error: Concepts file not found: {CONCEPTS_FILE}{Colors.ENDC}")
        sys.exit(1)
    
    # Load concepts
    print(f"{Colors.OKCYAN}Loading concepts from: {CONCEPTS_FILE}{Colors.ENDC}")
    with open(CONCEPTS_FILE, 'r', encoding='utf-8') as f:
        all_concepts = json.load(f)
    
    print(f"{Colors.OKGREEN}Loaded {len(all_concepts)} restaurants{Colors.ENDC}")
    
    # Connect to MongoDB
    print(f"{Colors.OKCYAN}Connecting to MongoDB...{Colors.ENDC}")
    client = MongoClient(
        MONGODB_URL,
        serverSelectionTimeoutMS=30000,  # 30 seconds
        connectTimeoutMS=30000,
        socketTimeoutMS=30000
    )
    db = client[MONGODB_DB_NAME]
    print(f"{Colors.OKGREEN}Connected to database: {MONGODB_DB_NAME}{Colors.ENDC}")
    
    # Statistics
    stats = {
        'total': len(all_concepts),
        'updated': 0,
        'created': 0,
        'skipped': 0,
        'failed': 0
    }
    
    # Process each restaurant
    for idx, (restaurant_name, concepts) in enumerate(all_concepts.items(), 1):
        # Skip empty concepts
        if not any(concepts.values()):
            print(f"\n{Colors.WARNING}Skipping {restaurant_name} (empty concepts){Colors.ENDC}")
            stats['skipped'] += 1
            continue
        
        print(f"\n{Colors.BOLD}Progress: {idx}/{stats['total']}{Colors.ENDC}")
        
        try:
            process_restaurant(db, restaurant_name, concepts, stats)
        except KeyboardInterrupt:
            print(f"\n\n{Colors.WARNING}Interrupted by user{Colors.ENDC}")
            break
        except Exception as e:
            print(f"\n{Colors.FAIL}Error processing {restaurant_name}: {e}{Colors.ENDC}")
            stats['failed'] += 1
    
    # Final statistics
    print(f"\n{Colors.HEADER}{Colors.BOLD}")
    print("="*80)
    print("Import Summary")
    print("="*80)
    print(f"{Colors.ENDC}")
    print(f"Total restaurants: {stats['total']}")
    print(f"{Colors.OKGREEN}Updated: {stats['updated']}{Colors.ENDC}")
    print(f"{Colors.OKGREEN}Created: {stats['created']}{Colors.ENDC}")
    print(f"{Colors.WARNING}Skipped: {stats['skipped']}{Colors.ENDC}")
    print(f"{Colors.FAIL}Failed: {stats['failed']}{Colors.ENDC}")
    
    client.close()


if __name__ == "__main__":
    main()
