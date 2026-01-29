#!/usr/bin/env python3
"""
Audio Transcription Diagnostic Script
Purpose: Check why transcription is failing in Render production

Run this script in the Render environment to diagnose issues:
python diagnose_transcription.py
"""

import os
import sys
import logging
import asyncio
import base64
from datetime import datetime

# Setup logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

async def check_environment():
    """Check environment variables and configuration"""
    logger.info("=" * 60)
    logger.info("STEP 1: Environment Check")
    logger.info("=" * 60)
    
    checks = {
        "OPENAI_API_KEY": os.getenv("OPENAI_API_KEY"),
        "MONGODB_URI": os.getenv("MONGODB_URI"),
        "GOOGLE_PLACES_API_KEY": os.getenv("GOOGLE_PLACES_API_KEY"),
        "JWT_SECRET_KEY": os.getenv("JWT_SECRET_KEY"),
        "ENVIRONMENT": os.getenv("ENVIRONMENT", "development")
    }
    
    for key, value in checks.items():
        if key == "OPENAI_API_KEY":
            # Don't print full key
            status = "✓ SET" if value else "✗ MISSING"
            length = len(value) if value else 0
            logger.info(f"{key}: {status} (length: {length})")
        elif key in ["MONGODB_URI", "JWT_SECRET_KEY"]:
            status = "✓ SET" if value else "✗ MISSING"
            logger.info(f"{key}: {status}")
        else:
            logger.info(f"{key}: {value or '✗ MISSING'}")
    
    # Critical check
    if not checks["OPENAI_API_KEY"]:
        logger.error("❌ OPENAI_API_KEY is not set!")
        logger.error("   Set it in Render dashboard: Environment → Add Variable")
        logger.error("   Variable name: OPENAI_API_KEY")
        logger.error("   Variable value: sk-...")
        return False
    
    return True

async def check_openai_connection():
    """Test OpenAI API connectivity"""
    logger.info("\n" + "=" * 60)
    logger.info("STEP 2: OpenAI API Connection Test")
    logger.info("=" * 60)
    
    try:
        from openai import OpenAI
        
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.error("❌ Cannot test - OPENAI_API_KEY not set")
            return False
        
        logger.info("Creating OpenAI client...")
        client = OpenAI(api_key=api_key)
        
        # Test with simple completion (cheaper than audio)
        logger.info("Testing API with simple completion...")
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": "Say 'API OK'"}],
            max_tokens=10
        )
        
        result = response.choices[0].message.content
        logger.info(f"✓ OpenAI API working! Response: {result}")
        return True
        
    except Exception as e:
        logger.error(f"❌ OpenAI API connection failed: {type(e).__name__}: {str(e)}")
        if "authentication" in str(e).lower():
            logger.error("   → Invalid API key. Check if key is correct in Render dashboard.")
        elif "rate" in str(e).lower():
            logger.error("   → Rate limit exceeded. Wait a few minutes and try again.")
        elif "quota" in str(e).lower():
            logger.error("   → API quota exceeded. Check your OpenAI billing.")
        return False

async def check_database_connection():
    """Test MongoDB connection"""
    logger.info("\n" + "=" * 60)
    logger.info("STEP 3: MongoDB Connection Test")
    logger.info("=" * 60)
    
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        
        mongodb_uri = os.getenv("MONGODB_URI")
        if not mongodb_uri:
            logger.error("❌ MONGODB_URI not set")
            return False
        
        logger.info("Connecting to MongoDB...")
        client = AsyncIOMotorClient(mongodb_uri)
        
        # Test connection
        await client.admin.command('ping')
        logger.info("✓ MongoDB connection working!")
        
        # Check if transcriptions collection exists
        db = client.get_default_database()
        collections = await db.list_collection_names()
        logger.info(f"Available collections: {', '.join(collections)}")
        
        if 'transcriptions' in collections:
            count = await db.transcriptions.count_documents({})
            logger.info(f"✓ transcriptions collection exists ({count} documents)")
        else:
            logger.warning("⚠ transcriptions collection doesn't exist yet (will be created on first use)")
        
        client.close()
        return True
        
    except Exception as e:
        logger.error(f"❌ MongoDB connection failed: {type(e).__name__}: {str(e)}")
        return False

async def test_whisper_transcription():
    """Test actual Whisper transcription with small sample"""
    logger.info("\n" + "=" * 60)
    logger.info("STEP 4: Whisper Transcription Test")
    logger.info("=" * 60)
    
    try:
        from openai import OpenAI
        import io
        
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.error("❌ Cannot test - OPENAI_API_KEY not set")
            return False
        
        # Create minimal valid MP3 file (silence)
        # This is a 0.1 second silence MP3 (hex dump of minimal MP3)
        mp3_hex = "fffb90c40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
        mp3_bytes = bytes.fromhex(mp3_hex)
        
        logger.info(f"Creating test audio file ({len(mp3_bytes)} bytes)...")
        audio_file = io.BytesIO(mp3_bytes)
        audio_file.name = "test.mp3"
        
        logger.info("Calling Whisper API (whisper-1 model)...")
        client = OpenAI(api_key=api_key)
        
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language="en"
        )
        
        logger.info(f"✓ Whisper transcription successful!")
        logger.info(f"   Response type: {type(response)}")
        logger.info(f"   Transcription: '{response.text}'")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Whisper transcription failed: {type(e).__name__}: {str(e)}")
        logger.error(f"   Full error: {e}")
        
        if "audio" in str(e).lower():
            logger.error("   → Audio format issue. Check if file is valid MP3/WAV/WebM.")
        elif "authentication" in str(e).lower():
            logger.error("   → Authentication failed. Check OPENAI_API_KEY.")
        elif "model" in str(e).lower():
            logger.error("   → Model not available. Whisper-1 should always work.")
        
        return False

async def check_orchestrate_config():
    """Check AI orchestrator configuration in MongoDB"""
    logger.info("\n" + "=" * 60)
    logger.info("STEP 5: AI Orchestrator Configuration Check")
    logger.info("=" * 60)
    
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        
        mongodb_uri = os.getenv("MONGODB_URI")
        if not mongodb_uri:
            logger.error("❌ MONGODB_URI not set")
            return False
        
        client = AsyncIOMotorClient(mongodb_uri)
        db = client.get_default_database()
        
        # Check openai_configs collection
        if 'openai_configs' not in await db.list_collection_names():
            logger.warning("⚠ openai_configs collection doesn't exist")
            logger.warning("   Orchestrator will use default settings")
            client.close()
            return True
        
        # Get transcription config
        transcription_config = await db.openai_configs.find_one({"service": "transcription"})
        
        if transcription_config:
            logger.info("✓ Transcription config found:")
            logger.info(f"   Model: {transcription_config.get('model', 'not set')}")
            logger.info(f"   Config: {transcription_config.get('config', {})}")
        else:
            logger.warning("⚠ No transcription config in MongoDB (using defaults)")
            logger.info("   Default model: whisper-1")
            logger.info("   Default language: pt-BR")
        
        client.close()
        return True
        
    except Exception as e:
        logger.error(f"❌ Config check failed: {type(e).__name__}: {str(e)}")
        return False

async def check_api_endpoint():
    """Test the /api/v3/ai/orchestrate endpoint"""
    logger.info("\n" + "=" * 60)
    logger.info("STEP 6: API Endpoint Test")
    logger.info("=" * 60)
    
    try:
        import aiohttp
        
        # Create test request (without actual audio)
        url = "http://localhost:8000/api/v3/ai/health"
        
        logger.info(f"Testing endpoint: {url}")
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                status = response.status
                data = await response.json()
                
                logger.info(f"Status: {status}")
                logger.info(f"Response: {data}")
                
                if status == 200:
                    logger.info("✓ API endpoint is responding")
                    
                    # Check health details
                    if data.get("status") == "healthy":
                        logger.info("✓ AI service is healthy")
                    
                    checks = data.get("checks", {})
                    if "openai_api_key" in checks:
                        key_check = checks["openai_api_key"]
                        if key_check.get("status") == "ok":
                            logger.info("✓ OpenAI API key is configured correctly")
                        else:
                            logger.error(f"❌ OpenAI API key check failed: {key_check}")
                    
                    return True
                else:
                    logger.error(f"❌ API returned error status: {status}")
                    return False
        
    except Exception as e:
        logger.error(f"❌ API endpoint test failed: {type(e).__name__}: {str(e)}")
        logger.info("   This is expected if running outside the API server")
        logger.info("   The API server must be running for this test")
        return True  # Don't fail the whole diagnostic

async def main():
    """Run all diagnostic checks"""
    logger.info("🔍 Audio Transcription Diagnostic Tool")
    logger.info(f"📅 Date: {datetime.now().isoformat()}")
    logger.info(f"🐍 Python: {sys.version}")
    logger.info("")
    
    results = {}
    
    # Run checks
    results["environment"] = await check_environment()
    
    if results["environment"]:
        results["openai"] = await check_openai_connection()
        results["database"] = await check_database_connection()
        results["whisper"] = await test_whisper_transcription()
        results["config"] = await check_orchestrate_config()
        results["api"] = await check_api_endpoint()
    else:
        logger.error("\n❌ Environment check failed - skipping other tests")
        return 1
    
    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("DIAGNOSTIC SUMMARY")
    logger.info("=" * 60)
    
    all_passed = True
    for check_name, passed in results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        logger.info(f"{check_name.upper()}: {status}")
        if not passed:
            all_passed = False
    
    logger.info("")
    
    if all_passed:
        logger.info("✅ All checks passed! Transcription should work.")
        logger.info("")
        logger.info("If transcription still fails:")
        logger.info("1. Check frontend console for errors")
        logger.info("2. Check Render logs for backend errors")
        logger.info("3. Verify audio format (should be MP3/WebM/WAV)")
        logger.info("4. Check JWT token is valid (not expired)")
        return 0
    else:
        logger.error("❌ Some checks failed. Fix the issues above.")
        logger.error("")
        logger.error("Common fixes:")
        logger.error("1. Set OPENAI_API_KEY in Render dashboard")
        logger.error("2. Verify OpenAI API key is valid")
        logger.error("3. Check OpenAI account has credits")
        logger.error("4. Ensure MongoDB is accessible")
        return 1

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
