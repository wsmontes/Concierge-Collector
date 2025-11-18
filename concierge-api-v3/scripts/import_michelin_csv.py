"""
Michelin CSV Import Script

Imports Michelin restaurant data from CSV files into MongoDB.
Creates both Entity and Metadata (michelin) documents with deduplication.

Usage:
    python scripts/import_michelin_csv.py

Features:
- Processes all CSV files in data/csv directory
- Creates Entity documents with Michelin metadata
- Handles duplicates by name + location
- Geocoding from coordinates
- Parses all available fields (cuisine, price, awards, facilities)
- Generates entity_id from name
- Dry-run mode for testing
"""

import csv
import os
import re
import asyncio
from pathlib import Path
from datetime import datetime, UTC
from typing import Dict, List, Optional, Any
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.config import settings


def slugify(text: str) -> str:
    """Convert text to URL-friendly slug"""
    text = text.lower()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '_', text)
    return text.strip('_')


def parse_award(award_text: str) -> Dict[str, Any]:
    """Parse Michelin award text into structured data"""
    if not award_text or award_text == 'n/a':
        return {"type": "listed", "stars": 0}
    
    award_lower = award_text.lower()
    
    if "3 michelin star" in award_lower:
        return {"type": "stars", "stars": 3, "raw": award_text}
    elif "2 michelin star" in award_lower:
        return {"type": "stars", "stars": 2, "raw": award_text}
    elif "1 michelin star" in award_lower:
        return {"type": "stars", "stars": 1, "raw": award_text}
    elif "bib gourmand" in award_lower:
        return {"type": "bib_gourmand", "stars": 0, "raw": award_text}
    elif "green star" in award_lower:
        return {"type": "green_star", "stars": 0, "raw": award_text}
    else:
        return {"type": "listed", "stars": 0, "raw": award_text}


def parse_facilities(facilities_text: str) -> List[str]:
    """Parse facilities CSV string into list"""
    if not facilities_text or facilities_text == 'n/a':
        return []
    
    facilities = [f.strip() for f in facilities_text.split(',')]
    return [f for f in facilities if f]


def generate_entity_id(name: str, location: str) -> str:
    """Generate unique entity_id from name and location"""
    name_slug = slugify(name)
    location_slug = slugify(location.split(',')[0])  # Use city only
    
    # Limit length
    if len(name_slug) > 30:
        name_slug = name_slug[:30]
    
    return f"rest_{name_slug}_{location_slug}"


def parse_phone(phone_text: str) -> Optional[str]:
    """Parse phone number from scientific notation or text"""
    if not phone_text or phone_text == 'n/a':
        return None
    
    try:
        # Handle scientific notation (e.g., 5.52135E+11)
        if 'E+' in phone_text or 'e+' in phone_text:
            phone_num = float(phone_text)
            return f"+{int(phone_num)}"
        return phone_text
    except:
        return phone_text if phone_text != 'n/a' else None


async def load_csv_file(file_path: Path) -> List[Dict[str, str]]:
    """Load CSV file and return list of dictionaries"""
    restaurants = []
    
    print(f"\n📖 Reading: {file_path.name}")
    
    with open(file_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            restaurants.append(row)
    
    print(f"   Found {len(restaurants)} restaurants")
    return restaurants


async def check_duplicate(
    db: AsyncIOMotorDatabase,
    name: str,
    location: str
) -> Optional[Dict[str, Any]]:
    """Check if entity already exists by name and location"""
    # Try exact match first
    entity = await db.entities.find_one({
        "name": name,
        "data.location.city": {"$regex": location.split(',')[0], "$options": "i"}
    })
    
    if entity:
        return entity
    
    # Try fuzzy match (same entity_id)
    entity_id = generate_entity_id(name, location)
    entity = await db.entities.find_one({"entity_id": entity_id})
    
    return entity


async def create_entity_from_csv(
    db: AsyncIOMotorDatabase,
    row: Dict[str, str],
    source_file: str,
    dry_run: bool = False
) -> Dict[str, Any]:
    """Create Entity document from CSV row"""
    
    name = row.get('NAME', '').strip()
    location = row.get('Location', '').strip()
    address = row.get('Address', '').strip()
    
    if not name or not location:
        return {"status": "skipped", "reason": "Missing name or location"}
    
    # Check for duplicates
    existing = await check_duplicate(db, name, location)
    if existing:
        return {
            "status": "duplicate",
            "entity_id": existing.get('entity_id'),
            "name": name,
            "_id": str(existing.get('_id'))
        }
    
    # Generate entity_id
    entity_id = generate_entity_id(name, location)
    
    # Parse coordinates
    try:
        lat = float(row.get('Latitude', 0))
        lng = float(row.get('Longitude', 0))
    except (ValueError, TypeError):
        lat = lng = 0
    
    # Parse award
    award = parse_award(row.get('Award', ''))
    
    # Parse cuisine
    cuisine = row.get('Cuisine', '').strip()
    cuisines = [c.strip() for c in cuisine.split(',')] if cuisine and cuisine != 'n/a' else []
    
    # Parse facilities
    facilities = parse_facilities(row.get('FacilitiesAndServices', ''))
    
    # Parse phone
    phone = parse_phone(row.get('PhoneNumber', ''))
    
    # Build entity document
    entity_doc = {
        "entity_id": entity_id,
        "type": "restaurant",
        "name": name,
        "status": "active",
        "externalId": None,  # No Google Place ID from Michelin
        "metadata": [
            {
                "type": "michelin",
                "source": "Michelin Guide CSV Import",
                "importedAt": datetime.now(UTC),
                "data": {
                    "award": award,
                    "review": row.get('REVIEW', '').strip(),
                    "url": row.get('URL', '').strip(),
                    "guide_url": row.get('Url2', '').strip(),
                    "facilities": facilities,
                    "import_source": source_file,
                    "csv_index": row.get('INDEX', '')
                }
            }
        ],
        "data": {
            "location": {
                "address": address,
                "city": location.split(',')[0].strip() if ',' in location else location,
                "country": location.split(',')[-1].strip() if ',' in location else '',
                "coordinates": {
                    "lat": lat,
                    "lng": lng
                } if lat and lng else None
            },
            "contacts": {
                "phone": phone,
                "website": row.get('WebsiteUrl', '').strip() if row.get('WebsiteUrl', '').strip() != 'n/a' else None
            },
            "attributes": {
                "cuisine": cuisines,
                "price_range": row.get('Price', '').strip() if row.get('Price', '').strip() != 'n/a' else None,
                "michelin_award": award.get('type'),
                "michelin_stars": award.get('stars', 0),
                "facilities": facilities
            }
        },
        "createdAt": datetime.now(UTC),
        "updatedAt": datetime.now(UTC),
        "createdBy": "michelin_import_script",
        "updatedBy": None,
        "version": 1
    }
    
    if dry_run:
        return {
            "status": "dry_run",
            "entity_id": entity_id,
            "name": name,
            "award": award.get('type'),
            "stars": award.get('stars', 0)
        }
    
    # Insert into MongoDB
    result = await db.entities.insert_one(entity_doc)
    
    return {
        "status": "created",
        "entity_id": entity_id,
        "name": name,
        "_id": str(result.inserted_id),
        "award": award.get('type'),
        "stars": award.get('stars', 0)
    }


async def import_csv_files(dry_run: bool = False):
    """Main import function"""
    
    # Connect to MongoDB
    client = AsyncIOMotorClient(settings.mongodb_url)
    db = client[settings.mongodb_db_name]
    
    print("🔌 Connected to MongoDB")
    print(f"📁 Database: {settings.mongodb_db_name}")
    print(f"🧪 Dry run: {dry_run}")
    print("=" * 60)
    
    # Find CSV files
    csv_dir = Path(__file__).parent.parent.parent / "data" / "csv"
    csv_files = list(csv_dir.glob("*.csv"))
    
    if not csv_files:
        print(f"❌ No CSV files found in {csv_dir}")
        return
    
    print(f"📂 Found {len(csv_files)} CSV files")
    
    # Statistics
    stats = {
        "total": 0,
        "created": 0,
        "duplicates": 0,
        "skipped": 0,
        "errors": 0,
        "by_award": {},
        "by_file": {}
    }
    
    # Process each file
    for csv_file in csv_files:
        file_stats = {
            "created": 0,
            "duplicates": 0,
            "skipped": 0,
            "errors": 0
        }
        
        restaurants = await load_csv_file(csv_file)
        stats["total"] += len(restaurants)
        
        for row in restaurants:
            try:
                result = await create_entity_from_csv(db, row, csv_file.name, dry_run)
                
                status = result.get("status")
                if status == "created" or status == "dry_run":
                    file_stats["created"] += 1
                    stats["created"] += 1
                    
                    # Track by award type
                    award_type = result.get("award", "listed")
                    stats["by_award"][award_type] = stats["by_award"].get(award_type, 0) + 1
                    
                    print(f"   ✅ {result['name']} ({award_type})")
                    
                elif status == "duplicate":
                    file_stats["duplicates"] += 1
                    stats["duplicates"] += 1
                    print(f"   ⚠️  DUPLICATE: {result['name']}")
                    
                elif status == "skipped":
                    file_stats["skipped"] += 1
                    stats["skipped"] += 1
                    print(f"   ⏭️  SKIPPED: {result.get('reason')}")
                    
            except Exception as e:
                file_stats["errors"] += 1
                stats["errors"] += 1
                print(f"   ❌ ERROR: {row.get('NAME', 'Unknown')}: {e}")
        
        stats["by_file"][csv_file.name] = file_stats
        print(f"\n   📊 {csv_file.name}: {file_stats['created']} created, {file_stats['duplicates']} duplicates")
    
    # Print final statistics
    print("\n" + "=" * 60)
    print("📊 IMPORT STATISTICS")
    print("=" * 60)
    print(f"Total restaurants processed: {stats['total']}")
    print(f"✅ Created: {stats['created']}")
    print(f"⚠️  Duplicates: {stats['duplicates']}")
    print(f"⏭️  Skipped: {stats['skipped']}")
    print(f"❌ Errors: {stats['errors']}")
    
    if stats["by_award"]:
        print("\n🏆 By Award Type:")
        for award, count in sorted(stats["by_award"].items(), key=lambda x: x[1], reverse=True):
            print(f"   {award}: {count}")
    
    print("\n📁 By File:")
    for file_name, file_stats in stats["by_file"].items():
        print(f"   {file_name}: {file_stats['created']} created")
    
    # Close connection
    client.close()
    print("\n✅ Import complete!")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Import Michelin CSV data to MongoDB")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Test run without writing to database"
    )
    
    args = parser.parse_args()
    
    asyncio.run(import_csv_files(dry_run=args.dry_run))
