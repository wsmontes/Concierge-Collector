"""
Seed script for categories collection.
Populates MongoDB with concept categories for different entity types.

Usage:
    python scripts/seed_categories.py
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

CATEGORIES_DATA = [
    {
        "entity_type": "restaurant",
        "categories": [
            # Ambiance
            "modern", "traditional", "creative", "authentic", "innovative",
            "elegant", "casual", "intimate", "lively", "cozy", "upscale",
            
            # Audience
            "family_friendly", "romantic", "business", "trendy",
            
            # Service
            "impeccable_service", "friendly_service", "professional_service",
            
            # Value
            "great_value", "premium",
            
            # Food
            "local_ingredients", "seasonal", "organic", "farm_to_table",
            
            # Features
            "wine_focus", "cocktail_bar", "open_kitchen", "terrace",
            "historic_building", "contemporary_design", "minimalist",
            "michelin_star", "hidden_gem", "award_winning",
            
            # Additional
            "scenic_view", "waterfront", "garden", "rooftop"
        ],
        "description": "Concept categories for restaurant entities",
        "version": 1,
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": "system_seed",
        "active": True
    },
    {
        "entity_type": "bar",
        "categories": [
            # Type
            "speakeasy", "rooftop", "dive_bar", "cocktail_lounge",
            "sports_bar", "wine_bar", "craft_beer", "live_music",
            
            # Features
            "signature_cocktails", "extensive_wine_list", "craft_spirits",
            "happy_hour", "late_night", "dancefloor", "dj",
            
            # Ambiance
            "intimate", "lively", "trendy", "casual", "upscale",
            "cozy", "modern", "vintage", "industrial",
            
            # Crowd
            "locals", "tourists", "professionals", "students",
            
            # Additional
            "outdoor_seating", "scenic_view", "hidden_gem"
        ],
        "description": "Concept categories for bar entities",
        "version": 1,
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": "system_seed",
        "active": True
    },
    {
        "entity_type": "hotel",
        "categories": [
            # Type
            "boutique", "luxury", "budget", "business", "resort",
            "historic", "contemporary", "design_hotel",
            
            # Features
            "spa", "rooftop_pool", "gym", "restaurant", "bar",
            "conference_rooms", "concierge", "valet_parking",
            "room_service", "airport_shuttle",
            
            # Style
            "modern", "traditional", "minimalist", "art_deco",
            "colonial", "industrial", "elegant",
            
            # Location
            "city_center", "waterfront", "mountain", "beach",
            "countryside", "downtown",
            
            # Service
            "impeccable_service", "friendly_staff", "professional",
            
            # Additional
            "pet_friendly", "family_friendly", "romantic",
            "scenic_view", "award_winning"
        ],
        "description": "Concept categories for hotel entities",
        "version": 1,
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": "system_seed",
        "active": True
    },
    {
        "entity_type": "attraction",
        "categories": [
            # Type
            "historic", "cultural", "museum", "gallery", "monument",
            "religious", "architecture", "natural", "park",
            
            # Features
            "unesco", "free_entry", "guided_tours", "audio_guide",
            "wheelchair_accessible", "family_friendly",
            
            # Experience
            "educational", "interactive", "scenic", "photo_spot",
            "must_see", "hidden_gem", "off_the_beaten_path",
            
            # Crowd
            "popular", "quiet", "crowded", "peaceful",
            
            # Additional
            "indoor", "outdoor", "seasonal", "year_round",
            "best_at_sunrise", "best_at_sunset", "night_visit"
        ],
        "description": "Concept categories for attraction entities",
        "version": 1,
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": "system_seed",
        "active": True
    }
]


async def seed_categories():
    """Seed categories collection"""
    # Connect to MongoDB
    mongo_url = os.getenv("MONGODB_URL")
    if not mongo_url:
        print("❌ MONGODB_URL not found in .env")
        return
    
    client = AsyncIOMotorClient(mongo_url)
    db_name = os.getenv("MONGODB_DB_NAME", "concierge-collector")
    db = client[db_name]
    
    print("🌱 Seeding categories collection...")
    
    # Clear existing data (optional - comment out to preserve)
    # await db.categories.delete_many({})
    # print("   Cleared existing categories")
    
    # Insert categories
    for category_data in CATEGORIES_DATA:
        entity_type = category_data["entity_type"]
        
        # Check if already exists
        existing = await db.categories.find_one({"entity_type": entity_type})
        
        if existing:
            # Update existing
            result = await db.categories.update_one(
                {"entity_type": entity_type},
                {
                    "$set": category_data,
                    "$inc": {"version": 1}
                }
            )
            print(f"   ✅ Updated {entity_type}: {len(category_data['categories'])} categories")
        else:
            # Insert new
            result = await db.categories.insert_one(category_data)
            print(f"   ✅ Inserted {entity_type}: {len(category_data['categories'])} categories")
    
    # Create index on entity_type
    await db.categories.create_index("entity_type", unique=True)
    print("   ✅ Created index on entity_type")
    
    # Display summary
    total_docs = await db.categories.count_documents({})
    print(f"\n📊 Summary: {total_docs} entity types with categories")
    
    # List all categories
    cursor = db.categories.find({})
    async for doc in cursor:
        print(f"   • {doc['entity_type']}: {len(doc['categories'])} concepts")
    
    client.close()
    print("\n✅ Categories seeding complete!")


if __name__ == "__main__":
    asyncio.run(seed_categories())
