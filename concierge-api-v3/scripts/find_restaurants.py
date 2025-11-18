#!/usr/bin/env python3
"""
Restaurant Finder CLI - Import top restaurants from Google Places via API V3

Uses Concierge API V3 to find and import top-rated restaurants from any city.
All operations go through the API (not direct MongoDB access).

Usage:
    python scripts/find_restaurants.py --city "Rio de Janeiro" --limit 10
    python scripts/find_restaurants.py --city "New York" --limit 20 --type restaurant
    python scripts/find_restaurants.py --city "Paris" --limit 15 --min-rating 4.5
    
Features:
- Search via Google Places API (proxied through API V3)
- Get full place details
- Create entities via API V3
- Deduplication (checks existing entities)
- Rich CLI output with progress
- Dry-run mode for testing
"""

import argparse
import asyncio
import sys
from typing import List, Dict, Any, Optional
from pathlib import Path
import json

import httpx
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.panel import Panel
from rich import print as rprint

# Configuration
API_BASE_URL = "http://localhost:8000/api/v3"  # Change for production
TIMEOUT = 30.0

console = Console()


class RestaurantFinder:
    """CLI tool for finding and importing restaurants via API V3"""
    
    def __init__(self, api_base: str = API_BASE_URL):
        self.api_base = api_base
        self.client = httpx.AsyncClient(timeout=TIMEOUT)
        self.stats = {
            "found": 0,
            "created": 0,
            "duplicates": 0,
            "errors": 0
        }
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.client.aclose()
    
    async def check_api_health(self) -> bool:
        """Check if API is accessible"""
        try:
            response = await self.client.get(f"{self.api_base}/health")
            return response.status_code == 200
        except Exception as e:
            console.print(f"[red]❌ API not accessible: {e}[/red]")
            return False
    
    async def search_places(
        self,
        city: str,
        place_type: str = "restaurant",
        limit: int = 10,
        min_rating: float = 4.0
    ) -> List[Dict[str, Any]]:
        """Search for places using Google Places API via our proxy"""
        
        console.print(f"\n🔍 Searching for [cyan]{place_type}s[/cyan] in [yellow]{city}[/yellow]...")
        
        # First, we need to geocode the city to get coordinates
        # For now, using hardcoded coordinates for major cities
        # In production, you'd use a geocoding API
        city_coords = self._get_city_coordinates(city)
        
        if not city_coords:
            console.print(f"[red]❌ City '{city}' not found in database. Please provide coordinates.[/red]")
            return []
        
        lat, lng = city_coords
        
        # Search via Places API proxy
        try:
            params = {
                "latitude": lat,
                "longitude": lng,
                "radius": 5000,  # 5km radius
                "type": place_type
            }
            
            response = await self.client.get(
                f"{self.api_base}/places/nearby",
                params=params
            )
            
            if response.status_code != 200:
                console.print(f"[red]❌ Places API error: {response.status_code}[/red]")
                return []
            
            data = response.json()
            results = data.get("results", [])
            
            # Filter by rating
            filtered = [
                r for r in results 
                if r.get("rating", 0) >= min_rating
            ]
            
            # Sort by rating (descending) and limit
            sorted_results = sorted(
                filtered,
                key=lambda x: (x.get("rating", 0), x.get("user_ratings_total", 0)),
                reverse=True
            )[:limit]
            
            self.stats["found"] = len(sorted_results)
            
            console.print(f"[green]✅ Found {len(sorted_results)} places (filtered from {len(results)})[/green]")
            
            return sorted_results
            
        except Exception as e:
            console.print(f"[red]❌ Search failed: {e}[/red]")
            return []
    
    async def get_place_details(self, place_id: str) -> Optional[Dict[str, Any]]:
        """Get detailed information for a place"""
        try:
            response = await self.client.get(
                f"{self.api_base}/places/details/{place_id}"
            )
            
            if response.status_code == 200:
                return response.json().get("result")
            
            return None
            
        except Exception as e:
            console.print(f"[red]⚠️  Failed to get details for {place_id}: {e}[/red]")
            return None
    
    async def check_entity_exists(self, name: str, place_id: str) -> Optional[str]:
        """Check if entity already exists"""
        try:
            # Search by name
            response = await self.client.get(
                f"{self.api_base}/entities",
                params={"name": name}
            )
            
            if response.status_code == 200:
                entities = response.json().get("items", [])
                
                # Check if any match by externalId (Google Place ID)
                for entity in entities:
                    if entity.get("externalId") == place_id:
                        return entity.get("entity_id")
                
                # Check if any match by name (case-insensitive)
                for entity in entities:
                    if entity.get("name", "").lower() == name.lower():
                        return entity.get("entity_id")
            
            return None
            
        except Exception:
            return None
    
    async def create_entity(
        self,
        place: Dict[str, Any],
        details: Optional[Dict[str, Any]],
        city: str,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """Create entity from place data"""
        
        name = place.get("name", "Unknown")
        place_id = place.get("place_id")
        
        if not place_id:
            self.stats["errors"] += 1
            return {
                "status": "error",
                "name": name,
                "error": "Missing place_id"
            }
        
        # Check if already exists
        existing_id = await self.check_entity_exists(name, place_id)
        if existing_id:
            self.stats["duplicates"] += 1
            return {
                "status": "duplicate",
                "name": name,
                "entity_id": existing_id
            }
        
        # Build entity data
        entity_data = self._build_entity_data(place, details, city)
        
        if dry_run:
            self.stats["created"] += 1
            return {
                "status": "dry_run",
                "name": name,
                "entity_id": entity_data["entity_id"]
            }
        
        # Create via API
        try:
            response = await self.client.post(
                f"{self.api_base}/entities",
                json=entity_data
            )
            
            if response.status_code == 201:
                self.stats["created"] += 1
                result = response.json()
                return {
                    "status": "created",
                    "name": name,
                    "entity_id": result.get("entity_id"),
                    "_id": result.get("_id")
                }
            else:
                self.stats["errors"] += 1
                return {
                    "status": "error",
                    "name": name,
                    "error": response.text
                }
                
        except Exception as e:
            self.stats["errors"] += 1
            return {
                "status": "error",
                "name": name,
                "error": str(e)
            }
    
    def _build_entity_data(
        self,
        place: Dict[str, Any],
        details: Optional[Dict[str, Any]],
        city: str
    ) -> Dict[str, Any]:
        """Build entity document from place data"""
        
        name = place.get("name", "Unknown")
        place_id = place.get("place_id")
        
        # Generate entity_id
        name_slug = name.lower().replace(" ", "_").replace("'", "")
        city_slug = city.lower().replace(" ", "_")
        entity_id = f"rest_{name_slug}_{city_slug}"[:100]
        
        # Extract location
        geometry = place.get("geometry", {}) or {}
        location_data = geometry.get("location", {}) or {}
        
        address = place.get("vicinity") or (details and details.get("formatted_address")) or ""
        
        # Google Places API returns both formats
        lat = location_data.get("lat") or location_data.get("latitude")
        lng = location_data.get("lng") or location_data.get("longitude")
        
        coordinates = None
        if lat is not None and lng is not None:
            coordinates = {"lat": lat, "lng": lng}
        
        # Extract types/cuisine
        types = place.get("types", [])
        cuisine = [t.replace("_", " ").title() for t in types if t not in ["point_of_interest", "establishment"]]
        
        # Price level
        price_level = place.get("price_level")
        price_map = {1: "$", 2: "$$", 3: "$$$", 4: "$$$$"}
        price_range = price_map.get(price_level, "")
        
        # Build entity
        entity_data = {
            "entity_id": entity_id,
            "type": "restaurant",
            "name": name,
            "status": "active",
            "externalId": place_id,
            "metadata": [
                {
                    "type": "google_places",
                    "source": "Google Places API",
                    "data": {
                        "place_id": place_id,
                        "rating": place.get("rating"),
                        "user_ratings_total": place.get("user_ratings_total"),
                        "price_level": price_level,
                        "types": types,
                        "business_status": place.get("business_status"),
                        "opening_hours": place.get("opening_hours") or {},
                        "photos": (place.get("photos") or [])[:5]  # Limit photos
                    }
                }
            ],
            "data": {
                "location": {
                    "address": address,
                    "city": city,
                    "coordinates": coordinates
                },
                "contacts": {},
                "attributes": {
                    "cuisine": cuisine[:5],  # Limit cuisines
                    "price_range": price_range,
                    "rating": place.get("rating"),
                    "ratings_count": place.get("user_ratings_total")
                }
            },
            "createdBy": "restaurant_finder_cli"
        }
        
        # Add details if available
        if details:
            if details.get("formatted_phone_number"):
                entity_data["data"]["contacts"]["phone"] = details["formatted_phone_number"]
            if details.get("website"):
                entity_data["data"]["contacts"]["website"] = details["website"]
            if details.get("opening_hours", {}).get("weekday_text"):
                entity_data["data"]["attributes"]["hours"] = details["opening_hours"]["weekday_text"]
        
        return entity_data
    
    def _get_city_coordinates(self, city: str) -> Optional[tuple]:
        """Get coordinates for major cities (hardcoded for now)"""
        cities = {
            "rio de janeiro": (-22.9068, -43.1729),
            "rio": (-22.9068, -43.1729),
            "são paulo": (-23.5505, -46.6333),
            "sao paulo": (-23.5505, -46.6333),
            "new york": (40.7128, -74.0060),
            "nyc": (40.7128, -74.0060),
            "paris": (48.8566, 2.3522),
            "london": (51.5074, -0.1278),
            "tokyo": (35.6762, 139.6503),
            "barcelona": (41.3851, 2.1734),
            "amsterdam": (52.3676, 4.9041),
            "los angeles": (34.0522, -118.2437),
            "la": (34.0522, -118.2437),
            "san francisco": (37.7749, -122.4194),
            "miami": (25.7617, -80.1918),
            "chicago": (41.8781, -87.6298),
            "boston": (42.3601, -71.0589),
            "lisbon": (38.7223, -9.1393),
            "lisboa": (38.7223, -9.1393),
            "madrid": (40.4168, -3.7038),
            "rome": (41.9028, 12.4964),
            "roma": (41.9028, 12.4964),
            "berlin": (52.5200, 13.4050),
            "dubai": (25.2048, 55.2708),
            "singapore": (1.3521, 103.8198),
            "hong kong": (22.3193, 114.1694),
            "sydney": (-33.8688, 151.2093),
            "melbourne": (-37.8136, 144.9631),
        }
        
        return cities.get(city.lower())
    
    def display_results(self, results: List[Dict[str, Any]]):
        """Display search results in a table"""
        
        if not results:
            console.print("[yellow]No results to display[/yellow]")
            return
        
        table = Table(title="🍽️  Found Restaurants", show_header=True, header_style="bold magenta")
        table.add_column("#", style="dim", width=4)
        table.add_column("Name", style="cyan", width=30)
        table.add_column("Rating", justify="center", width=10)
        table.add_column("Reviews", justify="center", width=10)
        table.add_column("Price", justify="center", width=8)
        table.add_column("Address", style="dim", width=40)
        
        for idx, place in enumerate(results, 1):
            rating = place.get("rating", "N/A")
            rating_str = f"⭐ {rating}" if rating != "N/A" else "N/A"
            
            reviews = place.get("user_ratings_total", 0)
            
            price_level = place.get("price_level")
            price_map = {1: "$", 2: "$$", 3: "$$$", 4: "$$$$"}
            price = price_map.get(price_level, "N/A")
            
            address = place.get("vicinity", "N/A")
            
            table.add_row(
                str(idx),
                place.get("name", "Unknown"),
                rating_str,
                str(reviews),
                price,
                address
            )
        
        console.print(table)
    
    def display_statistics(self):
        """Display import statistics"""
        
        stats_panel = Panel(
            f"""
[cyan]Total Found:[/cyan] {self.stats['found']}
[green]✅ Created:[/green] {self.stats['created']}
[yellow]⚠️  Duplicates:[/yellow] {self.stats['duplicates']}
[red]❌ Errors:[/red] {self.stats['errors']}
            """.strip(),
            title="📊 Import Statistics",
            border_style="green"
        )
        
        console.print("\n")
        console.print(stats_panel)


async def main():
    parser = argparse.ArgumentParser(
        description="Find and import top restaurants from any city via API V3",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Find top 10 restaurants in Rio de Janeiro
  python scripts/find_restaurants.py --city "Rio de Janeiro" --limit 10
  
  # Find top 20 restaurants in New York with min rating 4.5
  python scripts/find_restaurants.py --city "New York" --limit 20 --min-rating 4.5
  
  # Dry run (don't create entities)
  python scripts/find_restaurants.py --city "Paris" --limit 15 --dry-run
  
  # Use production API
  python scripts/find_restaurants.py --city "Tokyo" --limit 10 --api-url https://api.example.com/api/v3
        """
    )
    
    parser.add_argument(
        "--city",
        required=True,
        help="City name (e.g., 'Rio de Janeiro', 'New York', 'Paris')"
    )
    
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Maximum number of restaurants to import (default: 10)"
    )
    
    parser.add_argument(
        "--type",
        default="restaurant",
        help="Place type (default: restaurant)"
    )
    
    parser.add_argument(
        "--min-rating",
        type=float,
        default=4.0,
        help="Minimum rating (1.0-5.0, default: 4.0)"
    )
    
    parser.add_argument(
        "--api-url",
        default=API_BASE_URL,
        help=f"API base URL (default: {API_BASE_URL})"
    )
    
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Test mode - don't create entities"
    )
    
    parser.add_argument(
        "--no-details",
        action="store_true",
        help="Skip fetching detailed information (faster but less complete)"
    )
    
    args = parser.parse_args()
    
    # Validate arguments
    if args.min_rating < 1.0 or args.min_rating > 5.0:
        console.print("[red]❌ Rating must be between 1.0 and 5.0[/red]")
        return 1
    
    if args.limit < 1 or args.limit > 100:
        console.print("[red]❌ Limit must be between 1 and 100[/red]")
        return 1
    
    # Display header
    console.print("\n")
    console.print(Panel.fit(
        f"[bold cyan]🍽️  Restaurant Finder CLI[/bold cyan]\n"
        f"City: [yellow]{args.city}[/yellow] | "
        f"Limit: [green]{args.limit}[/green] | "
        f"Min Rating: [magenta]{args.min_rating}[/magenta]",
        border_style="cyan"
    ))
    
    if args.dry_run:
        console.print("[yellow]🧪 DRY RUN MODE - No entities will be created[/yellow]\n")
    
    async with RestaurantFinder(api_base=args.api_url) as finder:
        # Check API health
        if not await finder.check_api_health():
            console.print("\n[red]💡 Make sure the API is running:[/red]")
            console.print("   cd concierge-api-v3")
            console.print("   python main.py")
            return 1
        
        console.print("[green]✅ API is accessible[/green]")
        
        # Search for places
        places = await finder.search_places(
            city=args.city,
            place_type=args.type,
            limit=args.limit,
            min_rating=args.min_rating
        )
        
        if not places:
            console.print("[yellow]No restaurants found matching criteria[/yellow]")
            return 0
        
        # Display results
        finder.display_results(places)
        
        # Confirm import
        if not args.dry_run:
            console.print("\n[yellow]⚠️  This will create entities in the database.[/yellow]")
            confirm = input("Continue? (y/N): ")
            if confirm.lower() != 'y':
                console.print("[yellow]Cancelled[/yellow]")
                return 0
        
        # Import with progress
        console.print("\n[cyan]📥 Importing restaurants...[/cyan]\n")
        
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console
        ) as progress:
            
            for place in places:
                name = place.get("name", "Unknown")
                task = progress.add_task(f"Processing {name}...", total=None)
                
                try:
                    # Get details if requested
                    details = None
                    place_id = place.get("place_id")
                    
                    if not place_id:
                        console.print(f"   [red]❌ {name} - Missing place_id[/red]")
                        progress.remove_task(task)
                        continue
                    
                    if not args.no_details:
                        details = await finder.get_place_details(place_id)
                    
                    # Create entity
                    result = await finder.create_entity(place, details, args.city, args.dry_run)
                    
                    # Display result
                    status = result.get("status")
                    if status == "created" or status == "dry_run":
                        console.print(f"   [green]✅ {name}[/green]")
                    elif status == "duplicate":
                        console.print(f"   [yellow]⚠️  {name} (already exists)[/yellow]")
                    else:
                        console.print(f"   [red]❌ {name} - {result.get('error', 'Unknown error')}[/red]")
                    
                except Exception as e:
                    import traceback
                    console.print(f"   [red]❌ {name} - Error: {e}[/red]")
                    if args.dry_run:  # Show traceback in dry-run mode
                        console.print(f"[dim]{traceback.format_exc()}[/dim]")
                    finder.stats["errors"] += 1
                
                progress.remove_task(task)
        
        # Display statistics
        finder.display_statistics()
        
        console.print("\n[green]✅ Import complete![/green]\n")
        return 0


if __name__ == "__main__":
    try:
        exit_code = asyncio.run(main())
        sys.exit(exit_code)
    except KeyboardInterrupt:
        console.print("\n[yellow]⚠️  Cancelled by user[/yellow]")
        sys.exit(1)
    except Exception as e:
        console.print(f"\n[red]❌ Fatal error: {e}[/red]")
        sys.exit(1)
