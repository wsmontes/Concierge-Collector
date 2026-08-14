"""Ver estrutura de categories em uma curadoria real"""
import sys
import os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "concierge-api-v3"))

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()
# Também tentar carregar do backend
load_dotenv(Path(__file__).parent / "concierge-api-v3" / ".env")

async def show_curation():
    mongo_uri = os.getenv("MONGODB_URI")
    if not mongo_uri:
        print("ERRO: MONGODB_URI não encontrado no .env")
        return
    
    print(f"URI: {mongo_uri[:50]}...")
    
    client = AsyncIOMotorClient(mongo_uri)
    
    # Listar todos os databases
    db_list = await client.list_database_names()
    print(f"\nDatabases disponíveis: {db_list}")
    
    # Ver coleções no banco concierge-collector
    db = client["concierge-collector"]
    collections = await db.list_collection_names()
    print(f"\nColeções em 'concierge-collector': {collections}")
    
    # Contar documentos
    entity_count = await db.entities.count_documents({})
    curation_count = await db.curations.count_documents({})
    
    print(f"\nEntidades: {entity_count}")
    print(f"Curadorias: {curation_count}")
    
    if entity_count > 0:
        entity = await db.entities.find_one({})
        print("\n\nCAMPOS ENTIDADE:")
        print(list(entity.keys()))
        
        if 'data' in entity:
            print("\nCAMPOS entity.data:")
            print(list(entity['data'].keys()))
    
    if curation_count > 0:
        curation = await db.curations.find_one({})
        print("\n\nCAMPOS CURADORIA:")
        print(list(curation.keys()))
        
        if 'categories' in curation:
            print("\nCATEGORIES:")
            print(f"Type: {type(curation['categories'])}")
            if isinstance(curation['categories'], dict):
                print(f"Keys: {list(curation['categories'].keys())}")
        
        if 'notes' in curation:
            print("\nNOTES:")
            print(f"Type: {type(curation['notes'])}")
            if isinstance(curation['notes'], dict):
                print(f"Keys: {list(curation['notes'].keys())}")
    
    client.close()

if __name__ == "__main__":
    asyncio.run(show_curation())
