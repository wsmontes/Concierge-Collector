"""
Delete orphaned curation that can't be synced due to schema mismatch

This curation was created during schema transition and has incompatible structure.
Deleting it allows frontend to create a fresh version with correct schema.
"""

import os
from pymongo import MongoClient

# MongoDB connection (fallback to production URI)
MONGODB_URI = os.getenv("MONGODB_URI") or os.getenv("MONGODB_URL") or \
    'mongodb+srv://wmontes_db_user:PL45tIzLV1weWHJW@concierge-collector.7bwiisy.mongodb.net/?retryWrites=true&w=majority&readPreference=secondaryPreferred'

print(f"📡 Connecting to MongoDB...")
client = MongoClient(MONGODB_URI)
db_name = os.getenv('MONGODB_DB_NAME', 'concierge-collector')
db = client[db_name]
print(f"📦 Using database: {db_name}")

# The problematic curation ID
CURATION_ID = "curation_1770710922071_i7qlrmwxp"

print(f"🔍 Looking for curation: {CURATION_ID}")

# Find the curation
curation = db.curations.find_one({"_id": CURATION_ID})

if not curation:
    print(f"✅ Curation {CURATION_ID} not found (already deleted or never existed)")
else:
    print(f"📋 Found curation:")
    print(f"   _id: {curation.get('_id')}")
    print(f"   curation_id: {curation.get('curation_id')}")
    print(f"   entity_id: {curation.get('entity_id', 'NOT SET')}")
    print(f"   entity__id: {curation.get('entity__id', 'NOT SET')}")
    print(f"   curator: {curation.get('curator', {}).get('id', 'NOT SET')}")
    
    # Delete it
    result = db.curations.delete_one({"_id": CURATION_ID})
    print(f"\n✅ Deleted {result.deleted_count} curation(s)")
    print(f"Frontend can now create fresh version with correct schema")

client.close()
