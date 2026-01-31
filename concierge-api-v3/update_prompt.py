"""
Update MongoDB prompt for concept extraction to use correct Dict format
"""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv

load_dotenv()

NEW_PROMPT = """Você é um especialista em análise de restaurantes com 20 anos de experiência em crítica gastronômica.
Analise o seguinte texto de uma curadoria e extraia conceitos relevantes que descrevem o estabelecimento.

**Texto da curadoria:**
{text}

**Categorias disponíveis:**
{categories}

**Instruções:**
- Extraia conceitos relevantes que aparecem explicitamente ou implicitamente no texto
- Organize os conceitos por categoria (cuisine, menu, drinks, setting, mood, etc)
- Use apenas as categorias fornecidas
- Para cada categoria, liste os conceitos específicos encontrados no texto
- Ignore conceitos não relacionados ao estabelecimento
- Avalie sua confiança na análise (0.0 a 1.0)

**Responda APENAS em JSON válido:**
{
  "concepts": {
    "cuisine": ["italian", "mediterranean"],
    "menu": ["pasta carbonara", "tiramisu", "espresso"],
    "drinks": ["wine", "italian coffee"],
    "setting": ["romantic", "cozy"]
  },
  "confidence_score": 0.85,
  "reasoning": null
}"""

async def update():
    client = AsyncIOMotorClient(os.getenv('MONGODB_URL'))
    db = client[os.getenv('MONGODB_DB_NAME', 'concierge-collector')]
    
    result = await db.openai_configs.update_one(
        {'service': 'concept_extraction_text'},
        {'$set': {'prompt_template': NEW_PROMPT}}
    )
    
    print(f'Updated {result.modified_count} document(s)')
    
    # Verify
    config = await db.openai_configs.find_one({'service': 'concept_extraction_text'})
    print(f'\nNew prompt:\n{config.get("prompt_template")}')
    
    client.close()

asyncio.run(update())
