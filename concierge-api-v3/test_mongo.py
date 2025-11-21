"""Test MongoDB Atlas connection"""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os

load_dotenv()

async def test_connection():
    mongodb_url = os.getenv('MONGODB_URL')
    print(f"Testing connection to: {mongodb_url[:50]}...")
    
    try:
        client = AsyncIOMotorClient(
            mongodb_url,
            serverSelectionTimeoutMS=30000,
            connectTimeoutMS=30000,
            socketTimeoutMS=30000,
            retryWrites=True,
            retryReads=True,
            tls=True
        )
        
        # Test connection
        await client.admin.command('ping')
        print("✅ MongoDB connection successful!")
        
        # List databases
        dbs = await client.list_database_names()
        print(f"📦 Available databases: {dbs}")
        
        # Check concierge-collector database
        db = client['concierge-collector']
        collections = await db.list_collection_names()
        print(f"📁 Collections in concierge-collector: {collections}")
        
        client.close()
        
    except Exception as e:
        print(f"❌ MongoDB connection failed!")
        print(f"Error: {e}")
        print("\n💡 Possible solutions:")
        print("   1. Go to MongoDB Atlas → Network Access")
        print("   2. Add your current IP or allow 0.0.0.0/0")
        print("   3. Check firewall/antivirus settings")

if __name__ == "__main__":
    asyncio.run(test_connection())
