#!/usr/bin/env python3
"""
Check curations in MongoDB database
Run this to verify if curations exist on the server
"""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from datetime import datetime

async def check_curations():
    """Check if curations exist in MongoDB"""
    
    # Get MongoDB URI from environment or use default
    mongo_uri = os.getenv('MONGODB_URI') or os.getenv('MONGODB_URL')
    if not mongo_uri:
        # Use the production MongoDB URI
        mongo_uri = 'mongodb+srv://wmontes_db_user:PL45tIzLV1weWHJW@concierge-collector.7bwiisy.mongodb.net/?retryWrites=true&w=majority&readPreference=secondaryPreferred'
        print("ℹ️ Using production MongoDB URI")
    
    print("🔍 Checking MongoDB for curations...")
    print(f"MongoDB URI: {mongo_uri[:50]}...")
    
    try:
        # Connect to MongoDB
        client = AsyncIOMotorClient(mongo_uri)
        # Use the correct database name from settings
        db_name = os.getenv('MONGODB_DB_NAME', 'concierge-collector')
        db = client[db_name]
        print(f"Using database: {db_name}")
        
        # Check curations collection
        print("\n📋 Checking curations collection:")
        curations_count = await db.curations.count_documents({})
        print(f"  Total curations: {curations_count}")
        
        if curations_count > 0:
            print("\n✅ Curations exist in database!")
            
            # Get some examples
            print("\n📄 First 5 curations:")
            async for curation in db.curations.find().limit(5):
                print(f"  - {curation.get('curation_id')}")
                print(f"    Entity: {curation.get('entity_id')}")
                print(f"    Category: {curation.get('category')}")
                print(f"    Curator: {curation.get('curator_id')}")
                print()
            
            # Check TESTE_NASA specifically
            print("\n🔍 Checking TESTE_NASA curations:")
            teste_nasa_curations = await db.curations.find({
                'entity_id': 'rest_teste_nasa_1770698630896'
            }).to_list(length=10)
            
            if teste_nasa_curations:
                print(f"✅ Found {len(teste_nasa_curations)} curation(s) for TESTE_NASA:")
                for c in teste_nasa_curations:
                    print(f"  - {c.get('curation_id')}: {c.get('category')} / {c.get('concept')}")
            else:
                print("❌ No curations found for TESTE_NASA")
                
        else:
            print("\n❌ NO CURATIONS IN DATABASE!")
            print("The curations collection is empty.")
            print("\n🚨 POSSIBLE CAUSES:")
            print("  1. Database was reset/cleared")
            print("  2. Curations were deleted")
            print("  3. Migration failed")
            print("  4. Wrong database connection")
        
        # Check entities for comparison
        print("\n📊 Checking entities for comparison:")
        entities_count = await db.entities.count_documents({})
        print(f"  Total entities: {entities_count}")
        
        # Check TESTE entities
        teste_entities = await db.entities.find({
            'name': {'$regex': 'TESTE', '$options': 'i'}
        }).to_list(length=20)
        
        if teste_entities:
            print(f"\n✅ Found {len(teste_entities)} TESTE entity(ies):")
            for e in teste_entities:
                print(f"  - {e.get('name')} ({e.get('entity_id')})")
        
        # Close connection
        client.close()
        
    except Exception as e:
        print(f"\n❌ Error accessing MongoDB: {e}")
        print(f"Error type: {type(e).__name__}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(check_curations())
