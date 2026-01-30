"""
Check OpenAI/LLM configuration in MongoDB
"""
import os
import sys
from pymongo import MongoClient
from dotenv import load_dotenv
import json

# Load .env from concierge-api-v3
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(env_path)

# Connect to MongoDB
mongodb_url = os.getenv('MONGODB_URL')
db_name = os.getenv('MONGODB_DB_NAME', 'concierge_collector_v3')

if not mongodb_url:
    print("ERROR: MONGODB_URL not found in .env")
    sys.exit(1)

client = MongoClient(mongodb_url)
db = client[db_name]

# Get all enabled OpenAI configs
configs = list(db.openai_configs.find({'enabled': True}, {
    'service': 1, 
    'model': 1, 
    'config': 1, 
    'prompt_template': 1,
    '_id': 0
}))

print(f'\n{"="*80}')
print(f'OPENAI/LLM CONFIGURATION ANALYSIS')
print(f'Database: {db_name}')
print(f'Enabled Services: {len(configs)}')
print(f'{"="*80}\n')

for c in configs:
    prompt_len = len(c.get('prompt_template', ''))
    
    print(f'\n{"─"*80}')
    print(f'SERVICE: {c["service"]}')
    print(f'{"─"*80}')
    print(f'Model: {c["model"]}')
    print(f'\nConfig Parameters:')
    print(json.dumps(c.get('config', {}), indent=2))
    print(f'\nPrompt Template Length: {prompt_len} chars')
    
    if prompt_len > 0:
        print(f'\nPrompt Template:')
        print('─'*80)
        print(c['prompt_template'])
        print('─'*80)

# Check categories
categories_count = db.categories.count_documents({'active': True})
print(f'\n{"="*80}')
print(f'Active Categories: {categories_count}')
print(f'{"="*80}\n')

# Get sample categories
categories = list(db.categories.find({'active': True}, {'name': 1, 'entity_types': 1, '_id': 0}).limit(10))
for cat in categories:
    print(f"  - {cat['name']} (entity_types: {', '.join(cat.get('entity_types', []))})")

print(f'\n{"="*80}')
print('Analysis complete!')
print(f'{"="*80}\n')
