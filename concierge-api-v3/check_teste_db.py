"""
Check if TESTE_DB restaurant was saved to MongoDB
"""
import sys
import os
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.config import settings

async def check_teste_db():
    """Check if TESTE_DB exists in MongoDB"""
    
    # Connect to MongoDB
    client = AsyncIOMotorClient(settings.mongodb_url)
    db = client[settings.mongodb_db_name]
    
    try:
        # Search for entity with name TESTE_DB
        entity = await db.entities.find_one({"name": "TESTE_DB"})
        
        if entity:
            print("✅ TESTE_DB encontrado no MongoDB!")
            print(f"\n📋 Documento completo:")
            
            # Remove _id para melhor visualização
            entity_copy = dict(entity)
            if '_id' in entity_copy:
                entity_copy['_id'] = str(entity_copy['_id'])
            
            import json
            print(json.dumps(entity_copy, indent=2, default=str))
            
            return True
        else:
            print("❌ TESTE_DB não encontrado no MongoDB")
            
            # Search for recent entities
            print("\n🔍 Últimas 5 entidades criadas:")
            cursor = db.entities.find().sort("created_at", -1).limit(5)
            async for doc in cursor:
                print(f"  - {doc.get('name')} ({doc.get('entity_id')})")
            
            return False
            
    finally:
        client.close()

if __name__ == "__main__":
    result = asyncio.run(check_teste_db())
    sys.exit(0 if result else 1)
