#!/usr/bin/env python3
"""
Fix city field containing coordinates via API endpoint.
Uses the existing /api/v3/entities PATCH endpoint.
"""

import re
import httpx
from app.core.config import settings
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn

console = Console()


def extract_city_from_address(address: str) -> str:
    """Extract city name from Brazilian address format."""
    if not address:
        return None
    
    # Pattern for Brazilian addresses: "City - State, Postal, Country"
    match = re.search(r',\s*([^,\-]+)\s*-\s*[A-Z]{2}\s*,', address)
    if match:
        return match.group(1).strip()
    
    match = re.search(r',\s*([^,]+)\s*-\s*[A-Z]{2}', address)
    if match:
        return match.group(1).strip()
    
    # Fallback: split by comma
    parts = [p.strip() for p in address.split(',')]
    if len(parts) >= 2:
        for part in reversed(parts[:-1]):
            if re.match(r'^[\d\-]+$', part):
                continue
            if len(part) < 3:
                continue
            if 'brazil' in part.lower() or 'brasil' in part.lower():
                continue
            city = re.sub(r'\s*-\s*[A-Z]{2}$', '', part).strip()
            return city
    
    return None


def is_coordinate_pattern(value: str) -> bool:
    """Check if string matches coordinate pattern."""
    if not isinstance(value, str):
        return False
    return bool(re.match(r'^-?\d+\.\d+\s*,\s*-?\d+\.\d+$', value.strip()))


def fix_via_api(dry_run: bool = False):
    """Fix entities using the API endpoint."""
    
    # Get API key
    api_key = settings.api_secret_key
    base_url = "http://localhost:8000"  # Local API
    
    console.print(f"[cyan]🔌 Using API: {base_url}[/cyan]")
    console.print(f"[yellow]🧪 Dry run: {dry_run}[/yellow]")
    console.print("=" * 60)
    
    with httpx.Client(timeout=30.0) as client:
        # Get all entities
        console.print("\n[cyan]🔍 Fetching entities...[/cyan]")
        
        headers = {"X-API-Key": api_key}
        response = client.get(f"{base_url}/api/v3/entities", headers=headers)
        
        if response.status_code != 200:
            console.print(f"[red]❌ Failed to fetch entities: {response.status_code}[/red]")
            return
        
        entities = response.json()
        console.print(f"[green]✅ Fetched {len(entities)} entities[/green]")
        
        # Find entities with coordinates in city
        entities_to_fix = []
        for entity in entities:
            city = entity.get('data', {}).get('location', {}).get('city')
            if city and is_coordinate_pattern(city):
                entities_to_fix.append(entity)
        
        console.print(f"[green]✅ Found {len(entities_to_fix)} entities with coordinates in city[/green]\n")
        
        if len(entities_to_fix) == 0:
            console.print("[green]🎉 No entities to fix![/green]")
            return
        
        # Show sample
        console.print("[yellow]Sample:[/yellow]")
        for entity in entities_to_fix[:5]:
            location = entity.get('data', {}).get('location', {})
            console.print(f"  • {entity['name']}")
            console.print(f"    Current: {location.get('city')}")
            extracted = extract_city_from_address(location.get('address', ''))
            console.print(f"    → New: [green]{extracted or 'Unable to extract'}[/green]\n")
        
        if dry_run:
            console.print(f"\n[yellow]🧪 DRY RUN - No changes[/yellow]")
            return
        
        # Confirm
        console.print(f"\n[red]⚠️  About to update {len(entities_to_fix)} entities[/red]")
        confirm = input("Continue? (yes/no): ")
        if confirm.lower() != 'yes':
            console.print("[yellow]❌ Aborted[/yellow]")
            return
        
        # Fix entities
        stats = {"updated": 0, "failed": 0, "no_city": 0}
        
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console
        ) as progress:
            task = progress.add_task("[cyan]Updating entities...", total=len(entities_to_fix))
            
            for entity in entities_to_fix:
                location = entity.get('data', {}).get('location', {})
                address = location.get('address', '')
                city = extract_city_from_address(address)
                
                if not city:
                    stats['no_city'] += 1
                    progress.advance(task)
                    continue
                
                # Update via API
                try:
                    entity_id = entity['entity_id']
                    # Update the nested field
                    if 'data' not in entity:
                        entity['data'] = {}
                    if 'location' not in entity['data']:
                        entity['data']['location'] = {}
                    entity['data']['location']['city'] = city
                    
                    response = client.patch(
                        f"{base_url}/api/v3/entities/{entity_id}",
                        headers=headers,
                        json=entity
                    )
                    
                    if response.status_code == 200:
                        stats['updated'] += 1
                    else:
                        stats['failed'] += 1
                        console.print(f"[red]❌ Failed {entity['name']}: {response.status_code}[/red]")
                        
                except Exception as e:
                    console.print(f"[red]❌ Error {entity['name']}: {e}[/red]")
                    stats['failed'] += 1
                
                progress.advance(task)
    
    # Summary
    console.print("\n" + "=" * 60)
    console.print("[bold green]✅ Fix completed![/bold green]")
    console.print(f"  • Updated: [green]{stats['updated']}[/green]")
    console.print(f"  • Failed: [red]{stats['failed']}[/red]")
    console.print(f"  • No city: [yellow]{stats['no_city']}[/yellow]")
    console.print("=" * 60)


if __name__ == "__main__":
    import sys
    
    dry_run = "--dry-run" in sys.argv or "-d" in sys.argv
    
    console.print("[bold cyan]City Coordinates Fix via API[/bold cyan]\n")
    
    if dry_run:
        console.print("[yellow]Running in DRY RUN mode[/yellow]\n")
    
    fix_via_api(dry_run=dry_run)
