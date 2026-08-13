"""
Check indexes on curations collection to understand duplicate key error
"""

import os
from pymongo import MongoClient

# MongoDB connection
MONGODB_URI = os.getenv("MONGODB_URI") or os.getenv("MONGODB_URL") or \
    'mongodb+srv://wmontes_db_user:PL45tIzLV1weWHJW@concierge-collector.7bwiisy.mongodb.net/?retryWrites=true&w=majority&readPreference=secondaryPreferred'

client = MongoClient(MONGODB_URI)
db_name = os.getenv('MONGODB_DB_NAME', 'concierge-collector')
db = client[db_name]

print(f"📦 Using database: {db_name}")
print("📋 Indexes on curations collection:")
print("=" * 60)

for index in db.curations.list_indexes():
    print(f"\nIndex: {index['name']}")
    print(f"  Keys: {index['key']}")
    print(f"  Unique: {index.get('unique', False)}")
    if 'sparse' in index:
        print(f"  Sparse: {index['sparse']}")

print("\n" + "=" * 60)

# Check for any curations with this curation_id
CURATION_ID = "curation_1770710922071_i7qlrmwxp"
print(f"\n🔍 Searching for any curation with curation_id: {CURATION_ID}")

# Try different field names
queries = [
    {"_id": CURATION_ID},
    {"curation_id": CURATION_ID},
]

for query in queries:
    result = db.curations.find_one(query)
    if result:
        print(f"\n✅ Found with query: {query}")
        print(f"   _id: {result.get('_id')}")
        print(f"   curation_id: {result.get('curation_id', 'NOT SET')}")
        print(f"   entity_id: {result.get('entity_id', 'NOT SET')}")
        print(f"   entity__id: {result.get('entity__id', 'NOT SET')}")
        break
else:
    print(f"❌ Not found with any query")

client.close()
