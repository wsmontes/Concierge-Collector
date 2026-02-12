
import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

async def check_configs():
    mongo_url = os.getenv("MONGODB_URL")
    if not mongo_url:
        print("MONGODB_URL not found")
        return

    client = AsyncIOMotorClient(mongo_url)
    db = client["concierge-collector"]
    
    config = await db.openai_configs.find_one({"service": "image_analysis"})
    
    if config:
        print("✅ image_analysis config found!")
        print(f"Model: {config.get('model')}")
        if config.get('model') == 'gpt-4o':
             print("✅ Model is correctly set to gpt-4o")
        else:
             print(f"❌ Model mismatch! Expected gpt-4o, got {config.get('model')}")
    else:
        print("❌ image_analysis config NOT found")

if __name__ == "__main__":
    asyncio.run(check_configs())
