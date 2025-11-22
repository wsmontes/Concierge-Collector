#!/usr/bin/env python3
"""
Remove duplicate entities from MongoDB.

This script:
1. Finds entities with the same name and city
2. Keeps the oldest entity (first created)
3. Deletes all duplicates
"""

import re
from pymongo import MongoClient
from app.core.config import settings
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from collections import defaultdict

console = Console()


def remove_duplicates(dry_run: bool = False):
    """Remove duplicate entities"""
    
    client = MongoClient(
        settings.mongodb_url,
        w='majority',
        wtimeoutms=5000
    )
    db = client[settings.mongodb_db_name]
    
    console.print(f"[cyan]🔌 Connected to MongoDB: {settings.mongodb_db_name}[/cyan]")
    console.print(f"[yellow]🧪 Dry run: {dry_run}[/yellow]")
    console.print("=" * 60)
    
    # Get all entities
    console.print("\n[cyan]🔍 Searching for duplicate entities...[/cyan]")
    
    entities = list(db.entities.find(
        {},
        {'name': 1, 'entity_id': 1, 'data.location.city': 1, 'created_at': 1, '_id': 1}
    ).sort('created_at', 1))  # Sort by creation date (oldest first)
    
    console.print(f"[green]✅ Found {len(entities)} total entities[/green]")
    
    # Group by name + city
    groups = defaultdict(list)
    for entity in entities:
        name = entity.get('name', '')
        city = entity.get('data', {}).get('location', {}).get('city', '')
        key = f"{name}|{city}"
        groups[key].append(entity)
    
    # Find duplicates
    duplicates_to_delete = []
    stats = {
        'duplicate_groups': 0,
        'entities_to_delete': 0,
        'entities_to_keep': 0
    }
    
    for key, group in groups.items():
        if len(group) > 1:
            stats['duplicate_groups'] += 1
            # Keep the first one (oldest), delete the rest
            keep = group[0]
            delete = group[1:]
            stats['entities_to_keep'] += 1
            stats['entities_to_delete'] += len(delete)
            
            name = keep.get('name', 'Unknown')
            city = keep.get('data', {}).get('location', {}).get('city', 'Unknown')
            
            duplicates_to_delete.extend(delete)
    
    console.print(f"\n[yellow]📊 Duplicate Analysis:[/yellow]")
    console.print(f"  • Duplicate groups: [red]{stats['duplicate_groups']}[/red]")
    console.print(f"  • Entities to keep: [green]{stats['entities_to_keep']}[/green]")
    console.print(f"  • Entities to delete: [red]{stats['entities_to_delete']}[/red]")
    
    if stats['entities_to_delete'] == 0:
        console.print("\n[green]🎉 No duplicates found![/green]")
        return
    
    # Show sample
    console.print("\n[yellow]Sample of duplicates to remove:[/yellow]")
    sample_groups = [(key, group) for key, group in groups.items() if len(group) > 1]
    sample_groups.sort(key=lambda x: len(x[1]), reverse=True)
    
    for key, group in sample_groups[:10]:
        name = group[0].get('name', 'Unknown')
        city = group[0].get('data', {}).get('location', {}).get('city', 'Unknown')
        console.print(f"  • {name} ({city}): [red]{len(group)} copies[/red] → keeping 1, deleting {len(group)-1}")
    
    if dry_run:
        console.print(f"\n[yellow]🧪 DRY RUN - No changes will be made[/yellow]")
        return
    
    # Confirm
    console.print(f"\n[red]⚠️  About to delete {stats['entities_to_delete']} duplicate entities[/red]")
    confirm = input("Continue? (yes/no): ")
    if confirm.lower() != 'yes':
        console.print("[yellow]❌ Aborted[/yellow]")
        return
    
    # Delete duplicates
    deleted_count = 0
    failed_count = 0
    
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console
    ) as progress:
        task = progress.add_task("[cyan]Deleting duplicates...", total=len(duplicates_to_delete))
        
        for entity in duplicates_to_delete:
            try:
                result = db.entities.delete_one({"_id": entity["_id"]})
                if result.deleted_count > 0:
                    deleted_count += 1
                else:
                    failed_count += 1
            except Exception as e:
                console.print(f"[red]❌ Error deleting {entity.get('name')}: {e}[/red]")
                failed_count += 1
            
            progress.advance(task)
    
    # Summary
    console.print("\n" + "=" * 60)
    console.print("[bold green]✅ Duplicate removal completed![/bold green]")
    console.print(f"  • Deleted: [green]{deleted_count}[/green]")
    console.print(f"  • Failed: [red]{failed_count}[/red]")
    console.print(f"  • Remaining entities: [cyan]{len(entities) - deleted_count}[/cyan]")
    console.print("=" * 60)


if __name__ == "__main__":
    import sys
    
    dry_run = "--dry-run" in sys.argv or "-d" in sys.argv
    
    console.print("[bold cyan]🧹 Remove Duplicate Entities Script[/bold cyan]")
    console.print("Removes duplicate entities (same name + city)\n")
    
    if dry_run:
        console.print("[yellow]Running in DRY RUN mode - no changes will be made[/yellow]\n")
    
    remove_duplicates(dry_run=dry_run)
