#!/usr/bin/env python3
"""
Fix city field containing coordinates instead of city names.

This script:
1. Finds all entities where data.location.city contains coordinates (pattern: "-23.5520, -46.7180")
2. Extracts the actual city name from the address field
3. Updates the city field with the correct city name
"""

import re
from pymongo import MongoClient, UpdateOne
from app.core.config import settings
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn

console = Console()


def extract_city_from_address(address: str) -> str:
    """
    Extract city name from Brazilian address format.
    
    Examples:
        "Av. Itaquera, 6904 - Vila Carmosina, São Paulo - SP, 08295-000, Brazil"
        -> "São Paulo"
        
        "R. Vupabussu, 305 - Pinheiros, São Paulo - SP, 05429-040, Brazil"
        -> "São Paulo"
    """
    if not address:
        return None
    
    # Pattern for Brazilian addresses: "City - State, Postal, Country"
    # Match: São Paulo - SP
    match = re.search(r',\s*([^,\-]+)\s*-\s*[A-Z]{2}\s*,', address)
    if match:
        city = match.group(1).strip()
        return city
    
    # Alternative pattern: just get the part before " - State"
    match = re.search(r',\s*([^,]+)\s*-\s*[A-Z]{2}', address)
    if match:
        city = match.group(1).strip()
        return city
    
    # Fallback: split by comma and get second-to-last part
    parts = [p.strip() for p in address.split(',')]
    if len(parts) >= 2:
        # Remove postal codes and country
        for part in reversed(parts[:-1]):
            # Skip if it's a postal code (contains only numbers and dashes)
            if re.match(r'^[\d\-]+$', part):
                continue
            # Skip if it's too short
            if len(part) < 3:
                continue
            # Skip if it contains "Brazil" or country names
            if 'brazil' in part.lower() or 'brasil' in part.lower():
                continue
            # This should be the city
            # Remove state abbreviations
            city = re.sub(r'\s*-\s*[A-Z]{2}$', '', part).strip()
            return city
    
    return None


def is_coordinate_pattern(value: str) -> bool:
    """Check if string matches coordinate pattern like "-23.5520, -46.7180" """
    if not isinstance(value, str):
        return False
    # Pattern: number, comma, space, number
    return bool(re.match(r'^-?\d+\.\d+\s*,\s*-?\d+\.\d+$', value.strip()))


def fix_city_coordinates(dry_run: bool = False):
    """Main fix function"""
    
    client = MongoClient(
        settings.mongodb_url,
        w='majority',
        wtimeoutms=5000
    )
    db = client[settings.mongodb_db_name]
    
    console.print(f"[cyan]🔌 Connected to MongoDB: {settings.mongodb_db_name}[/cyan]")
    console.print(f"[yellow]🧪 Dry run: {dry_run}[/yellow]")
    console.print("=" * 60)
    
    # Find entities with coordinate patterns in city field
    console.print("\n[cyan]🔍 Searching for entities with coordinates in city field...[/cyan]")
    
    # Get all entities to check
    cursor = db.entities.find(
        {"data.location.city": {"$exists": True}},
        {"name": 1, "data.location": 1}
    )
    
    entities_to_fix = []
    
    for entity in cursor:
        city = entity.get('data', {}).get('location', {}).get('city')
        if city and is_coordinate_pattern(city):
            entities_to_fix.append(entity)
    
    console.print(f"[green]✅ Found {len(entities_to_fix)} entities with coordinates in city field[/green]\n")
    
    if len(entities_to_fix) == 0:
        console.print("[green]🎉 No entities to fix![/green]")
        return
    
    # Show sample
    console.print("[yellow]Sample of entities to fix:[/yellow]")
    for entity in entities_to_fix[:5]:
        location = entity.get('data', {}).get('location', {})
        console.print(f"  • {entity['name']}")
        console.print(f"    City: {location.get('city')}")
        console.print(f"    Address: {location.get('address', 'N/A')[:80]}...")
        extracted = extract_city_from_address(location.get('address', ''))
        console.print(f"    → Would become: [green]{extracted or 'Unable to extract'}[/green]\n")
    
    if dry_run:
        console.print(f"\n[yellow]🧪 DRY RUN - No changes will be made[/yellow]")
        return
    
    # Confirm
    console.print(f"\n[red]⚠️  About to update {len(entities_to_fix)} entities[/red]")
    confirm = input("Continue? (yes/no): ")
    if confirm.lower() != 'yes':
        console.print("[yellow]❌ Aborted[/yellow]")
        return
    
    # Fix entities
    stats = {
        "updated": 0,
        "failed": 0,
        "no_city_found": 0
    }
    
    # Prepare bulk operations
    bulk_ops = []
    
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console
    ) as progress:
        task = progress.add_task("[cyan]Preparing updates...", total=len(entities_to_fix))
        
        for entity in entities_to_fix:
            location = entity.get('data', {}).get('location', {})
            address = location.get('address', '')
            
            # Extract city from address
            city = extract_city_from_address(address)
            
            if not city:
                stats['no_city_found'] += 1
                console.print(f"[yellow]⚠️  Could not extract city from: {entity['name']}[/yellow]")
                progress.advance(task)
                continue
            
            # Add to bulk operations
            bulk_ops.append(
                UpdateOne(
                    {"_id": entity["_id"]},
                    {"$set": {"data.location.city": city}}
                )
            )
            
            progress.advance(task)
    
    if not bulk_ops:
        console.print("[yellow]No updates to perform[/yellow]")
        return
    
    # Execute bulk update
    console.print(f"\n[cyan]📦 Executing bulk update of {len(bulk_ops)} entities...[/cyan]")
    try:
        result = db.entities.bulk_write(bulk_ops, ordered=False)
        stats['updated'] = result.modified_count
        stats['failed'] = len(bulk_ops) - result.modified_count
    except Exception as e:
        console.print(f"[red]❌ Bulk update error: {e}[/red]")
        stats['failed'] = len(bulk_ops)
    
    # Summary
    console.print("\n" + "=" * 60)
    console.print("[bold green]✅ Fix completed![/bold green]")
    console.print(f"  • Updated: [green]{stats['updated']}[/green]")
    console.print(f"  • Failed: [red]{stats['failed']}[/red]")
    console.print(f"  • No city found: [yellow]{stats['no_city_found']}[/yellow]")
    console.print("=" * 60)


if __name__ == "__main__":
    import sys
    
    dry_run = "--dry-run" in sys.argv or "-d" in sys.argv
    
    console.print("[bold cyan]City Coordinates Fix Script[/bold cyan]")
    console.print("Fixes entities where data.location.city contains coordinates\n")
    
    if dry_run:
        console.print("[yellow]Running in DRY RUN mode[/yellow]\n")
    
    fix_city_coordinates(dry_run=dry_run)
