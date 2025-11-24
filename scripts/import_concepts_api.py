#!/usr/bin/env python3
"""
File: import_concepts_api.py
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
  python import_concepts_api.py
"""

import json
import os
import sys
from typing import Dict, List, Optional, Tuple
import re

import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '..', 'concierge-api-v3', '.env'))

# Configuration - Force production API
API_BASE_URL = 'https://concierge-collector.onrender.com'
API_SECRET_KEY = os.getenv('API_SECRET_KEY')
GOOGLE_PLACES_API_KEY = os.getenv('GOOGLE_PLACES_API_KEY')
CONCEPTS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'restaurants - 2025-10-15.json')

# Debug
if not API_SECRET_KEY:
    print(f"WARNING: API_SECRET_KEY not loaded from .env file")
else:
    print(f"API_SECRET_KEY loaded: {API_SECRET_KEY[:20]}...")

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


def search_api_entities(restaurant_name: str) -> List[Dict]:
    """Search for entities via API v3 by name similarity"""
    try:
        # Search entities via API
        response = requests.get(
            API_ENTITIES_URL,
            params={"search": restaurant_name, "limit": 5},
            timeout=10
        )
        
        if response.status_code != 200:
            print(f"{Colors.WARNING}API search failed: {response.status_code}{Colors.ENDC}")
            return []
        
        results = response.json()
        return results if isinstance(results, list) else []
    except Exception as e:
        print(f"{Colors.FAIL}Error searching entities: {e}{Colors.ENDC}")
        return []


def search_google_places(restaurant_name: str) -> List[Dict]:
    """Search Google Places API for matching restaurants"""
    try:
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress"
        }
        
        payload = {
            "textQuery": f"{restaurant_name} São Paulo restaurant",
            "languageCode": "pt-BR"
        }
        
        response = requests.post(PLACES_TEXT_SEARCH_URL, json=payload, headers=headers, timeout=10)
        
        if response.status_code != 200:
            print(f"{Colors.WARNING}Google Places search failed: {response.status_code}{Colors.ENDC}")
            return []
        
        data = response.json()
        places = data.get("places", [])
        
        # Format results
        results = []
        for place in places[:5]:
            results.append({
                "place_id": place.get("id", "").replace("places/", ""),
                "name": place.get("displayName", {}).get("text", "Unknown"),
                "address": place.get("formattedAddress", "")
            })
        
        return results
    
    except Exception as e:
        print(f"{Colors.FAIL}Error searching Google Places: {e}{Colors.ENDC}")
        return []


def display_concepts(concepts: Dict):
    """Display concepts in a formatted way"""
    print(f"\n{Colors.BOLD}{Colors.UNDERLINE}Concepts to import:{Colors.ENDC}")
    
    for category, values in concepts.items():
        if values:
            if isinstance(values, list):
                values_str = ", ".join(values)
            else:
                values_str = str(values)
            print(f"  {Colors.OKCYAN}{category}:{Colors.ENDC} {values_str}")


def display_candidate(idx: int, candidate: Dict, source: str):
    """Display a single candidate option"""
    print(f"\n{Colors.BOLD}[{idx}] {source.upper()} Match:{Colors.ENDC}")
    print(f"  Name: {candidate.get('name', 'Unknown')}")
    
    if source == "api":
        entity_id = candidate.get('_id') or candidate.get('entity_id')
        print(f"  Entity ID: {entity_id}")
        
        if candidate.get('concepts'):
            print(f"  {Colors.WARNING}⚠ Already has concepts{Colors.ENDC}")
    
    elif source == "google":
        print(f"  Place ID: {candidate.get('place_id', 'Unknown')}")
        print(f"  Address: {candidate.get('address', 'Unknown')}")


def create_entity_from_place_id(place_id: str, concepts: Dict) -> Optional[str]:
    """Create new entity from Google Place ID via API v3"""
    try:
        # First, fetch place details from Google Places API
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
        entity_id = f"entity_{place_id}"
        
        # Create entity via API
        entity_data = {
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
            "concepts": concepts
        }
        
        headers_api = {"X-API-Key": API_SECRET_KEY} if API_SECRET_KEY else {}
        response = requests.post(
            API_ENTITIES_URL,
            json=entity_data,
            headers=headers_api,
            timeout=30
        )
        
        if response.status_code == 201:
            result = response.json()
            return result.get("entity_id")
        else:
            error_msg = f"Failed to create entity: {response.status_code}"
            try:
                error_data = response.json()
                if "detail" in error_data:
                    error_msg += f" - {error_data['detail']}"
            except:
                error_msg += f" - {response.text[:200]}"
            print(f"{Colors.FAIL}{error_msg}{Colors.ENDC}")
            return None
        
    except Exception as e:
        print(f"{Colors.FAIL}Error creating entity: {e}{Colors.ENDC}")
        return None


def update_entity_concepts(entity_id: str, concepts: Dict) -> bool:
    """Update entity with concepts via API v3"""
    try:
        # Get current entity to get version for If-Match
        entity_resp = requests.get(f"{API_ENTITIES_URL}/{entity_id}", timeout=10)
        if entity_resp.status_code != 200:
            print(f"{Colors.FAIL}Entity not found{Colors.ENDC}")
            return False
        
        current = entity_resp.json()
        version = current.get("version", 1)
        
        update_data = {"concepts": concepts}
        headers_api = {
            "If-Match": f'"{version}"'
        }
        if API_SECRET_KEY:
            headers_api["X-API-Key"] = API_SECRET_KEY
        
        response = requests.patch(
            f"{API_ENTITIES_URL}/{entity_id}",
            json=update_data,
            headers=headers_api,
            timeout=30
        )
        
        if response.status_code == 200:
            return True
        else:
            error_msg = f"Failed to update entity: {response.status_code}"
            try:
                error_data = response.json()
                if "detail" in error_data:
                    error_msg += f" - {error_data['detail']}"
            except:
                pass
            print(f"{Colors.FAIL}{error_msg}{Colors.ENDC}")
            return False
    
    except Exception as e:
        print(f"{Colors.FAIL}Error updating entity: {e}{Colors.ENDC}")
        return False


def delete_entity(entity_id: str) -> bool:
    """Delete entity via API v3"""
    try:
        headers_api = {"X-API-Key": API_SECRET_KEY} if API_SECRET_KEY else {}
        response = requests.delete(f"{API_ENTITIES_URL}/{entity_id}", headers=headers_api, timeout=10)
        return response.status_code == 204
    except Exception as e:
        print(f"{Colors.FAIL}Error deleting entity: {e}{Colors.ENDC}")
        return False


def process_restaurant(restaurant_name: str, concepts: Dict, stats: Dict):
    """Process a single restaurant interactively"""
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'='*80}{Colors.ENDC}")
    print(f"{Colors.BOLD}Restaurant: {restaurant_name}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'='*80}{Colors.ENDC}")
    
    # Display concepts
    display_concepts(concepts)
    
    # Search API
    api_entities = search_api_entities(restaurant_name)
    
    # Search Google Places
    google_places = search_google_places(restaurant_name)
    
    # Combine candidates
    all_candidates = []
    
    # API entities
    for entity in api_entities:
        all_candidates.append(("api", entity))
    
    # Google Places
    for place in google_places:
        all_candidates.append(("google", place))
    
    # Display options
    if all_candidates:
        print(f"\n{Colors.BOLD}Found {len(all_candidates)} candidate(s):{Colors.ENDC}")
        
        for idx, (source, candidate) in enumerate(all_candidates, 1):
            display_candidate(idx, candidate, source)
    else:
        print(f"\n{Colors.WARNING}No candidates found{Colors.ENDC}")
    
    # Interactive prompt
    print(f"\n{Colors.BOLD}Options:{Colors.ENDC}")
    if all_candidates:
        print(f"  [1-{len(all_candidates)}] Select candidate")
    print(f"  [m] Enter manual place_id")
    print(f"  [d] Delete and recreate (if exists)")
    print(f"  [s] Skip this restaurant")
    print(f"  [q] Quit")
    
    while True:
        choice = input(f"\n{Colors.BOLD}Your choice: {Colors.ENDC}").strip().lower()
        
        if choice == 'q':
            print(f"{Colors.WARNING}Quitting...{Colors.ENDC}")
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
            print(f"{Colors.OKCYAN}Deleting existing entity...{Colors.ENDC}")
            if delete_entity(entity_id):
                print(f"{Colors.OKGREEN}✓ Deleted existing entity{Colors.ENDC}")
            else:
                print(f"{Colors.WARNING}No existing entity found or delete failed{Colors.ENDC}")
            
            # Create new
            print(f"{Colors.OKCYAN}Creating new entity...{Colors.ENDC}")
            entity_id = create_entity_from_place_id(place_id, concepts)
            if entity_id:
                print(f"{Colors.OKGREEN}✓ Created entity: {entity_id}{Colors.ENDC}")
                stats['created'] += 1
            else:
                print(f"{Colors.FAIL}✗ Failed to create entity{Colors.ENDC}")
                stats['failed'] += 1
            return
        
        elif choice == 'm':
            # Manual place_id entry
            place_id = input(f"{Colors.BOLD}Enter Google Place ID: {Colors.ENDC}").strip()
            if not place_id:
                print(f"{Colors.FAIL}No place_id provided{Colors.ENDC}")
                continue
            
            print(f"{Colors.OKCYAN}Creating entity from place_id {place_id}...{Colors.ENDC}")
            entity_id = create_entity_from_place_id(place_id, concepts)
            if entity_id:
                print(f"{Colors.OKGREEN}✓ Created entity: {entity_id}{Colors.ENDC}")
                stats['created'] += 1
            else:
                print(f"{Colors.FAIL}✗ Failed to create entity{Colors.ENDC}")
                stats['failed'] += 1
            return
        
        elif choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(all_candidates):
                source, candidate = all_candidates[idx]
                
                if source == "api":
                    # Update existing entity
                    entity_id = candidate.get("_id") or candidate.get("entity_id")
                    print(f"{Colors.OKCYAN}Updating entity {entity_id}...{Colors.ENDC}")
                    
                    if update_entity_concepts(entity_id, concepts):
                        print(f"{Colors.OKGREEN}✓ Updated entity{Colors.ENDC}")
                        stats['updated'] += 1
                    else:
                        print(f"{Colors.FAIL}✗ Failed to update entity{Colors.ENDC}")
                        stats['failed'] += 1
                
                else:  # google
                    # Create new entity from Google place
                    place_id = candidate.get("place_id")
                    print(f"{Colors.OKCYAN}Creating new entity from place_id {place_id}...{Colors.ENDC}")
                    
                    entity_id = create_entity_from_place_id(place_id, concepts)
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
    print("Restaurant Concepts Import Tool (API v3)")
    print("="*80)
    print(f"{Colors.ENDC}")
    
    # Validate configuration
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
    
    # Test API connection
    print(f"{Colors.OKCYAN}Testing API connection to {API_BASE_URL}...{Colors.ENDC}")
    try:
        response = requests.get(f"{API_BASE_URL}/health", timeout=5)
        if response.status_code == 200:
            print(f"{Colors.OKGREEN}API connection successful{Colors.ENDC}")
        else:
            print(f"{Colors.WARNING}API returned status {response.status_code}{Colors.ENDC}")
    except Exception as e:
        print(f"{Colors.FAIL}Cannot connect to API: {e}{Colors.ENDC}")
        print(f"{Colors.WARNING}Make sure the API is running (cd concierge-api-v3 && ./run_local.sh){Colors.ENDC}")
        sys.exit(1)
    
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
            process_restaurant(restaurant_name, concepts, stats)
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


if __name__ == "__main__":
    main()
