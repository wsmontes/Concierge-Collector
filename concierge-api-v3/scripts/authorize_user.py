import asyncio
import sys
import os
from motor.motor_asyncio import AsyncIOMotorClient

# Add parent directory to path to import app modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings

async def authorize_user(email):
    print(f"Connecting to MongoDB at {settings.mongodb_url}...")
    client = AsyncIOMotorClient(settings.mongodb_url)
    db = client[settings.mongodb_db_name]
    
    print(f"Searching for user with email: {email}")
    user = await db.users.find_one({"email": email})
    
    if user:
        print(f"User found: {user.get('name')} (Current status: authorized={user.get('authorized')})")
        result = await db.users.update_one(
            {"email": email},
            {"$set": {"authorized": True}}
        )
        print(f"User authorized successfully! Modified count: {result.modified_count}")
    else:
        print("User not found. Please login once to create the user record, then run this script again.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python authorize_user.py <email>")
        sys.exit(1)
    
    email = sys.argv[1]
    asyncio.run(authorize_user(email))
