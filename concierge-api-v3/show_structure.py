"""Script para mostrar estrutura limpa de entidades e curadorias"""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
import json

load_dotenv()

def clean_entity(entity):
    """Remove embeddings e limpa estrutura"""
    if entity:
        entity['_id'] = str(entity['_id'])
        if 'data' in entity:
            if 'embeddings' in entity['data']:
                entity['data']['_embeddings_removed'] = f"{len(entity['data']['embeddings'])} embeddings"
                del entity['data']['embeddings']
        if 'embeddings_metadata' in entity:
            del entity['embeddings_metadata']
    return entity

async def main():
    mongo_uri = os.getenv('MONGODB_URL')
    db_name = os.getenv('MONGODB_DB_NAME')
    client = AsyncIOMotorClient(mongo_uri)
    db = client[db_name]
    
    print("\n" + "="*80)
    print("ESTRUTURA DE DADOS - ENTIDADE vs CURADORIA")
    print("="*80)
    
    # Buscar entidade
    entity = await db.entities.find_one({'type': 'restaurant'})
    entity = clean_entity(entity)
    
    # Buscar curadoria
    curation = await db.curations.find_one()
    if curation:
        curation['_id'] = str(curation['_id'])
    
    print("\n📦 ENTIDADE - CAMPOS RAIZ:")
    print("-" * 80)
    if entity:
        print(json.dumps({k: type(v).__name__ for k, v in entity.items()}, indent=2))
    
    print("\n📦 ENTIDADE.data - SUBCAMPOS:")
    print("-" * 80)
    if entity and 'data' in entity:
        print(json.dumps({k: type(v).__name__ for k, v in entity['data'].items()}, indent=2))
    
    print("\n\n🎨 CURADORIA - CAMPOS RAIZ:")
    print("-" * 80)
    if curation:
        print(json.dumps({k: type(v).__name__ for k, v in curation.items()}, indent=2))
    
    print("\n🎨 CURADORIA.content - SUBCAMPOS:")
    print("-" * 80)
    if curation and 'content' in curation:
        print(json.dumps({k: type(v).__name__ for k, v in curation['content'].items()}, indent=2))
    
    print("\n🎨 CURADORIA.data - SUBCAMPOS:")
    print("-" * 80)
    if curation and 'data' in curation:
        print(json.dumps({k: type(v).__name__ for k, v in curation['data'].items()}, indent=2))
    
    # Exemplos completos mas resumidos
    print("\n\n" + "="*80)
    print("EXEMPLO COMPLETO DE ENTIDADE (sem embeddings):")
    print("="*80)
    if entity:
        # Limitar conceitos
        if 'data' in entity and 'concepts' in entity['data'] and len(entity['data']['concepts']) > 3:
            entity['data']['concepts'] = entity['data']['concepts'][:3] + [{'_note': f"... mais {len(entity['data']['concepts'])-3} conceitos"}]
        print(json.dumps(entity, indent=2, ensure_ascii=False, default=str))
    
    print("\n\n" + "="*80)
    print("EXEMPLO COMPLETO DE CURADORIA:")
    print("="*80)
    if curation:
        # Limitar texto longo
        if 'content' in curation and 'transcription' in curation['content']:
            trans = curation['content']['transcription']
            if trans and len(trans) > 200:
                curation['content']['transcription'] = trans[:200] + "... (truncado)"
        print(json.dumps(curation, indent=2, ensure_ascii=False, default=str))
    
    client.close()

if __name__ == '__main__':
    asyncio.run(main())
