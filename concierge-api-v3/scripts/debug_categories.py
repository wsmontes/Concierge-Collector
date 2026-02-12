
import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

async def list_cats():
    mongo_url = os.getenv("MONGODB_URL")
    if not mongo_url:
        print("MONGODB_URL not found")
        return

    client = AsyncIOMotorClient(mongo_url)
    db = client["concierge-collector"]
    
    doc = await db.categories.find_one({"entity_type": "restaurant", "active": True})
    
    if doc and doc.get("categories"):
        cats = doc["categories"]
        print(f"✅ Found {len(cats)} categories")
        print("Sample:", cats[:20])
    else:
        print("❌ No categories found for 'restaurant'")

if __name__ == "__main__":
    asyncio.run(list_cats())
