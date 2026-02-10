"""
Check if TESTE_NASA entries are duplicates or separate tests
"""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
import json

load_dotenv()

async def check_duplicates():
    mongo_uri = os.getenv('MONGODB_URL')
    db_name = os.getenv('MONGODB_DB_NAME')
    
    if not mongo_uri or not db_name:
        print("❌ MongoDB connection info not found")
        return
    
    client = AsyncIOMotorClient(mongo_uri)
    db = client[db_name]
    
    print("\n" + "="*80)
    print("🔍 CHECKING TESTE_NASA ENTRIES")
    print("="*80)
    
    # Find all entities with name TESTE_NASA
    entities = await db.entities.find({'name': 'TESTE_NASA'}).to_list(length=10)
    
    print(f"\n📊 Found {len(entities)} entity(ies) with name 'TESTE_NASA'\n")
    
    if len(entities) == 0:
        print("No TESTE_NASA entities found")
        client.close()
        return
    
    # Show detailed comparison
    for i, entity in enumerate(entities, 1):
        print(f"\n{'='*80}")
        print(f"ENTITY #{i}")
        print('='*80)
        print(f"  _id: {entity.get('_id')}")
        print(f"  entity_id: {entity.get('entity_id')}")
        print(f"  name: {entity.get('name')}")
        print(f"  status: {entity.get('status')}")
        print(f"  version: {entity.get('version')}")
        print(f"  createdAt: {entity.get('createdAt')}")
        print(f"  updatedAt: {entity.get('updatedAt')}")
        print(f"  createdBy: {entity.get('createdBy')}")
        
        # Data structure
        if 'data' in entity:
            data = entity['data']
            print(f"\n  📦 Data structure:")
            for key in data.keys():
                value = data[key]
                if isinstance(value, dict):
                    print(f"    {key}: dict with {len(value)} keys")
                    if value:
                        print(f"      → {list(value.keys())}")
                elif isinstance(value, list):
                    print(f"    {key}: list with {len(value)} items")
                else:
                    print(f"    {key}: {type(value).__name__}")
        
        # Metadata
        if 'metadata' in entity and entity['metadata']:
            print(f"\n  🏷️  Metadata: {len(entity['metadata'])} source(s)")
            for meta in entity['metadata']:
                print(f"    - type: {meta.get('type')}, source: {meta.get('source')}")
        else:
            print(f"\n  🏷️  Metadata: None")
        
        # Sync status
        if 'sync' in entity:
            sync = entity['sync']
            print(f"\n  🔄 Sync: status={sync.get('status')}")
        
        # Check for associated curations
        curation_count = await db.curations.count_documents({'entity_id': entity.get('entity_id')})
        print(f"\n  🎨 Associated curations: {curation_count}")
        
        if curation_count > 0:
            curations = await db.curations.find({'entity_id': entity.get('entity_id')}).to_list(length=10)
            for j, cur in enumerate(curations, 1):
                print(f"    #{j}: {cur.get('curation_id')}")
                print(f"        Notes: {cur.get('notes', {}).get('public', 'None')[:50]}...")
                print(f"        Categories: {list(cur.get('categories', {}).keys())}")
    
    # Analysis
    print(f"\n{'='*80}")
    print("📊 ANALYSIS")
    print('='*80)
    
    if len(entities) == 1:
        print("\n✅ Only ONE entity found - no duplicates")
    else:
        print(f"\n⚠️  Found {len(entities)} entities with same name")
        print("\n🔍 Checking if they are duplicates or separate entries:")
        
        # Compare entity_ids
        entity_ids = [e.get('entity_id') for e in entities]
        print(f"\n  Entity IDs:")
        for i, eid in enumerate(entity_ids, 1):
            print(f"    #{i}: {eid}")
        
        if len(set(entity_ids)) == len(entity_ids):
            print("\n  ✅ All entity_ids are DIFFERENT - these are separate entities")
        else:
            print("\n  ❌ Some entity_ids are DUPLICATED - database inconsistency!")
        
        # Compare timestamps
        print(f"\n  Creation times:")
        for i, entity in enumerate(entities, 1):
            print(f"    #{i}: {entity.get('createdAt')}")
        
        # Compare versions
        print(f"\n  Versions:")
        for i, entity in enumerate(entities, 1):
            print(f"    #{i}: {entity.get('version')}")
        
        # Recommendation
        print(f"\n{'='*80}")
        print("💡 RECOMMENDATION")
        print('='*80)
        
        if all(e.get('entity_id') != entities[0].get('entity_id') for e in entities[1:]):
            print("\n✅ These are SEPARATE test entities (different entity_ids)")
            print("\n   Options:")
            print("   1. Keep both if you want multiple test records")
            print("   2. Delete older ones if you only need the latest")
            print("   3. Rename one to distinguish them (e.g., 'TESTE_NASA_OLD')")
        else:
            print("\n❌ These appear to be DUPLICATES (need investigation)")
            print("   This might indicate a sync issue or data inconsistency")
    
    client.close()
    print(f"\n{'='*80}\n")

if __name__ == "__main__":
    asyncio.run(check_duplicates())
