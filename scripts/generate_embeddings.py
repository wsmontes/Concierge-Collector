#!/usr/bin/env python3
"""
File: generate_embeddings.py
Purpose: Generate embeddings for curation concepts using OpenAI API
Dependencies: requests, openai, python-dotenv
Last Updated: November 23, 2025

Creates embeddings for each category+concept pair in curations
Format: "cuisine japanese", "food_style casual", etc.
Model: text-embedding-3-small (1536 dimensions)
"""

import json
import os
import sys
import time
from typing import Dict, List, Optional
from datetime import datetime

import requests
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables
env_path = os.path.join(os.path.dirname(__file__), '..', 'concierge-api-v3', '.env')
load_dotenv(env_path)

# Configuration
API_BASE_URL = 'https://concierge-collector.onrender.com'
API_SECRET_KEY = os.getenv('API_SECRET_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Validate keys
if not API_SECRET_KEY:
    print("ERROR: API_SECRET_KEY not found in .env")
    sys.exit(1)

if not OPENAI_API_KEY:
    print("ERROR: OPENAI_API_KEY not found in .env")
    sys.exit(1)

# API Endpoints
API_CURATIONS_URL = f"{API_BASE_URL}/api/v3/curations"

# OpenAI Client
client = OpenAI(api_key=OPENAI_API_KEY)

# Embedding Model
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536

# Batch settings
BATCH_SIZE = 50
DELAY_BETWEEN_BATCHES = 2  # seconds

# Colors
class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'


def generate_embedding(text: str) -> Optional[List[float]]:
    """Generate embedding for a single text using OpenAI API"""
    try:
        response = client.embeddings.create(
            input=text,
            model=EMBEDDING_MODEL,
            dimensions=EMBEDDING_DIMENSIONS
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"{Colors.FAIL}Embedding error for '{text}': {e}{Colors.ENDC}")
        return None


def generate_embeddings_batch(texts: List[str]) -> Dict[str, List[float]]:
    """Generate embeddings for multiple texts in one API call"""
    try:
        response = client.embeddings.create(
            input=texts,
            model=EMBEDDING_MODEL,
            dimensions=EMBEDDING_DIMENSIONS
        )
        
        # Map texts to embeddings
        result = {}
        for i, text in enumerate(texts):
            result[text] = response.data[i].embedding
        
        return result
    except Exception as e:
        print(f"{Colors.FAIL}Batch embedding error: {e}{Colors.ENDC}")
        return {}


def create_embeddings_for_curation(curation: Dict) -> List[Dict]:
    """Create embeddings for all category+concept pairs in a curation"""
    embeddings = []
    texts_to_embed = []
    metadata = []
    
    categories = curation.get('categories', {})
    
    # Collect all texts
    for category, concepts in categories.items():
        if not isinstance(concepts, list):
            continue
        
        for concept in concepts:
            text = f"{category} {concept}"
            texts_to_embed.append(text)
            metadata.append({
                'category': category,
                'concept': concept,
                'text': text
            })
    
    if not texts_to_embed:
        return []
    
    # Generate embeddings in batch
    print(f"  Generating {len(texts_to_embed)} embeddings...")
    embeddings_map = generate_embeddings_batch(texts_to_embed)
    
    if not embeddings_map:
        return []
    
    # Build embeddings array
    for meta in metadata:
        text = meta['text']
        if text in embeddings_map:
            embeddings.append({
                'text': text,
                'category': meta['category'],
                'concept': meta['concept'],
                'vector': embeddings_map[text]
            })
    
    return embeddings


def update_curation_embeddings(curation_id: str, embeddings: List[Dict]) -> bool:
    """Update curation with embeddings via PATCH API"""
    try:
        headers_api = {
            "X-API-Key": API_SECRET_KEY,
            "Content-Type": "application/json"
        }
        
        update_data = {
            "embeddings": embeddings,
            "embeddings_metadata": {
                "model": EMBEDDING_MODEL,
                "dimensions": EMBEDDING_DIMENSIONS,
                "total_embeddings": len(embeddings),
                "created_at": datetime.utcnow().isoformat() + "Z"
            }
        }
        
        response = requests.patch(
            f"{API_CURATIONS_URL}/{curation_id}",
            json=update_data,
            headers=headers_api,
            timeout=30
        )
        
        if response.status_code == 200:
            return True
        else:
            error_msg = f"Failed: {response.status_code}"
            try:
                error_data = response.json()
                if "detail" in error_data:
                    error_msg += f" - {error_data['detail']}"
            except:
                error_msg += f" - {response.text[:100]}"
            print(f"{Colors.FAIL}{error_msg}{Colors.ENDC}")
            return False
        
    except Exception as e:
        print(f"{Colors.FAIL}Update error: {e}{Colors.ENDC}")
        return False


def get_all_curations() -> List[Dict]:
    """Fetch all curations from API"""
    try:
        all_curations = []
        offset = 0
        limit = 100
        
        while True:
            response = requests.get(
                f"{API_CURATIONS_URL}/search",
                params={"limit": limit, "offset": offset},
                timeout=30
            )
            
            if response.status_code != 200:
                break
            
            results = response.json()
            items = results.get("items", [])
            
            if not items:
                break
            
            all_curations.extend(items)
            
            if len(items) < limit:
                break
            
            offset += limit
        
        return all_curations
    except Exception as e:
        print(f"{Colors.FAIL}Error fetching curations: {e}{Colors.ENDC}")
        return []


def main():
    """Main execution"""
    print(f"{Colors.HEADER}{Colors.BOLD}")
    print("="*80)
    print("Curation Embeddings Generator")
    print("="*80)
    print(f"{Colors.ENDC}\n")
    
    print(f"{Colors.OKCYAN}Configuration:{Colors.ENDC}")
    print(f"  Model: {EMBEDDING_MODEL}")
    print(f"  Dimensions: {EMBEDDING_DIMENSIONS}")
    print(f"  Batch size: {BATCH_SIZE}\n")
    
    # Fetch all curations
    print(f"{Colors.OKCYAN}Fetching curations...{Colors.ENDC}")
    curations = get_all_curations()
    print(f"{Colors.OKGREEN}Found {len(curations)} curations{Colors.ENDC}\n")
    
    if not curations:
        print(f"{Colors.WARNING}No curations to process{Colors.ENDC}")
        return
    
    # Ask for mode
    print(f"{Colors.OKCYAN}Select mode:{Colors.ENDC}")
    print(f"  {Colors.BOLD}1{Colors.ENDC} - Process all curations (overwrite existing embeddings)")
    print(f"  {Colors.BOLD}2{Colors.ENDC} - Process only curations without embeddings")
    print()
    
    mode = input(f"{Colors.BOLD}Choose mode (1/2): {Colors.ENDC}").strip()
    
    if mode not in ['1', '2']:
        print(f"{Colors.FAIL}Invalid option. Exiting.{Colors.ENDC}")
        return
    
    print()
    
    # Filter curations based on mode
    if mode == '2':
        curations = [c for c in curations if not c.get('embeddings')]
        print(f"{Colors.OKGREEN}Processing {len(curations)} curations without embeddings{Colors.ENDC}\n")
    
    # Stats
    stats = {
        'total': len(curations),
        'processed': 0,
        'failed': 0,
        'total_embeddings': 0
    }
    
    # Process curations
    for idx, curation in enumerate(curations, 1):
        curation_id = curation.get('_id') or curation.get('curation_id')
        entity_id = curation.get('entity_id', 'unknown')
        
        print(f"{Colors.BOLD}[{idx}/{stats['total']}] {curation_id}{Colors.ENDC}")
        print(f"  Entity: {entity_id}")
        
        # Generate embeddings
        embeddings = create_embeddings_for_curation(curation)
        
        if not embeddings:
            print(f"  {Colors.WARNING}No embeddings generated - skipping{Colors.ENDC}\n")
            continue
        
        # Update curation
        success = update_curation_embeddings(curation_id, embeddings)
        
        if success:
            print(f"  {Colors.OKGREEN}✓ Updated with {len(embeddings)} embeddings{Colors.ENDC}\n")
            stats['processed'] += 1
            stats['total_embeddings'] += len(embeddings)
        else:
            print(f"  {Colors.FAIL}✗ Failed to update{Colors.ENDC}\n")
            stats['failed'] += 1
        
        # Rate limiting
        if idx % BATCH_SIZE == 0 and idx < stats['total']:
            print(f"{Colors.OKCYAN}Waiting {DELAY_BETWEEN_BATCHES}s (rate limit)...{Colors.ENDC}\n")
            time.sleep(DELAY_BETWEEN_BATCHES)
    
    # Summary
    print(f"\n{Colors.HEADER}{Colors.BOLD}")
    print("="*80)
    print("Generation Summary")
    print("="*80)
    print(f"{Colors.ENDC}")
    print(f"Total curations: {stats['total']}")
    print(f"{Colors.OKGREEN}Processed: {stats['processed']}{Colors.ENDC}")
    print(f"{Colors.FAIL}Failed: {stats['failed']}{Colors.ENDC}")
    print(f"Total embeddings created: {stats['total_embeddings']}")
    print(f"Average per curation: {stats['total_embeddings'] / max(stats['processed'], 1):.1f}")


if __name__ == "__main__":
    main()
