"""
Analyze MongoDB data structure vs Pydantic schemas
"""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
import json

load_dotenv()

async def analyze():
    client = AsyncIOMotorClient(os.getenv('MONGODB_URL'))
    db = client[os.getenv('MONGODB_DB_NAME', 'concierge-collector')]
    
    print('='*80)
    print('MONGODB DATA STRUCTURE ANALYSIS')
    print('='*80)
    
    # 1. Entities with concepts
    print('\n1. ENTITIES COLLECTION - concepts field structure:')
    entity = await db.entities.find_one({'concepts': {'$exists': True, '$ne': {}}})
    if entity:
        concepts = entity.get('concepts', {})
        print(f'   Type: {type(concepts).__name__}')
        print(f'   Keys (categories): {list(concepts.keys())}')
        print(f'   Sample category "menu": {type(concepts.get("menu")).__name__} with {len(concepts.get("menu", []))} items')
        print(f'   Expected Pydantic: Dict[str, List[str]]')
        print(f'   ✓ CORRECT' if isinstance(concepts, dict) else '   ✗ WRONG')
    
    # 2. Categories collection
    print('\n2. CATEGORIES COLLECTION - structure:')
    cat_doc = await db.categories.find_one({'entity_type': 'restaurant'})
    if cat_doc:
        cats = cat_doc.get('categories', [])
        print(f'   Type: {type(cats).__name__}')
        print(f'   Length: {len(cats)}')
        print(f'   Sample: {cats[:3]}')
        print(f'   Expected Pydantic: List[str]')
        print(f'   ✓ CORRECT' if isinstance(cats, list) else '   ✗ WRONG')
    
    # 3. AI concepts cache
    print('\n3. AI_CONCEPTS COLLECTION - cached concept extractions:')
    ai_concept = await db.ai_concepts.find_one({})
    if ai_concept:
        concepts = ai_concept.get('concepts')
        print(f'   Type: {type(concepts).__name__}')
        if isinstance(concepts, dict):
            print(f'   Keys: {list(concepts.keys())}')
            print(f'   Structure: Dict[str, List[str]]')
        elif isinstance(concepts, list):
            print(f'   Length: {len(concepts)}')
            print(f'   Sample: {concepts[:3]}')
            print(f'   Structure: List[str]')
        print(f'   Current Pydantic expects: List[str]')
        print(f'   ✗ MISMATCH!' if isinstance(concepts, dict) else '   ? CHECK')
    else:
        print('   No documents found')
    
    # 4. Curations with AI data
    print('\n4. CURATIONS COLLECTION - ai_analysis field:')
    curation = await db.curations.find_one({'ai_analysis': {'$exists': True}})
    if curation:
        ai = curation.get('ai_analysis', {})
        if 'concepts' in ai:
            concepts = ai['concepts']
            print(f'   concepts type: {type(concepts).__name__}')
            if isinstance(concepts, dict):
                print(f'   Keys: {list(concepts.keys())}')
            elif isinstance(concepts, list):
                print(f'   Length: {len(concepts)}')
        else:
            print('   No concepts field in ai_analysis')
    else:
        print('   No curations with ai_analysis found')
    
    # 5. OpenAI configs
    print('\n5. OPENAI_CONFIGS COLLECTION - concept extraction prompt:')
    config = await db.openai_configs.find_one({'service': 'concept_extraction_text'})
    if config:
        prompt = config.get('prompt_template', '')
        print(f'   Prompt expects JSON format: ', end='')
        if 'concept1' in prompt:
            print('List[str] format - ["concept1", "concept2"]')
            print('   ✗ WRONG - should expect Dict[str, List[str]]')
        elif '"category":' in prompt:
            print('Dict format - {"category": ["concept1"]}')
            print('   ✓ CORRECT')
        else:
            print('   ? UNCLEAR')
    
    print('\n' + '='*80)
    print('SUMMARY')
    print('='*80)
    print('MongoDB stores concepts as: Dict[str, List[str]] (categorized)')
    print('Pydantic ConceptExtractionOutput expects: List[str] (flat)')
    print('Result: ✗ SCHEMA MISMATCH - NEEDS FIX')
    print('='*80)
    
    client.close()

asyncio.run(analyze())
