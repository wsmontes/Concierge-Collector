import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv

load_dotenv()

async def main():
    client = AsyncIOMotorClient(os.getenv('MONGODB_URL'))
    db = client[os.getenv('MONGODB_DB_NAME')]
    
    entity = await db.entities.find_one({'type': 'restaurant'}, {'data.embeddings': 0, 'embeddings_metadata': 0})
    curation = await db.curations.find_one()
    
    print('='*80)
    print('ESTRUTURA ENTIDADE')
    print('='*80)
    print('CAMPOS RAIZ:', list(entity.keys()) if entity else 'None')
    if entity and 'data' in entity:
        print('CAMPOS entity.data:', list(entity['data'].keys()))
    
    print('\n' + '='*80)
    print('ESTRUTURA CURADORIA')
    print('='*80)
    print('CAMPOS RAIZ:', list(curation.keys()) if curation else 'None')
    if curation and 'content' in curation:
        print('CAMPOS curation.content:', list(curation.get('content', {}).keys()))
    if curation and 'data' in curation:
        print('CAMPOS curation.data:', list(curation.get('data', {}).keys()))
    
    client.close()

asyncio.run(main())
