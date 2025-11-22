#!/usr/bin/env python3
"""
Find Google Places IDs for Michelin entities and update entity_id.

This script:
1. Finds entities without proper entity_id format (not entity_[GOOGLE_ID])
2. Searches Google Places API by name + coordinates
3. Validates match using geolocation proximity
4. Updates entity_id to entity_[GOOGLE_PLACE_ID]
"""

import os
import time
import math
from pymongo import MongoClient
from app.core.config import settings
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
import httpx

console = Console()

# Google Places API key from settings
GOOGLE_API_KEY = settings.google_places_api_key
if not GOOGLE_API_KEY:
    console.print("[red]❌ GOOGLE_PLACES_API_KEY not found in config[/red]")
    exit(1)


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate distance between two coordinates in meters using Haversine formula.
    """
    R = 6371000  # Earth radius in meters
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c


def search_google_place(name: str, lat: float = None, lng: float = None, address: str = None) -> dict:
    """
    Search Google Places API for a place by name and location or address.
    Returns place details if found within 200m radius (when coords provided).
    """
    try:
        # If we have coordinates, search with location bias
        if lat and lng:
            url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
            params = {
                "query": name,
                "location": f"{lat},{lng}",
                "radius": 200,  # 200 meters
                "key": GOOGLE_API_KEY
            }
            
            response = httpx.get(url, params=params, timeout=10.0)
            data = response.json()
            
            if data.get("status") != "OK" or not data.get("results"):
                return None
            
            # Check each result for proximity
            for result in data["results"]:
                place_lat = result["geometry"]["location"]["lat"]
                place_lng = result["geometry"]["location"]["lng"]
                place_id = result["place_id"]
                
                # Calculate distance
                distance = calculate_distance(lat, lng, place_lat, place_lng)
                
                # If within 200 meters, consider it a match
                if distance <= 200:
                    return {
                        "place_id": place_id,
                        "name": result["name"],
                        "distance": distance,
                        "lat": place_lat,
                        "lng": place_lng
                    }
        
        # If no coordinates or no match, try by address
        elif address:
            url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
            params = {
                "query": f"{name} {address}",
                "key": GOOGLE_API_KEY
            }
            
            response = httpx.get(url, params=params, timeout=10.0)
            data = response.json()
            
            if data.get("status") == "OK" and data.get("results"):
                # Return first match
                result = data["results"][0]
                place_lat = result["geometry"]["location"]["lat"]
                place_lng = result["geometry"]["location"]["lng"]
                place_id = result["place_id"]
                
                return {
                    "place_id": place_id,
                    "name": result["name"],
                    "distance": None,
                    "lat": place_lat,
                    "lng": place_lng
                }
        
        return None
        
    except Exception as e:
        console.print(f"[red]❌ Google API error: {e}[/red]")
        return None


def fix_entity_ids(dry_run: bool = False):
    """Find and fix entity IDs for non-Google entities"""
    
    client = MongoClient(
        settings.mongodb_url,
        w='majority',
        wtimeoutms=5000
    )
    db = client[settings.mongodb_db_name]
    
    console.print(f"[cyan]🔌 Connected to MongoDB: {settings.mongodb_db_name}[/cyan]")
    console.print(f"[yellow]🧪 Dry run: {dry_run}[/yellow]")
    console.print("=" * 60)
    
    # Find entities without proper entity_id format
    console.print("\n[cyan]🔍 Searching for entities without Google Place IDs...[/cyan]")
    
    # Get entities that don't start with "entity_" or are missing coordinates
    entities = list(db.entities.find(
        {
            "$or": [
                {"entity_id": {"$not": {"$regex": "^entity_"}}},
                {"entity_id": {"$regex": "^entity_$"}}  # Empty after prefix
            ]
        },
        {
            "name": 1,
            "entity_id": 1,
            "data.location": 1,
            "_id": 1
        }
    ))
    
    console.print(f"[green]✅ Found {len(entities)} entities to process[/green]")
    
    if len(entities) == 0:
        console.print("\n[green]🎉 All entities have valid Google Place IDs![/green]")
        return
    
    # Show sample
    console.print("\n[yellow]Sample entities:[/yellow]")
    for entity in entities[:5]:
        name = entity.get('name', 'Unknown')
        entity_id = entity.get('entity_id', 'N/A')
        coords = entity.get('data', {}).get('location', {}).get('coordinates', {})
        address = entity.get('data', {}).get('location', {}).get('address', 'N/A')
        lat = coords.get('latitude', 'N/A') if coords else 'N/A'
        lng = coords.get('longitude', 'N/A') if coords else 'N/A'
        console.print(f"  • {name}")
        console.print(f"    Current ID: {entity_id}")
        console.print(f"    Location: {lat}, {lng}")
        console.print(f"    Address: {address[:60]}...\n")
    
    if dry_run:
        console.print(f"\n[yellow]🧪 DRY RUN - No changes will be made[/yellow]")
        # Test first entity
        if entities:
            test_entity = entities[0]
            name = test_entity.get('name', '')
            coords = test_entity.get('data', {}).get('location', {}).get('coordinates', {})
            address = test_entity.get('data', {}).get('location', {}).get('address', '')
            lat = coords.get('latitude') if coords else None
            lng = coords.get('longitude') if coords else None
            
            console.print(f"\n[cyan]🧪 Testing Google Places search for: {name}[/cyan]")
            result = search_google_place(name, lat, lng, address)
            if result:
                console.print(f"[green]✅ Found match:[/green]")
                console.print(f"  • Name: {result['name']}")
                console.print(f"  • Place ID: {result['place_id']}")
                if result['distance']:
                    console.print(f"  • Distance: {result['distance']:.1f}m")
                console.print(f"  • Would update to: entity_{result['place_id']}")
            else:
                console.print(f"[yellow]⚠️  No match found[/yellow]")
        return
    
    # Confirm
    console.print(f"\n[red]⚠️  About to search and update {len(entities)} entities[/red]")
    console.print("[yellow]This will use Google Places API calls[/yellow]")
    confirm = input("Continue? (yes/no): ")
    if confirm.lower() != 'yes':
        console.print("[yellow]❌ Aborted[/yellow]")
        return
    
    # Process entities
    stats = {
        "updated": 0,
        "not_found": 0,
        "failed": 0,
        "skipped": 0
    }
    
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console
    ) as progress:
        task = progress.add_task("[cyan]Processing entities...", total=len(entities))
        
        for entity in entities:
            name = entity.get('name', '')
            coords = entity.get('data', {}).get('location', {}).get('coordinates', {})
            address = entity.get('data', {}).get('location', {}).get('address', '')
            lat = coords.get('latitude') if coords else None
            lng = coords.get('longitude') if coords else None
            
            # Search Google Places
            result = search_google_place(name, lat, lng, address)
            
            if not result:
                stats['not_found'] += 1
                console.print(f"[yellow]⚠️  No match: {name}[/yellow]")
                progress.advance(task)
                time.sleep(0.1)  # Rate limiting
                continue
            
            # Update entity_id
            new_entity_id = f"entity_{result['place_id']}"
            
            try:
                db.entities.update_one(
                    {"_id": entity["_id"]},
                    {"$set": {"entity_id": new_entity_id}}
                )
                stats['updated'] += 1
                distance_str = f" ({result['distance']:.1f}m)" if result['distance'] else ""
                console.print(f"[green]✅ Updated {name}: {result['place_id']}{distance_str}[/green]")
            except Exception as e:
                stats['failed'] += 1
                console.print(f"[red]❌ Failed {name}: {e}[/red]")
            
            progress.advance(task)
            time.sleep(0.1)  # Rate limiting
    
    # Summary
    console.print("\n" + "=" * 60)
    console.print("[bold green]✅ Entity ID fix completed![/bold green]")
    console.print(f"  • Updated: [green]{stats['updated']}[/green]")
    console.print(f"  • Not found: [yellow]{stats['not_found']}[/yellow]")
    console.print(f"  • Failed: [red]{stats['failed']}[/red]")
    console.print(f"  • Skipped: [yellow]{stats['skipped']}[/yellow]")
    console.print("=" * 60)


if __name__ == "__main__":
    import sys
    
    dry_run = "--dry-run" in sys.argv or "-d" in sys.argv
    
    console.print("[bold cyan]🔧 Fix Entity IDs Script[/bold cyan]")
    console.print("Finds Google Place IDs for entities and updates entity_id\n")
    
    if dry_run:
        console.print("[yellow]Running in DRY RUN mode - no changes will be made[/yellow]\n")
    
    fix_entity_ids(dry_run=dry_run)
