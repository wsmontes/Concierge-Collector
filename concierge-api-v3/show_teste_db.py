"""
Script para mostrar o documento TESTE_DB completo do MongoDB
"""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json

async def show_teste_db():
    mongo_uri = os.getenv('MONGODB_URL', 'mongodb+srv://wmontes_db_user:PL45tIzLV1weWHJW@concierge-collector.7bwiisy.mongodb.net/?retryWrites=true&w=majority&readPreference=secondaryPreferred')
    db_name = os.getenv('MONGODB_DB_NAME', 'concierge-collector')
    client = AsyncIOMotorClient(mongo_uri)
    db = client[db_name]
    
    # Buscar TESTE_DB
    entity = await db.entities.find_one({'name': 'TESTE_DB'})
    
    if entity:
        print("\n" + "="*80)
        print("ENTIDADE TESTE_DB NO MONGODB")
        print("="*80)
        
        # Converter ObjectId para string
        if entity.get('_id'):
            entity['_id'] = str(entity['_id'])
        
        # Informações básicas
        print(f"\n📋 INFORMAÇÕES BÁSICAS:")
        print(f"   Entity ID: {entity.get('entity_id')}")
        print(f"   Nome: {entity.get('name')}")
        print(f"   Tipo: {entity.get('type')}")
        print(f"   Status: {entity.get('status')}")
        print(f"   Versão: {entity.get('version')}")
        
        # Timestamps
        print(f"\n⏰ TIMESTAMPS:")
        print(f"   Criado: {entity.get('createdAt')}")
        print(f"   Atualizado: {entity.get('updatedAt')}")
        
        # Criador
        if entity.get('createdBy'):
            creator = entity['createdBy']
            if isinstance(creator, dict):
                print(f"\n👤 CRIADO POR:")
                print(f"   Email: {creator.get('email')}")
                print(f"   Nome: {creator.get('name')}")
                print(f"   User ID: {creator.get('user_id')}")
            else:
                print(f"\n👤 CRIADO POR: {creator}")
        
        # Curador
        if entity.get('curator_email'):
            print(f"\n🎨 CURADOR: {entity.get('curator_email')}")
        
        # Transcrição
        if entity.get('transcription'):
            trans = entity['transcription']
            text = trans.get('text', '')
            print(f"\n📝 TRANSCRIÇÃO ({len(text)} caracteres):")
            print(f"   {text[:300]}...")
            if trans.get('duration'):
                print(f"   Duração: {trans['duration']}s")
        
        # Descrição
        if entity.get('description'):
            desc = entity['description']
            print(f"\n📄 DESCRIÇÃO ({len(desc)} caracteres):")
            print(f"   {desc[:200]}...")
        
        # Conceitos
        if entity.get('concepts'):
            concepts = entity['concepts']
            
            # Agrupar por categoria
            by_category = {}
            for concept in concepts:
                cat = concept.get('category', 'Uncategorized')
                if cat not in by_category:
                    by_category[cat] = []
                by_category[cat].append(concept)
            
            print(f"\n💡 CONCEITOS EXTRAÍDOS:")
            print(f"   Total: {len(concepts)} conceitos em {len(by_category)} categorias")
            print()
            
            for category in sorted(by_category.keys()):
                items = by_category[category]
                print(f"   📂 {category} ({len(items)}):")
                for concept in items:
                    name = concept.get('name', 'N/A')
                    conf = concept.get('confidence', 0)
                    print(f"      • {name} (confiança: {conf:.2f})")
        
        # Status de sincronização
        if entity.get('sync'):
            sync = entity['sync']
            print(f"\n🔄 SINCRONIZAÇÃO:")
            print(f"   Status: {sync.get('status')}")
            if sync.get('lastAttempt'):
                print(f"   Última tentativa: {sync.get('lastAttempt')}")
        
        # Etag
        if entity.get('etag'):
            print(f"\n🏷️  ETAG: {entity.get('etag')}")
        
        # JSON completo (formatado)
        print("\n" + "="*80)
        print("DOCUMENTO JSON COMPLETO:")
        print("="*80)
        print(json.dumps(entity, indent=2, ensure_ascii=False, default=str))
        print()
        
    else:
        print("\n❌ TESTE_DB não encontrada no MongoDB")
    
    client.close()

if __name__ == '__main__':
    asyncio.run(show_teste_db())
