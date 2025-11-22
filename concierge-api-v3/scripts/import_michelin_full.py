#!/usr/bin/env python3
"""
Import Michelin entities from CSV to MongoDB.

This script:
1. Reads Michelin CSV file with all fields
2. Transforms data to match entity schema
3. Searches for existing entities by name + coordinates (200m radius)
4. Updates existing or creates new entities
5. Uses Google Places ID as entity_id when possible
"""

import csv
import re
from typing import Optional, Dict, Any
from pymongo import MongoClient
from app.core.config import settings
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
import httpx
import math
import time

console = Console()

# Use production API for Google Places
API_URL = "https://concierge-api-v3.onrender.com"
API_KEY = settings.api_secret_key


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two coordinates in meters using Haversine formula."""
    R = 6371000  # Earth radius in meters
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c


def search_google_place(name: str, lat: float, lng: float) -> Optional[str]:
    """
    Search Google Places via our production API.
    Returns place_id if found within 200m radius.
    """
    try:
        url = f"{API_URL}/api/v3/places/search"
        headers = {"X-API-Key": API_KEY}
        params = {
            "query": name,
            "latitude": lat,
            "longitude": lng
        }
        
        response = httpx.get(url, headers=headers, params=params, timeout=10.0)
        
        if response.status_code != 200:
            console.print(f"[yellow]⚠️  API error: {response.status_code}[/yellow]")
            return None
        
        data = response.json()
        
        # Check if we got results
        if not data or not isinstance(data, list) or len(data) == 0:
            return None
        
        # Get first result
        place = data[0]
        place_id = place.get('place_id')
        
        # Check distance if coordinates are available
        if 'geometry' in place and 'location' in place['geometry']:
            place_lat = place['geometry']['location'].get('lat')
            place_lng = place['geometry']['location'].get('lng')
            
            if place_lat and place_lng:
                distance = calculate_distance(lat, lng, place_lat, place_lng)
                
                # If within 200 meters, consider it a match
                if distance <= 200:
                    return place_id
        
        # If no coordinates to verify, return place_id anyway
        return place_id
        
    except Exception as e:
        console.print(f"[yellow]⚠️  API error: {e}[/yellow]")
        return None


def extract_city(location: str) -> str:
    """Extract city from location string like 'Barcelona, Spain'."""
    if not location:
        return ""
    # Take first part before comma
    parts = location.split(',')
    if len(parts) >= 2:
        return parts[0].strip()
    return location.strip()


def parse_price_range(price: str) -> str:
    """Convert price symbols to category."""
    if not price:
        return "moderate"
    
    # Count currency symbols
    count = len(price.replace(' ', ''))
    
    if count == 1:
        return "budget"
    elif count == 2:
        return "moderate"
    elif count == 3:
        return "upscale"
    else:
        return "luxury"


def parse_facilities(facilities: str) -> list:
    """Parse facilities string into list of tags."""
    if not facilities:
        return []
    
    # Split by comma and clean up
    items = [f.strip() for f in facilities.split(',')]
    
    # Convert to lowercase and remove duplicates
    tags = list(set([
        item.lower()
        .replace(' ', '_')
        .replace('/', '_')
        for item in items
        if item
    ]))
    
    return tags


def find_existing_entity(db, name: str, lat: float, lng: float) -> Optional[Dict[str, Any]]:
    """
    Find existing entity by name and proximity (200m radius).
    Returns entity if found, None otherwise.
    """
    if not lat or not lng:
        # No coordinates, search by exact name only
        return db.entities.find_one({"name": name})
    
    # Search by name first
    entities = list(db.entities.find({"name": name}))
    
    if not entities:
        return None
    
    # Check proximity for each entity with the same name
    for entity in entities:
        coords = entity.get('data', {}).get('location', {}).get('coordinates', {})
        entity_lat = coords.get('latitude')
        entity_lng = coords.get('longitude')
        
        if entity_lat and entity_lng:
            distance = calculate_distance(lat, lng, entity_lat, entity_lng)
            if distance <= 200:  # Within 200 meters
                return entity
    
    return None


def transform_csv_row_to_entity(row: Dict[str, str], google_place_id: Optional[str] = None) -> Dict[str, Any]:
    """Transform CSV row to entity format."""
    
    # Parse coordinates
    try:
        latitude = float(row.get('Latitude', 0)) if row.get('Latitude') else None
        longitude = float(row.get('Longitude', 0)) if row.get('Longitude') else None
    except (ValueError, TypeError):
        latitude = None
        longitude = None
    
    # Generate entity_id
    if google_place_id:
        entity_id = f"entity_{google_place_id}"
    else:
        # Fallback to michelin ID format
        name_slug = re.sub(r'[^a-z0-9]+', '_', row.get('NAME', '').lower()).strip('_')
        city_slug = re.sub(r'[^a-z0-9]+', '_', extract_city(row.get('Location', '')).lower()).strip('_')
        entity_id = f"mich_{name_slug}_{city_slug}"
    
    # Parse award (MICHELIN stars)
    award = row.get('Award', '')
    michelin_stars = 0
    if '3 MICHELIN Stars' in award:
        michelin_stars = 3
    elif '2 MICHELIN Stars' in award:
        michelin_stars = 2
    elif '1 MICHELIN Star' in award:
        michelin_stars = 1
    
    # Build entity
    entity = {
        "entity_id": entity_id,
        "name": row.get('NAME', ''),
        "entity_type": "restaurant",
        "data": {
            "location": {
                "address": row.get('Address', ''),
                "city": extract_city(row.get('Location', '')),
                "country": row.get('Location', '').split(',')[-1].strip() if row.get('Location') else '',
                "coordinates": {}
            },
            "contact": {
                "phone": row.get('PhoneNumber', ''),
                "website": row.get('WebsiteUrl', '')
            },
            "details": {
                "cuisine": row.get('Cuisine', '').split(',') if row.get('Cuisine') else [],
                "price_range": parse_price_range(row.get('Price', '')),
                "michelin_stars": michelin_stars,
                "michelin_award": award,
                "description": row.get('REVIEW', ''),
                "facilities": parse_facilities(row.get('FacilitiesAndServices', ''))
            },
            "links": {
                "michelin_guide": row.get('URL', ''),
                "website": row.get('WebsiteUrl', '')
            }
        },
        "source": "michelin_guide",
        "import_metadata": {
            "csv_index": row.get('INDEX', ''),
            "import_source": "michelin_csv_2023"
        }
    }
    
    # Add coordinates if available
    if latitude and longitude:
        entity["data"]["location"]["coordinates"] = {
            "latitude": latitude,
            "longitude": longitude
        }
    
    return entity


def import_michelin_csv(csv_path: str, dry_run: bool = False, limit: int = None):
    """Import Michelin entities from CSV."""
    
    client = MongoClient(
        settings.mongodb_url,
        w='majority',
        wtimeoutms=5000
    )
    db = client[settings.mongodb_db_name]
    
    console.print(f"[cyan]🔌 Connected to MongoDB: {settings.mongodb_db_name}[/cyan]")
    console.print(f"[yellow]📂 Reading CSV: {csv_path}[/yellow]")
    console.print(f"[yellow]🧪 Dry run: {dry_run}[/yellow]")
    if limit:
        console.print(f"[yellow]🔢 Limit: {limit} entities[/yellow]")
    console.print("=" * 60)
    
    # Read CSV
    entities_data = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            entities_data.append(row)
            if limit and len(entities_data) >= limit:
                break
    
    console.print(f"[green]✅ Read {len(entities_data)} rows from CSV[/green]\n")
    
    if len(entities_data) == 0:
        console.print("[red]❌ No data in CSV[/red]")
        return
    
    # Show sample
    console.print("[yellow]Sample rows:[/yellow]")
    for row in entities_data[:3]:
        console.print(f"  • {row.get('NAME')} - {row.get('Location')}")
        console.print(f"    Award: {row.get('Award', 'N/A')}")
        console.print(f"    Coordinates: {row.get('Latitude', 'N/A')}, {row.get('Longitude', 'N/A')}\n")
    
    if dry_run:
        console.print(f"\n[yellow]🧪 DRY RUN - No changes will be made[/yellow]")
        return
    
    # Confirm
    console.print(f"\n[red]⚠️  About to process {len(entities_data)} entities[/red]")
    console.print("[yellow]This will:[/yellow]")
    console.print("  • Search Google Places for each entity")
    console.print("  • Check for duplicates by name + proximity (200m)")
    console.print("  • Update existing or create new entities")
    confirm = input("\nContinue? (yes/no): ")
    if confirm.lower() != 'yes':
        console.print("[yellow]❌ Aborted[/yellow]")
        return
    
    # Process entities
    stats = {
        "created": 0,
        "updated": 0,
        "skipped": 0,
        "google_found": 0,
        "failed": 0
    }
    
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console
    ) as progress:
        task = progress.add_task("[cyan]Processing entities...", total=len(entities_data))
        
        for row in entities_data:
            try:
                name = row.get('NAME', '')
                lat = float(row.get('Latitude', 0)) if row.get('Latitude') else None
                lng = float(row.get('Longitude', 0)) if row.get('Longitude') else None
                
                # Search Google Places for place_id
                google_place_id = None
                if lat and lng:
                    google_place_id = search_google_place(name, lat, lng)
                    if google_place_id:
                        stats['google_found'] += 1
                    time.sleep(0.1)  # Rate limiting
                
                # Check for existing entity
                existing = find_existing_entity(db, name, lat, lng) if (lat and lng) else db.entities.find_one({"name": name})
                
                # Transform to entity format
                entity = transform_csv_row_to_entity(row, google_place_id)
                
                if existing:
                    # Update existing
                    try:
                        db.entities.update_one(
                            {"_id": existing["_id"]},
                            {"$set": entity}
                        )
                        stats['updated'] += 1
                        console.print(f"[yellow]🔄 Updated: {name}[/yellow]")
                    except Exception as update_err:
                        # Retry once with longer timeout
                        time.sleep(1)
                        try:
                            db.entities.update_one(
                                {"_id": existing["_id"]},
                                {"$set": entity}
                            )
                            stats['updated'] += 1
                            console.print(f"[yellow]🔄 Updated: {name} (retry)[/yellow]")
                        except:
                            raise update_err
                else:
                    # Create new
                    try:
                        db.entities.insert_one(entity)
                        stats['created'] += 1
                        console.print(f"[green]✅ Created: {name}[/green]")
                    except Exception as insert_err:
                        # Retry once with longer timeout
                        time.sleep(1)
                        try:
                            db.entities.insert_one(entity)
                            stats['created'] += 1
                            console.print(f"[green]✅ Created: {name} (retry)[/green]")
                        except:
                            raise insert_err
                
            except Exception as e:
                stats['failed'] += 1
                console.print(f"[red]❌ Failed {row.get('NAME', 'Unknown')}: {e}[/red]")
            
            progress.advance(task)
    
    # Summary
    console.print("\n" + "=" * 60)
    console.print("[bold green]✅ Import completed![/bold green]")
    console.print(f"  • Created: [green]{stats['created']}[/green]")
    console.print(f"  • Updated: [yellow]{stats['updated']}[/yellow]")
    console.print(f"  • Google IDs found: [cyan]{stats['google_found']}[/cyan]")
    console.print(f"  • Failed: [red]{stats['failed']}[/red]")
    console.print(f"  • Total processed: {stats['created'] + stats['updated']}")
    console.print("=" * 60)


if __name__ == "__main__":
    import sys
    
    dry_run = "--dry-run" in sys.argv or "-d" in sys.argv
    
    # Check for --limit parameter
    limit = None
    for i, arg in enumerate(sys.argv):
        if arg == "--limit" and i + 1 < len(sys.argv):
            try:
                limit = int(sys.argv[i + 1])
            except ValueError:
                console.print("[red]❌ Invalid limit value[/red]")
                sys.exit(1)
    
    # CSV path
    csv_path = "data/Michelin - World - 2023_01_03 - Reviews - not complete 2.csv"
    if len(sys.argv) > 1 and not sys.argv[1].startswith('-'):
        csv_path = sys.argv[1]
    
    console.print("[bold cyan]🍽️  Michelin CSV Import Script[/bold cyan]")
    console.print("Imports Michelin entities with duplicate detection\n")
    
    if dry_run:
        console.print("[yellow]Running in DRY RUN mode - no changes will be made[/yellow]\n")
    
    import_michelin_csv(csv_path, dry_run=dry_run, limit=limit)
