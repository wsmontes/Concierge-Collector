import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
import json

load_dotenv()

async def check():
    mongo_uri = os.getenv('MONGODB_URL')
    if not mongo_uri:
        print('ERROR: MONGODB_URL not set in .env')
        return
    
    client = AsyncIOMotorClient(mongo_uri)
    db_name = os.getenv('MONGODB_DB_NAME', 'concierge-collector')
    db = client[db_name]
    
    # Check entities with concepts
    print('=== ENTITIES WITH CONCEPTS ===')
    entities = await db.entities.find({'concepts': {'$exists': True, '$ne': {}}}).limit(3).to_list(3)
    if entities:
        for i, entity in enumerate(entities):
            print(f'\nEntity {i+1}: {entity.get("name", "Unknown")}')
            print(f'Concepts: {json.dumps(entity.get("concepts", {}), indent=2)}')
    else:
        print('No entities with concepts found')
    
    # Categories
    print('\n=== CATEGORIES ===')
    cat_doc = await db.categories.find_one({'entity_type': 'restaurant'})
    if cat_doc:
        cats = cat_doc.get('categories', [])
        print(f'Categories ({len(cats)}): {cats}')
    else:
        print('NO categories!')
    
    # Config
    print('\n=== PROMPT CONFIG ===')
    cfg = await db.openai_configs.find_one({'service': 'concept_extraction_text'})
    if cfg:
        print(f'Model: {cfg.get("model")}')
        print(f'\nPrompt:\n{cfg.get("prompt_template", "NONE")}')
    
    client.close()

asyncio.run(check())
