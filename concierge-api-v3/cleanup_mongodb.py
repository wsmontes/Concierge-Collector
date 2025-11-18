"""
MongoDB Atlas Cleanup Script
Removes legacy V3 and V4 collections from the database
"""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

MONGODB_URL = os.getenv('MONGODB_URL')
MONGODB_DB_NAME = os.getenv('MONGODB_DB_NAME', 'concierge-collector')

async def cleanup_mongodb():
    """Remove legacy collections from MongoDB Atlas"""
    print("🔄 Connecting to MongoDB Atlas...")
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client[MONGODB_DB_NAME]
    
    try:
        # List all collections
        collections = await db.list_collection_names()
        print(f"\n📋 Current collections: {collections}")
        
        # Collections to remove
        legacy_collections = ['entities_v3', 'curations_v3']
        
        for collection_name in legacy_collections:
            if collection_name in collections:
                print(f"\n🗑️  Dropping collection: {collection_name}")
                await db.drop_collection(collection_name)
                print(f"✅ Dropped: {collection_name}")
            else:
                print(f"⏭️  Collection not found: {collection_name}")
        
        # List collections after cleanup
        collections_after = await db.list_collection_names()
        print(f"\n📋 Collections after cleanup: {collections_after}")
        
        # Show document counts for remaining collections
        print("\n📊 Document counts:")
        for coll in collections_after:
            count = await db[coll].count_documents({})
            print(f"  - {coll}: {count} documents")
        
        print("\n✅ MongoDB cleanup complete!")
        
    except Exception as e:
        print(f"\n❌ Error during cleanup: {e}")
        raise
    finally:
        client.close()

async def cleanup_v4_database():
    """Remove the entire concierge_collector_v4 database if it exists"""
    print("\n🔄 Checking for V4 database...")
    client = AsyncIOMotorClient(MONGODB_URL)
    
    try:
        # List all databases
        databases = await client.list_database_names()
        print(f"📋 Available databases: {databases}")
        
        if 'concierge_collector_v4' in databases:
            print("\n🗑️  Dropping V4 database: concierge_collector_v4")
            await client.drop_database('concierge_collector_v4')
            print("✅ V4 database dropped")
        else:
            print("⏭️  No V4 database found")
            
    except Exception as e:
        print(f"\n❌ Error during V4 cleanup: {e}")
    finally:
        client.close()

async def main():
    """Main cleanup function"""
    print("=" * 60)
    print("MongoDB Atlas Cleanup - Remove Legacy Collections")
    print("=" * 60)
    
    # Cleanup legacy collections in current database
    await cleanup_mongodb()
    
    # Cleanup V4 database
    await cleanup_v4_database()
    
    print("\n" + "=" * 60)
    print("Cleanup completed successfully!")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())
