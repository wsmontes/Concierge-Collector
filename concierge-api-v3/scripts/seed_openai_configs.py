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
            "response_format": "json",
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
        "model": "gpt-4",
        "config": {
            "temperature": 0.3,
            "max_tokens": 500,
            "top_p": 1.0,
            "frequency_penalty": 0.0,
            "presence_penalty": 0.0
        },
        "prompt_template": """Você é um especialista em análise de restaurantes com 20 anos de experiência em crítica gastronômica.

Analise o seguinte texto de uma curadoria e extraia conceitos relevantes que descrevem o estabelecimento.

**Texto da curadoria:**
{text}

**Categorias disponíveis:**
{categories}

**Instruções:**
- Extraia APENAS conceitos que aparecem explicitamente ou implicitamente no texto
- Use APENAS conceitos da lista de categorias disponíveis
- Ignore conceitos não relacionados ao estabelecimento
- Retorne múltiplos conceitos se aplicável (mínimo 2, máximo 8)
- Avalie sua confiança na análise (0.0 a 1.0)

**Responda APENAS em JSON válido:**
{{"concepts": ["concept1", "concept2", "concept3"], "confidence_score": 0.85}}""",
        "cache_ttl_hours": 168,
        "cache_by": "text_hash",
        "cost_per_token_input": 0.00003,
        "cost_per_token_output": 0.00006,
        "enabled": True,
        "version": 1,
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": "system_seed",
        "notes": "GPT-4 concept extraction from text with 2-8 concepts limit"
    },
    {
        "service": "image_analysis",
        "model": "gpt-4-vision-preview",
        "config": {
            "temperature": 0.3,
            "max_tokens": 300,
            "detail": "high"
        },
        "prompt_template": """Você é um especialista em análise visual de restaurantes e ambientes gastronômicos.

Analise esta imagem e identifique conceitos visuais relevantes que descrevem o estabelecimento.

**Categorias disponíveis:**
{categories}

**Foque nos seguintes aspectos:**
- Ambiance e atmosfera (modern, elegant, cozy, etc.)
- Design e arquitetura (contemporary_design, historic_building, etc.)
- Setting e espaço (open_kitchen, terrace, intimate, etc.)
- Crowd e público visível (business, family_friendly, etc.)
- Food presentation (se visível)

**Instruções:**
- Extraia conceitos que você pode IDENTIFICAR VISUALMENTE na imagem
- Use APENAS conceitos da lista de categorias disponíveis
- Ignore conceitos que requerem contexto não-visual (ex: service, price)
- Retorne 2-6 conceitos visuais aplicáveis
- Avalie sua confiança na análise visual (0.0 a 1.0)
- Adicione notas visuais breves sobre o que você vê

**Responda APENAS em JSON válido:**
{{"concepts": ["concept1", "concept2"], "confidence_score": 0.80, "visual_notes": "brief description of what you see"}}""",
        "cache_ttl_hours": 168,
        "cache_by": "image_hash",
        "cost_per_image": 0.00765,
        "max_file_size_mb": 20,
        "supported_formats": ["jpg", "jpeg", "png", "gif", "webp"],
        "enabled": True,
        "version": 1,
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": "system_seed",
        "notes": "GPT-4 Vision for visual concept extraction with 2-6 concepts limit"
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
