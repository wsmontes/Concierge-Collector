"""
Check for curation_id duplicate (different _id but same curation_id)
"""

import os
from pymongo import MongoClient

# MongoDB connection
MONGODB_URI = os.getenv("MONGODB_URI") or os.getenv("MONGODB_URL") or \
    'mongodb+srv://wmontes_db_user:PL45tIzLV1weWHJW@concierge-collector.7bwiisy.mongodb.net/?retryWrites=true&w=majority&readPreference=secondaryPreferred'

client = MongoClient(MONGODB_URI)
db_name = os.getenv('MONGODB_DB_NAME', 'concierge-collector')
db = client[db_name]

CURATION_ID = "curation_1770710922071_i7qlrmwxp"

print(f"📦 Database: {db_name}")
print(f"🔍 Checking for curation_id: {CURATION_ID}\n")

# Check for this curation_id in the unique index
result = db.curations.find_one({"curation_id": CURATION_ID})

if result:
    print("✅ FOUND curation with this curation_id!")
    print(f"\n_id field: {result.get('_id')}")
    print(f"curation_id field: {result.get('curation_id')}")
    print(f"entity_id: {result.get('entity_id', 'NOT SET')}")
    print(f"curator: {result.get('curator', {}).get('id',' NOT SET')}")
    
    print(f"\n🗑️  Deleting...")
    db.curations.delete_one({"_id": result["_id"]})
    print("✅ Deleted!")
else:
    print("❌ Curation not found")
    
    # List all curations
    print(f"\nTotal curations: {db.curations.count_documents({})}")
    print("\nAll curations (_id, curation_id):")
    for cur in db.curations.find({}, {"_id": 1, "curation_id": 1, "entity_id": 1}).limit(10):
        print(f"  _id: {cur.get('_id')}, curation_id: {cur.get('curation_id')}, entity_id: {cur.get('entity_id')}")

client.close()
