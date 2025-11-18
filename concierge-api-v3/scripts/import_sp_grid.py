#!/usr/bin/env python3
"""
São Paulo Grid Import - Systematic geographic coverage for 1000+ restaurants

Uses the enhanced find_restaurants.py with custom coordinates to systematically
cover São Paulo with a geographic grid, avoiding the previous hardcoded coordinate issue.

Strategy:
- 50+ geographic points covering all São Paulo zones
- 2-3km radius per point for good coverage without excessive overlap
- ~15-20 restaurants per point = 750-1000 total unique restaurants
- Automatic deduplication via API

Author: Restaurant Finder CLI
Date: 2025-11-18
"""

import subprocess
import time
import sys
from typing import List, Tuple
from pathlib import Path

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from rich.panel import Panel
from rich.table import Table

console = Console()

# API Configuration
API_KEY = "7AxYmOWqcVoSUylQQ3do5_nHAf9Fxh4i7-EhD-2wxoc"
SCRIPT_PATH = Path(__file__).parent / "find_restaurants.py"
PYTHON_PATH = Path(__file__).parent.parent / "venv" / "bin" / "python"

# Grid configuration
RADIUS = 2500  # 2.5km radius per point
MIN_RATING = 3.8  # Slightly lower to get more variety
LIMIT_PER_POINT = 20  # Max from API
DELAY_BETWEEN_REQUESTS = 0.5  # seconds


# São Paulo Grid - 50 points covering ~1500 km²
# Organized by zones for systematic coverage
SAO_PAULO_GRID: List[Tuple[float, float, str]] = [
    # CENTRO (8 points)
    (-23.5505, -46.6333, "Sé - Centro Histórico"),
    (-23.5489, -46.6388, "República"),
    (-23.5464, -46.6398, "Bom Retiro"),
    (-23.5447, -46.6270, "Brás"),
    (-23.5278, -46.6353, "Pari"),
    (-23.5450, -46.6520, "Santa Cecília"),
    (-23.5380, -46.6450, "Campos Elíseos"),
    (-23.5520, -46.6200, "Mooca Centro"),
    
    # ZONA OESTE (10 points)
    (-23.5647, -46.6962, "Pinheiros"),
    (-23.5477, -46.6887, "Vila Madalena"),
    (-23.5367, -46.7081, "Lapa"),
    (-23.5513, -46.7310, "Butantã"),
    (-23.5782, -46.7185, "Vila Sônia"),
    (-23.5589, -46.7456, "Morumbi"),
    (-23.5425, -46.7025, "Água Branca"),
    (-23.5295, -46.6945, "Barra Funda"),
    (-23.5615, -46.6825, "Vila Leopoldina"),
    (-23.5520, -46.7180, "Alto de Pinheiros"),
    
    # ZONA SUL (12 points)
    (-23.5947, -46.6870, "Vila Mariana"),
    (-23.6057, -46.6631, "Saúde"),
    (-23.6204, -46.6569, "Jabaquara"),
    (-23.5950, -46.6437, "Ipiranga"),
    (-23.6503, -46.6582, "Santo Amaro"),
    (-23.5884, -46.6740, "Moema"),
    (-23.6061, -46.6966, "Brooklin"),
    (-23.5827, -46.6844, "Vila Olímpia"),
    (-23.5986, -46.6905, "Itaim Bibi"),
    (-23.5736, -46.6888, "Jardins"),
    (-23.5643, -46.6742, "Jardim Paulista"),
    (-23.6150, -46.7020, "Campo Belo"),
    
    # ZONA LESTE (10 points)
    (-23.5505, -46.6163, "Mooca"),
    (-23.5272, -46.5767, "Tatuapé"),
    (-23.5429, -46.5397, "Penha"),
    (-23.5208, -46.4756, "São Miguel"),
    (-23.5615, -46.5238, "Vila Prudente"),
    (-23.5883, -46.5656, "São Caetano (divisa)"),
    (-23.5350, -46.5950, "Belém"),
    (-23.5180, -46.5320, "Vila Matilde"),
    (-23.5450, -46.4920, "Itaquera"),
    (-23.5620, -46.4650, "Guaianases"),
    
    # ZONA NORTE (10 points)
    (-23.5158, -46.6289, "Santana"),
    (-23.4988, -46.6184, "Tucuruvi"),
    (-23.4796, -46.6177, "Mandaqui"),
    (-23.4625, -46.6456, "Casa Verde"),
    (-23.5129, -46.6724, "Barra Funda Norte"),
    (-23.4841, -46.6932, "Freguesia do Ó"),
    (-23.4693, -46.7380, "Pirituba"),
    (-23.5050, -46.6550, "Vila Guilherme"),
    (-23.4900, -46.6320, "Vila Maria"),
    (-23.4750, -46.5880, "Jaçanã"),
]


def run_import_at_point(
    lat: float, 
    lng: float, 
    location_name: str,
    dry_run: bool = False
) -> dict:
    """Run restaurant import at a single geographic point"""
    
    cmd = [
        str(PYTHON_PATH),
        str(SCRIPT_PATH),
        "--coordinates", str(lat), str(lng),
        "--radius", str(RADIUS),
        "--limit", str(LIMIT_PER_POINT),
        "--min-rating", str(MIN_RATING),
        "--api-key", API_KEY,
        "--no-details"  # Faster import
    ]
    
    if dry_run:
        cmd.append("--dry-run")
    
    try:
        # Run with auto-confirm (yes to import prompt)
        result = subprocess.run(
            cmd,
            input="y\n",
            capture_output=True,
            text=True,
            timeout=120
        )
        
        output = result.stdout
        
        # Parse statistics from output
        created = 0
        duplicates = 0
        errors = 0
        
        if "Created:" in output:
            try:
                created = int(output.split("Created: ")[1].split()[0])
            except:
                pass
        
        if "Duplicates:" in output:
            try:
                duplicates = int(output.split("Duplicates: ")[1].split()[0])
            except:
                pass
        
        if "Errors:" in output:
            try:
                errors = int(output.split("Errors: ")[1].split()[0])
            except:
                pass
        
        return {
            "success": result.returncode == 0,
            "created": created,
            "duplicates": duplicates,
            "errors": errors,
            "location": location_name
        }
        
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "created": 0,
            "duplicates": 0,
            "errors": 1,
            "location": location_name,
            "error": "Timeout"
        }
    except Exception as e:
        return {
            "success": False,
            "created": 0,
            "duplicates": 0,
            "errors": 1,
            "location": location_name,
            "error": str(e)
        }


def main():
    """Main import orchestration"""
    
    # Parse arguments
    dry_run = "--dry-run" in sys.argv
    test_mode = "--test" in sys.argv
    
    # Select grid points
    grid = SAO_PAULO_GRID[:10] if test_mode else SAO_PAULO_GRID
    
    # Display header
    console.print("\n")
    console.print(Panel.fit(
        f"[bold cyan]🗺️  São Paulo Grid Import[/bold cyan]\n"
        f"Points: [yellow]{len(grid)}[/yellow] | "
        f"Radius: [blue]{RADIUS}m[/blue] | "
        f"Estimated: [green]~{len(grid) * 15}[/green] restaurants"
        f"{' | [magenta]TEST MODE[/magenta]' if test_mode else ''}",
        border_style="cyan"
    ))
    
    if dry_run:
        console.print("[yellow]🧪 DRY RUN MODE - No entities will be created[/yellow]\n")
    elif test_mode:
        console.print("[magenta]🧪 TEST MODE - Only first 10 points[/magenta]\n")
    else:
        console.print("[yellow]⚠️  This will import restaurants into the database![/yellow]")
        confirm = input("Continue? (y/N): ")
        if confirm.lower() != 'y':
            console.print("[yellow]Cancelled[/yellow]")
            return 0
        console.print()
    
    # Statistics
    total_created = 0
    total_duplicates = 0
    total_errors = 0
    failed_points = []
    
    # Progress tracking
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console
    ) as progress:
        
        task = progress.add_task(
            "[cyan]Importing from grid points...",
            total=len(grid)
        )
        
        for i, (lat, lng, location_name) in enumerate(grid, 1):
            progress.update(
                task,
                description=f"[cyan]{i}/{len(grid)}: {location_name}"
            )
            
            result = run_import_at_point(lat, lng, location_name, dry_run)
            
            total_created += result["created"]
            total_duplicates += result["duplicates"]
            total_errors += result["errors"]
            
            if not result["success"]:
                failed_points.append(location_name)
            
            progress.advance(task)
            
            # Rate limiting
            if i < len(grid):
                time.sleep(DELAY_BETWEEN_REQUESTS)
    
    # Final statistics
    console.print("\n")
    console.print(Panel.fit(
        f"[bold green]✅ Grid Import Complete![/bold green]\n\n"
        f"✅ Created: [green]{total_created}[/green]\n"
        f"⚠️  Duplicates: [yellow]{total_duplicates}[/yellow]\n"
        f"❌ Errors: [red]{total_errors}[/red]\n"
        f"📍 Points Processed: [cyan]{len(grid)}[/cyan]\n"
        f"🍽️  Total Found: [magenta]{total_created + total_duplicates}[/magenta]",
        border_style="green"
    ))
    
    if failed_points:
        console.print("\n[yellow]⚠️  Failed points:[/yellow]")
        for point in failed_points:
            console.print(f"   • {point}")
    
    # Show database count
    if not dry_run:
        console.print("\n[cyan]📊 Checking database count...[/cyan]")
        try:
            import subprocess
            result = subprocess.run(
                [
                    str(PYTHON_PATH), "-c",
                    "from pymongo import MongoClient; import os; from dotenv import load_dotenv; "
                    "load_dotenv(); client = MongoClient(os.getenv('MONGODB_URL')); "
                    "db = client[os.getenv('MONGODB_DB_NAME')]; "
                    "print(db.entities.count_documents({'createdBy': 'restaurant_finder_cli'}))"
                ],
                capture_output=True,
                text=True,
                cwd=Path(__file__).parent.parent
            )
            count = int(result.stdout.strip())
            console.print(f"[bold]🎯 Total in Database: [green]{count}[/green] restaurants[/bold]\n")
        except:
            console.print("[yellow]⚠️  Could not verify database count[/yellow]\n")
    
    return 0


if __name__ == "__main__":
    try:
        exit_code = main()
        sys.exit(exit_code)
    except KeyboardInterrupt:
        console.print("\n[yellow]⚠️  Cancelled by user[/yellow]")
        sys.exit(1)
    except Exception as e:
        console.print(f"\n[red]❌ Fatal error: {e}[/red]")
        import traceback
        console.print(f"[dim]{traceback.format_exc()}[/dim]")
        sys.exit(1)
