"""
Seed script for openai_configs collection.
Populates MongoDB with OpenAI service configurations and prompts.

Usage:
    python scripts/seed_openai_configs.py
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

OPENAI_CONFIGS = [
    {
        "service": "transcription",
        "model": "whisper-1",
        "config": {
            "language": "pt-BR",
            "temperature": 0.2,
            "response_format": "verbose_json",
            "timestamp_granularities": ["word", "segment"]
        },
        "cache_ttl_hours": 24,
        "cache_by": "audio_hash",
        "cost_per_minute": 0.006,
        "max_file_size_mb": 25,
        "supported_formats": ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"],
        "enabled": True,
        "version": 1,
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": "system_seed",
        "notes": "Whisper transcription service with Brazilian Portuguese default"
    },
    {
        "service": "concept_extraction_text",
        "model": "gpt-5.6-terra",
        "config": {
            # v11 (2026-08-18): 800 tokens para as 12 categorias + exemplos
            # caberem — 500 cortava o JSON no meio em textos densos
            "max_completion_tokens": 800,
            "extra_body": {"reasoning_effort": "low"}
        },
        "prompt_template": """You are an expert restaurant analyst with 20 years of experience in food criticism.

Analyze the following text (likely an expert review) and extract relevant concepts that describe the establishment, classifying them into the appropriate categories.

**Curation text:**
{text}

**Available categories (use ONLY these keys — never invent new ones):**
{categories}

**Instructions:**
- Extract concepts that appear explicitly or implicitly in the text
- Populate EVERY category that has evidence in the text — do not omit a category just because only one concept fits
- Category semantics: "setting" = physical space (open kitchen, terrace, counter seats); "mood" = atmosphere/vibe (cozy, elegant); "crowd" = who frequents (families, business people); "suitable_for" = occasions (business lunch, romantic date)
- Concepts must be in English, except local/regional terms (e.g., "Feijoada", "Moqueca")
- ALL concept values MUST be lowercase, EXCEPT proper nouns (dish names in "menu") and amounts in "price_and_payment" (e.g., "R$ 480"), which keep their original form
- "price_range" MUST contain EXACTLY ONE of: "unexpensive", "mid-range", "expensive"
- If a concept doesn't fit any category, ignore it — NEVER add fields beyond the schema
- Each category can have 0 or more concepts; omit categories with no concepts
- Evaluate your overall confidence in the analysis (0.0 to 1.0)

**Classification examples:**
- "delicious italian food" → cuisine: ["italian"]
- "pizza margherita, risotto ai funghi" → menu: ["Pizza Margherita", "Mushroom Risotto"]
- "cozy and romantic atmosphere" → mood: ["cozy", "romantic"], setting: ["intimate"]
- "slow-cooked stews from the wood-fired oven" → food_style: ["slow-cooked", "wood-fired"]
- "full of families with kids on weekends" → crowd: ["families"]
- "great for a business lunch or a romantic date" → suitable_for: ["business lunch", "romantic date"]
- "excellent wine list" → drinks: ["wine"], special_features: ["wine focus"]
- "fixed menu at R$ 480, cards accepted" → price_range: ["mid-range"], price_and_payment: ["R$ 480 fixed menu", "cards accepted"]
- "takeout and delivery available" → covid_specials: ["takeout", "delivery"]

**Reply ONLY in valid JSON — use only keys from the category list, plus "confidence_score":**
{
  "cuisine": ["italian"],
  "menu": ["Pizza Margherita"],
  "food_style": ["wood-fired"],
  "mood": ["cozy"],
  "crowd": ["families"],
  "price_range": ["mid-range"],
  "price_and_payment": ["cards accepted"],
  "confidence_score": 0.85
}""",
        "cache_ttl_hours": 168,
        "cache_by": "text_hash",
        "cost_per_token_input": 0.00003,
        "cost_per_token_output": 0.00006,
        "enabled": True,
        "version": 11,
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": "system_seed",
        "notes": "v11: exemplos para TODAS as 12 categorias (food_style/crowd/suitable_for/price_and_payment/covid_specials faltavam) + max_completion_tokens 800"
    },
    {
        "service": "image_analysis",
        "model": "gpt-4o",
        "config": {
            "temperature": 0.3,
            "max_tokens": 1000,
            "detail": "high",
            # O prompt exige JSON — o response_format força o modelo a devolver
            # JSON puro (sem isso o gpt-4o solta markdown/texto e o parse falha)
            "response_format": {"type": "json_object"}
        },
        "prompt_template": """Você é um especialista em análise visual de restaurantes e ambientes gastronômicos.

Analise esta imagem e identifique conceitos visuais relevantes que descrevem o estabelecimento, classificando-os pelas categorias apropriadas.

**Categorias disponíveis (use SOMENTE estas chaves — nunca invente novas):**
{categories}

**Semântica das categorias:**
- "setting" = espaço físico (open kitchen, terrace, counter seats)
- "mood" = atmosfera/vibe (cozy, elegant, lively)
- "crowd" = quem frequenta (families, business people)
- "suitable_for" = ocasiões que o espaço sugere (business lunch, romantic date)

**Instruções:**
- Extraia conceitos que você pode IDENTIFICAR VISUALMENTE na imagem
- Popule TODA categoria com evidência visual na imagem — não omita uma categoria só porque cabe um único conceito
- Todos os valores DEVEM ser em inglês e lowercase (ex.: "modern", "cozy", "open kitchen")
- "price_range" apenas quando um preço estiver VISÍVEL (cardápio com preços na parede/mesa); caso contrário omita — vale "unexpensive", "mid-range" ou "expensive"
- Conceitos que exigem contexto não-visual (service quality, delivery) ficam de fora
- Se um conceito não se encaixa em nenhuma categoria, ignore-o — NUNCA adicione campos além do schema
- Cada categoria pode ter 0 ou mais conceitos; omita categorias sem conceitos
- Avalie sua confiança geral na análise visual (0.0 a 1.0)

**Exemplos de classificação:**
- Pratos de massa e pizza visíveis → cuisine: ["italian"], food_style: ["casual"]
- Garrafas de vinho e um bar bem abastecido visíveis → drinks: ["wine", "cocktails"], special_features: ["bar"]
- Ambiente moderno e elegante → mood: ["modern", "elegant"], setting: ["contemporary"]
- Cozinha aberta visível → setting: ["open kitchen"], special_features: ["chef's table"]
- Mesas com famílias e crianças visíveis → crowd: ["families"], suitable_for: ["family friendly"]
- Balcão com assentos individuais → suitable_for: ["solo dining"], setting: ["counter seats"]
- Cardápio com preços visível → price_range: ["mid-range"], price_and_payment: ["menu prices visible"]

**Responda APENAS em JSON válido — use só as chaves da lista de categorias, plus "confidence_score" e "visual_notes":**
{
  "mood": ["modern"],
  "setting": ["contemporary"],
  "crowd": ["families"],
  "price_range": ["mid-range"],
  "confidence_score": 0.80,
  "visual_notes": "brief description of what you see"
}""",
        "cache_ttl_hours": 168,
        "cache_by": "image_hash",
        "cost_per_image": 0.00765,
        "max_file_size_mb": 20,
        "supported_formats": ["jpg", "jpeg", "png", "gif", "webp"],
        "enabled": True,
        "version": 11,
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": "system_seed",
        "notes": "v11: Foque em usa SÓ as chaves do vocabulário (ambiance/design saíram), price_range permitido quando visível, exemplos para todas as categorias"
    },
    {
        "service": "restaurant_name_extraction_text",
        "model": "gpt-4",
        "config": {
            "temperature": 0.1,
            "max_tokens": 120,
            "top_p": 1.0,
            "frequency_penalty": 0.0,
            "presence_penalty": 0.0
        },
        "prompt_template": """Você é um extrator preciso de nome de restaurante a partir de texto de curadoria.\n\nTexto:\n{text}\n\nInstruções:\n- Retorne APENAS JSON válido\n- Use o formato: {\"restaurant_name\": \"<nome ou null>\", \"confidence_score\": 0.0}\n- Se não houver nome explícito/confiável, use restaurant_name como null\n- Não adicione campos extras\n- Preserve o nome exatamente como aparece no texto""",
        "cache_ttl_hours": 168,
        "cache_by": "text_hash",
        "cost_per_token_input": 0.00003,
        "cost_per_token_output": 0.00006,
        "enabled": True,
        "version": 1,
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": "system_seed",
        "notes": "Dedicated GPT service for restaurant name extraction from text"
    }
]


async def seed_openai_configs():
    """Seed openai_configs collection"""
    # Connect to MongoDB
    mongo_url = os.getenv("MONGODB_URL")
    if not mongo_url:
        print("❌ MONGODB_URL not found in .env")
        return
    
    client = AsyncIOMotorClient(mongo_url)
    db_name = os.getenv("MONGODB_DB_NAME", "concierge-collector")
    db = client[db_name]
    
    print("🌱 Seeding openai_configs collection...")
    
    # Insert or update configs
    for config_data in OPENAI_CONFIGS:
        service = config_data["service"]
        
        # Check if already exists
        existing = await db.openai_configs.find_one({"service": service})
        
        if existing:
            # Update existing
            result = await db.openai_configs.update_one(
                {"service": service},
                {
                    "$set": config_data,
                    "$inc": {"version": 1}
                }
            )
            print(f"   ✅ Updated {service} (model: {config_data['model']})")
        else:
            # Insert new
            result = await db.openai_configs.insert_one(config_data)
            print(f"   ✅ Inserted {service} (model: {config_data['model']})")
    
    # Create index on service
    await db.openai_configs.create_index("service", unique=True)
    print("   ✅ Created index on service")
    
    # Display summary
    total_docs = await db.openai_configs.count_documents({})
    print(f"\n📊 Summary: {total_docs} OpenAI services configured")
    
    # List all configs
    cursor = db.openai_configs.find({})
    async for doc in cursor:
        status = "✅ Enabled" if doc["enabled"] else "❌ Disabled"
        print(f"   • {doc['service']}: {doc['model']} - {status}")
    
    client.close()
    print("\n✅ OpenAI configs seeding complete!")


if __name__ == "__main__":
    asyncio.run(seed_openai_configs())
