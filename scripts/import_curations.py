#!/usr/bin/env python3
"""
File: import_curations.py
Purpose: Import restaurant concepts as CURATIONS using API v3
Dependencies: requests, python-dotenv
Last Updated: November 23, 2025

Creates curations for existing entities (the 82 created by import_concepts_api.py)
Concepts go to curations collection, NOT to entities.concepts field!
"""

import json
import os
import sys
import hashlib
from typing import Dict, List, Optional
from datetime import datetime

import requests
from dotenv import load_dotenv

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

# Load environment variables from correct path
env_path = os.path.join(os.path.dirname(__file__), '..', 'concierge-api-v3', '.env')
load_dotenv(env_path)

# Configuration
API_BASE_URL = 'https://concierge-collector.onrender.com'
API_SECRET_KEY = os.getenv('API_SECRET_KEY')
CONCEPTS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'restaurants - 2025-10-15.json')

# Validate API key loaded
if not API_SECRET_KEY:
    print(f"{Colors.FAIL}ERROR: API_SECRET_KEY not found in .env file{Colors.ENDC}")
    sys.exit(1)

# API Endpoints
API_ENTITIES_URL = f"{API_BASE_URL}/api/v3/entities"
API_CURATIONS_URL = f"{API_BASE_URL}/api/v3/curations"


def create_curation(entity_id: str, restaurant_name: str, concepts: Dict) -> Optional[str]:
    """Create curation with concepts via API v3"""
    try:
        # Generate unique curation_id
        curation_id = f"curation-{hashlib.md5(entity_id.encode()).hexdigest()[:12]}"
        
        # Create curation via API
        curation_data = {
            "curation_id": curation_id,
            "entity_id": entity_id,
            "curator": {
                "id": "curator-import-script",
                "name": "Import Script"
            },
            "notes": {
                "public": f"Curated concepts for {restaurant_name}",
                "private": f"Automated import from restaurants-2025-10-15.json on {datetime.now().isoformat()}"
            },
            "categories": concepts,  # Concepts go here!
            "sources": ["restaurants-2025-10-15.json"]
        }
        
        headers_api = {
            "X-API-Key": API_SECRET_KEY,
            "Content-Type": "application/json"
        }
        
        response = requests.post(
            API_CURATIONS_URL,
            json=curation_data,
            headers=headers_api,
            timeout=30
        )
        
        if response.status_code == 201:
            result = response.json()
            return result.get("curation_id")
        else:
            error_msg = f"Failed: {response.status_code}"
            try:
                error_data = response.json()
                if "detail" in error_data:
                    error_msg += f" - {error_data['detail']}"
            except:
                error_msg += f" - {response.text[:100]}"
            print(f"{Colors.FAIL}{error_msg}{Colors.ENDC}")
            return None
        
    except Exception as e:
        print(f"{Colors.FAIL}Error: {e}{Colors.ENDC}")
        return None


def search_entity_by_name(restaurant_name: str) -> Optional[Dict]:
    """Search for entity by restaurant name"""
    try:
        response = requests.get(
            API_ENTITIES_URL,
            params={"name": restaurant_name, "limit": 1},
            timeout=10
        )
        
        if response.status_code == 200:
            results = response.json()
            if isinstance(results, dict) and "items" in results:
                items = results["items"]
                return items[0] if items else None
            elif isinstance(results, list) and len(results) > 0:
                return results[0]
        
        return None
    except Exception as e:
        print(f"{Colors.FAIL}Search error: {e}{Colors.ENDC}")
        return None


def check_existing_curation(entity_id: str) -> bool:
    """Check if entity already has a curation"""
    try:
        response = requests.get(
            f"{API_CURATIONS_URL}/search",
            params={"entity_id": entity_id, "limit": 1},
            timeout=10
        )
        
        if response.status_code == 200:
            results = response.json()
            if isinstance(results, dict) and "items" in results:
                return len(results["items"]) > 0
        
        return False
    except Exception as e:
        print(f"{Colors.FAIL}Check error: {e}{Colors.ENDC}")
        return False


def delete_all_curations() -> int:
    """Delete all curations from database"""
    try:
        headers_api = {"X-API-Key": API_SECRET_KEY}
        
        # Get all curations
        response = requests.get(
            f"{API_CURATIONS_URL}/search",
            params={"limit": 1000},
            timeout=30
        )
        
        if response.status_code != 200:
            print(f"{Colors.FAIL}Failed to fetch curations{Colors.ENDC}")
            return 0
        
        results = response.json()
        items = results.get("items", [])
        
        deleted = 0
        for item in items:
            curation_id = item.get("_id") or item.get("curation_id")
            try:
                del_response = requests.delete(
                    f"{API_CURATIONS_URL}/{curation_id}",
                    headers=headers_api,
                    timeout=10
                )
                if del_response.status_code == 200:
                    deleted += 1
            except:
                pass
        
        return deleted
    except Exception as e:
        print(f"{Colors.FAIL}Error deleting curations: {e}{Colors.ENDC}")
        return 0


def delete_curations_for_entities(entity_ids: List[str]) -> int:
    """Delete curations for specific entities"""
    try:
        headers_api = {"X-API-Key": API_SECRET_KEY}
        deleted = 0
        
        for entity_id in entity_ids:
            # Get curations for this entity
            response = requests.get(
                f"{API_CURATIONS_URL}/search",
                params={"entity_id": entity_id, "limit": 10},
                timeout=10
            )
            
            if response.status_code != 200:
                continue
            
            results = response.json()
            items = results.get("items", [])
            
            for item in items:
                curation_id = item.get("_id") or item.get("curation_id")
                try:
                    del_response = requests.delete(
                        f"{API_CURATIONS_URL}/{curation_id}",
                        headers=headers_api,
                        timeout=10
                    )
                    if del_response.status_code == 200:
                        deleted += 1
                except:
                    pass
        
        return deleted
    except Exception as e:
        print(f"{Colors.FAIL}Error deleting curations: {e}{Colors.ENDC}")
        return 0


def main():
    """Main execution"""
    print(f"{Colors.HEADER}{Colors.BOLD}")
    print("="*80)
    print("Restaurant Curations Import Tool")
    print("="*80)
    print(f"{Colors.ENDC}\n")
    
    # Ask user for mode
    print(f"{Colors.OKCYAN}Select import mode:{Colors.ENDC}")
    print(f"  {Colors.BOLD}1{Colors.ENDC} - Delete ALL curations and reimport everything")
    print(f"  {Colors.BOLD}2{Colors.ENDC} - Delete curations for imported entities only")
    print(f"  {Colors.BOLD}3{Colors.ENDC} - Skip existing curations (add new only)")
    print()
    
    mode = input(f"{Colors.BOLD}Choose mode (1/2/3): {Colors.ENDC}").strip()
    
    if mode not in ['1', '2', '3']:
        print(f"{Colors.FAIL}Invalid option. Exiting.{Colors.ENDC}")
        return
    
    print()
    
    # Load concepts
    print(f"{Colors.OKCYAN}Loading concepts from JSON...{Colors.ENDC}")
    with open(CONCEPTS_FILE, 'r', encoding='utf-8') as f:
        all_concepts = json.load(f)
    
    print(f"{Colors.OKGREEN}Loaded {len(all_concepts)} restaurants{Colors.ENDC}\n")
    
    # Mode 1: Delete all curations
    if mode == '1':
        print(f"{Colors.WARNING}Deleting ALL curations...{Colors.ENDC}")
        deleted = delete_all_curations()
        print(f"{Colors.OKGREEN}Deleted {deleted} curations{Colors.ENDC}\n")
    
    # Mode 2: Get entity IDs and delete their curations
    elif mode == '2':
        print(f"{Colors.OKCYAN}Finding entities to clean...{Colors.ENDC}")
        entity_ids = []
        for restaurant_name in all_concepts.keys():
            entity = search_entity_by_name(restaurant_name)
            if entity:
                entity_id = entity.get('_id') or entity.get('entity_id')
                entity_ids.append(entity_id)
        
        print(f"{Colors.WARNING}Deleting curations for {len(entity_ids)} entities...{Colors.ENDC}")
        deleted = delete_curations_for_entities(entity_ids)
        print(f"{Colors.OKGREEN}Deleted {deleted} curations{Colors.ENDC}\n")
    
    # Stats
    stats = {
        'total': len(all_concepts),
        'created': 0,
        'skipped': 0,
        'failed': 0,
        'not_found': 0
    }
    
    # Process each restaurant
    for idx, (restaurant_name, concepts) in enumerate(all_concepts.items(), 1):
        # Skip empty concepts
        if not any(concepts.values()):
            stats['skipped'] += 1
            continue
        
        print(f"{Colors.BOLD}[{idx}/{stats['total']}] {restaurant_name}{Colors.ENDC}")
        
        # Search for entity
        entity = search_entity_by_name(restaurant_name)
        
        if not entity:
            print(f"  {Colors.WARNING}Entity not found - skipping{Colors.ENDC}")
            stats['not_found'] += 1
            continue
        
        entity_id = entity.get('_id') or entity.get('entity_id')
        print(f"  Found: {entity_id}")
        
        # Mode 3: Check if curation already exists and skip
        if mode == '3' and check_existing_curation(entity_id):
            print(f"  {Colors.WARNING}Curation already exists - skipping{Colors.ENDC}\n")
            stats['skipped'] += 1
            continue
        
        # Create curation
        curation_id = create_curation(entity_id, restaurant_name, concepts)
        
        if curation_id:
            print(f"  {Colors.OKGREEN}✓ Created: {curation_id}{Colors.ENDC}\n")
            stats['created'] += 1
        else:
            print(f"  {Colors.FAIL}✗ Failed{Colors.ENDC}\n")
            stats['failed'] += 1
    
    # Summary
    print(f"\n{Colors.HEADER}{Colors.BOLD}")
    print("="*80)
    print("Import Summary")
    print("="*80)
    print(f"{Colors.ENDC}")
    print(f"Total: {stats['total']}")
    print(f"{Colors.OKGREEN}Created: {stats['created']}{Colors.ENDC}")
    print(f"{Colors.WARNING}Not Found: {stats['not_found']}{Colors.ENDC}")
    print(f"{Colors.WARNING}Skipped: {stats['skipped']}{Colors.ENDC}")
    print(f"{Colors.FAIL}Failed: {stats['failed']}{Colors.ENDC}")


if __name__ == "__main__":
    main()
