"""
Script para buscar exemplos reais de entidades e curadorias do MongoDB
para entender a estrutura de dados correta
"""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
import json

load_dotenv()

async def get_examples():
    mongo_uri = os.getenv('MONGODB_URL')
    db_name = os.getenv('MONGODB_DB_NAME')
    client = AsyncIOMotorClient(mongo_uri)
    db = client[db_name]
    
    print("\n" + "="*80)
    print("EXEMPLOS DE ESTRUTURA DE DADOS DO MONGODB")
    print("="*80)
    
    # Buscar 1 entidade de exemplo
    print("\n📦 EXEMPLO DE ENTIDADE:")
    print("-" * 80)
    entity = await db.entities.find_one({'type': 'restaurant'})
    if entity:
        entity['_id'] = str(entity['_id'])
        # Remove embeddings para não poluir o output
        if 'data' in entity and 'embeddings' in entity['data']:
            entity['data']['embeddings_summary'] = f"{len(entity['data']['embeddings'])} embeddings removed for clarity"
            del entity['data']['embeddings']
        if 'embeddings_metadata' in entity:
            del entity['embeddings_metadata']
        print(json.dumps(entity, indent=2, ensure_ascii=False, default=str))
    else:
        print("❌ Nenhuma entidade encontrada")
    
    # Buscar 1 curadoria de exemplo
    print("\n" + "="*80)
    print("\n🎨 EXEMPLO DE CURADORIA:")
    print("-" * 80)
    curation = await db.curations.find_one()
    if curation:
        curation['_id'] = str(curation['_id'])
        print(json.dumps(curation, indent=2, ensure_ascii=False, default=str))
    else:
        print("❌ Nenhuma curadoria encontrada")
    
    # Mostrar campos da entidade
    print("\n" + "="*80)
    print("\n🔑 CAMPOS DA ENTIDADE:")
    print("-" * 80)
    if entity:
        print("Campos raiz:", list(entity.keys()))
        if 'data' in entity:
            print("Campos em entity.data:", list(entity.get('data', {}).keys()))
    
    # Mostrar campos da curadoria
    print("\n" + "="*80)
    print("\n🔑 CAMPOS DA CURADORIA:")
    print("-" * 80)
    if curation:
        print("Campos raiz:", list(curation.keys()))
        if 'content' in curation:
            print("Campos em curation.content:", list(curation.get('content', {}).keys()))
        if 'data' in curation:
            print("Campos em curation.data:", list(curation.get('data', {}).keys()))
    
    # Buscar curadorias associadas ao entity_id
    if entity:
        print("\n" + "="*80)
        print(f"\n🔗 CURADORIAS DA ENTIDADE '{entity['name']}':")
        print("-" * 80)
        entity_curations = await db.curations.find({'entity_id': entity['entity_id']}).to_list(length=5)
        if entity_curations:
            for idx, cur in enumerate(entity_curations, 1):
                cur['_id'] = str(cur['_id'])
                print(f"\nCuradoria {idx}:")
                print(json.dumps(cur, indent=2, ensure_ascii=False, default=str))
        else:
            print("❌ Nenhuma curadoria encontrada para esta entidade")
    
    client.close()

if __name__ == '__main__':
    asyncio.run(get_examples())
