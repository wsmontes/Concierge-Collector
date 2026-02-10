"""
Script to analyze restaurant data structure in MongoDB
Compares newly created restaurant with existing ones to validate schema compliance
"""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
import json
from datetime import datetime

load_dotenv()

# Expected Entity Schema according to V3 Architecture
EXPECTED_ENTITY_SCHEMA = {
    "required_root_fields": [
        "_id", "entity_id", "type", "name", "status", 
        "createdAt", "updatedAt", "version"
    ],
    "optional_root_fields": [
        "externalId", "metadata", "sync", "data", 
        "createdBy", "updatedBy"
    ],
    "data_structure": {
        "location": ["address", "city", "coordinates"],
        "contacts": ["phone", "website", "email"],
        "media": ["photos", "logo"],
        "attributes": ["cuisine", "priceRange", "rating"]
    },
    "metadata_structure": ["type", "source", "importedAt", "data"],
    "sync_structure": ["serverId", "status", "lastSyncedAt"]
}

def analyze_entity_structure(entity, entity_label="Entity"):
    """Analyze entity structure and compare with expected schema"""
    print(f"\n{'='*80}")
    print(f"📊 ANALYZING {entity_label.upper()}")
    print('='*80)
    
    issues = []
    warnings = []
    good_practices = []
    
    # Check root fields
    print("\n🔍 Root Fields:")
    for field in EXPECTED_ENTITY_SCHEMA["required_root_fields"]:
        has_field = field in entity or (field == "_id" and "_id" in entity)
        status = "✅" if has_field else "❌"
        print(f"  {status} {field}: {has_field}")
        if not has_field:
            issues.append(f"Missing required field: {field}")
    
    # Check optional fields
    print("\n📋 Optional Fields Present:")
    for field in EXPECTED_ENTITY_SCHEMA["optional_root_fields"]:
        if field in entity:
            print(f"  ✅ {field}: {type(entity[field]).__name__}")
            if field == "externalId" and entity[field]:
                good_practices.append(f"Has externalId: {entity[field]}")
    
    # Check data structure
    if "data" in entity and entity["data"]:
        print("\n📦 Data Structure:")
        data = entity["data"]
        for key, expected_subfields in EXPECTED_ENTITY_SCHEMA["data_structure"].items():
            if key in data:
                print(f"  ✅ {key}: {type(data[key]).__name__}")
                if isinstance(data[key], dict) and data[key]:
                    good_practices.append(f"Has {key} data")
                elif isinstance(data[key], dict) and not data[key]:
                    warnings.append(f"{key} is empty dict")
                elif isinstance(data[key], list) and not data[key]:
                    warnings.append(f"{key} is empty list")
            else:
                print(f"  ⚠️  {key}: missing")
    else:
        warnings.append("data field is empty or missing")
    
    # Check metadata
    if "metadata" in entity and entity["metadata"]:
        print(f"\n🏷️  Metadata: {len(entity['metadata'])} source(s)")
        for i, meta in enumerate(entity["metadata"]):
            print(f"  #{i+1}: type={meta.get('type')}, source={meta.get('source')}")
            good_practices.append(f"Has metadata from {meta.get('source')}")
    else:
        warnings.append("No metadata sources (expected for Google Places imports)")
    
    # Check sync status
    if "sync" in entity and entity["sync"]:
        print(f"\n🔄 Sync Status:")
        sync = entity["sync"]
        print(f"  Status: {sync.get('status', 'unknown')}")
        if sync.get('status') == 'pending':
            warnings.append("Sync status is 'pending' - may not have synced to server yet")
        elif sync.get('status') == 'synced':
            good_practices.append("Successfully synced to server")
    
    # Check version
    if "version" in entity:
        version = entity["version"]
        print(f"\n📝 Version: {version}")
        if version > 1:
            good_practices.append(f"Entity has been updated {version - 1} time(s)")
    
    # Check timestamps
    print(f"\n⏰ Timestamps:")
    if "createdAt" in entity:
        print(f"  Created: {entity['createdAt']}")
    if "updatedAt" in entity:
        print(f"  Updated: {entity['updatedAt']}")
        if "createdAt" in entity:
            if entity["updatedAt"] != entity["createdAt"]:
                good_practices.append("Entity has been modified after creation")
    
    # Check type and status
    print(f"\n📌 Type & Status:")
    print(f"  Type: {entity.get('type', 'missing')}")
    print(f"  Status: {entity.get('status', 'missing')}")
    
    # Summary
    print(f"\n{'='*80}")
    print("📊 ANALYSIS SUMMARY")
    print('='*80)
    
    if issues:
        print(f"\n❌ ISSUES ({len(issues)}):")
        for issue in issues:
            print(f"  • {issue}")
    
    if warnings:
        print(f"\n⚠️  WARNINGS ({len(warnings)}):")
        for warning in warnings:
            print(f"  • {warning}")
    
    if good_practices:
        print(f"\n✅ GOOD PRACTICES ({len(good_practices)}):")
        for practice in good_practices:
            print(f"  • {practice}")
    
    if not issues:
        print("\n✅ Entity structure is VALID according to V3 schema")
    else:
        print("\n❌ Entity structure has ISSUES that need to be fixed")
    
    return {
        "issues": issues,
        "warnings": warnings,
        "good_practices": good_practices
    }

async def check_restaurant():
    mongo_uri = os.getenv('MONGODB_URL')
    db_name = os.getenv('MONGODB_DB_NAME')
    
    if not mongo_uri or not db_name:
        print("❌ MongoDB connection info not found in environment")
        return
    
    client = AsyncIOMotorClient(mongo_uri)
    db = client[db_name]
    
    # The IDs from the logs - newly created restaurant
    new_entity_id = "rest_teste_nasa_1770698630896"
    new_curation_id = "curation_1770698630903_dwjn4rwep"
    
    print("\n" + "="*80)
    print("🔬 MONGODB DATA STRUCTURE ANALYSIS")
    print("="*80)
    print(f"\nDatabase: {db_name}")
    print(f"Analyzing newly created restaurant: {new_entity_id}")
    
    # ========================================================================
    # PART 1: Get newly created entity
    # ========================================================================
    print(f"\n{'='*80}")
    print("🆕 NEWLY CREATED ENTITY (from Concierge Collector)")
    print('='*80)
    
    new_entity = await db.entities.find_one({'entity_id': new_entity_id})
    if new_entity:
        print("\n✅ Entity FOUND in MongoDB")
        print(f"\nRaw data:")
        # Keep _id for analysis
        raw_new = new_entity.copy()
        raw_new['_id'] = str(raw_new['_id'])
        print(json.dumps(raw_new, indent=2, ensure_ascii=False, default=str))
        
        # Analyze structure
        new_analysis = analyze_entity_structure(new_entity, "Newly Created Entity")
    else:
        print("❌ Entity NOT FOUND in MongoDB")
        client.close()
        return
    
    # ========================================================================
    # PART 2: Get existing entities for comparison
    # ========================================================================
    print(f"\n{'='*80}")
    print("📚 EXISTING ENTITIES (for comparison)")
    print('='*80)
    
    # Get a few real restaurant entities (not the test one)
    existing_entities = await db.entities.find({
        'type': 'restaurant',
        'entity_id': {'$ne': new_entity_id}  # Exclude the new one
    }).limit(3).to_list(length=3)
    
    print(f"\nFound {len(existing_entities)} existing restaurant(s) for comparison\n")
    
    existing_analyses = []
    for i, entity in enumerate(existing_entities, 1):
        print(f"\n{'─'*80}")
        print(f"EXISTING RESTAURANT #{i}: {entity.get('name', 'Unknown')}")
        print('─'*80)
        
        # Show compact view
        entity_copy = entity.copy()
        entity_copy['_id'] = str(entity_copy['_id'])
        
        # Remove large fields for readability
        if 'data' in entity_copy and 'embeddings' in entity_copy.get('data', {}):
            embeddings_count = len(entity_copy['data']['embeddings'])
            entity_copy['data']['embeddings'] = f"[{embeddings_count} embeddings removed]"
        
        print(f"\nCompact view:")
        print(json.dumps(entity_copy, indent=2, ensure_ascii=False, default=str))
        
        # Analyze
        analysis = analyze_entity_structure(entity, f"Existing Restaurant #{i}")
        existing_analyses.append(analysis)
    
    # ========================================================================
    # PART 3: Comparative Analysis
    # ========================================================================
    print(f"\n{'='*80}")
    print("🔍 COMPARATIVE ANALYSIS")
    print('='*80)
    
    print("\n📊 Issue Comparison:")
    print(f"  New Entity Issues: {len(new_analysis['issues'])}")
    for i, analysis in enumerate(existing_analyses, 1):
        print(f"  Existing #{i} Issues: {len(analysis['issues'])}")
    
    print("\n⚠️  Warning Comparison:")
    print(f"  New Entity Warnings: {len(new_analysis['warnings'])}")
    for i, analysis in enumerate(existing_analyses, 1):
        print(f"  Existing #{i} Warnings: {len(analysis['warnings'])}")
    
    print("\n✅ Good Practices Comparison:")
    print(f"  New Entity: {len(new_analysis['good_practices'])}")
    for i, analysis in enumerate(existing_analyses, 1):
        print(f"  Existing #{i}: {len(analysis['good_practices'])}")
    
    # Field comparison
    print(f"\n🔎 Field Presence Comparison:")
    fields_to_compare = ['data', 'metadata', 'sync', 'externalId', 'createdBy', 'updatedBy']
    
    print("\n  Field          | New | Exist #1 | Exist #2 | Exist #3")
    print("  " + "-"*60)
    for field in fields_to_compare:
        new_has = "✅" if field in new_entity and new_entity[field] else "❌"
        exist_has = []
        for entity in existing_entities:
            exist_has.append("✅" if field in entity and entity[field] else "❌")
        
        # Pad to ensure 3 columns
        while len(exist_has) < 3:
            exist_has.append("  ")
        
        print(f"  {field:14} | {new_has}  |    {exist_has[0]}    |    {exist_has[1]}    |    {exist_has[2]}")
    
    # ========================================================================
    # PART 4: Data field detailed comparison
    # ========================================================================
    print(f"\n{'='*80}")
    print("📦 DATA FIELD STRUCTURE COMPARISON")
    print('='*80)
    
    print("\n🆕 New Entity data fields:")
    if 'data' in new_entity and new_entity['data']:
        for key, value in new_entity['data'].items():
            value_type = type(value).__name__
            is_empty = (isinstance(value, dict) and not value) or (isinstance(value, list) and not value)
            status = "⚠️ empty" if is_empty else "✅"
            print(f"  {status} {key}: {value_type}")
    else:
        print("  ❌ data field is empty or missing")
    
    for i, entity in enumerate(existing_entities, 1):
        print(f"\n📚 Existing #{i} data fields:")
        if 'data' in entity and entity['data']:
            for key, value in entity['data'].items():
                value_type = type(value).__name__
                is_empty = (isinstance(value, dict) and not value) or (isinstance(value, list) and not value)
                status = "⚠️ empty" if is_empty else "✅"
                
                # Show sample for non-empty
                if not is_empty and key != 'embeddings':
                    if isinstance(value, dict):
                        sample_keys = list(value.keys())[:3]
                        print(f"  {status} {key}: {value_type} (keys: {', '.join(sample_keys)}...)")
                    elif isinstance(value, list):
                        print(f"  {status} {key}: {value_type} ({len(value)} items)")
                    else:
                        print(f"  {status} {key}: {value_type}")
                else:
                    print(f"  {status} {key}: {value_type}")
        else:
            print("  ❌ data field is empty or missing")
    
    # ========================================================================
    # PART 5: Final Recommendations
    # ========================================================================
    print(f"\n{'='*80}")
    print("💡 RECOMMENDATIONS FOR CONCIERGE COLLECTOR")
    print('='*80)
    
    recommendations = []
    
    # Check if new entity has empty data fields
    if 'data' in new_entity:
        for key, value in new_entity['data'].items():
            if isinstance(value, dict) and not value:
                recommendations.append(f"Populate {key} with actual data instead of empty dict")
            elif isinstance(value, list) and not value:
                recommendations.append(f"Add items to {key} array or remove if not applicable")
    
    # Check metadata
    if 'metadata' not in new_entity or not new_entity.get('metadata'):
        # Compare with existing
        has_metadata = any('metadata' in e and e['metadata'] for e in existing_entities)
        if has_metadata:
            recommendations.append("Consider adding metadata for data source tracking (existing entities have this)")
    
    # Check externalId
    if 'externalId' not in new_entity or not new_entity.get('externalId'):
        has_external = any('externalId' in e and e['externalId'] for e in existing_entities)
        if has_external:
            recommendations.append("Consider storing Google PlaceID in externalId field (if applicable)")
    
    # Check sync status
    if 'sync' in new_entity and new_entity['sync'].get('status') == 'pending':
        recommendations.append("Entity sync status is 'pending' - ensure it gets marked as 'synced' after successful API call")
    
    if recommendations:
        print("\n📋 Actions to improve data quality:")
        for i, rec in enumerate(recommendations, 1):
            print(f"  {i}. {rec}")
    else:
        print("\n✅ No major recommendations - entity structure looks good!")
    
    # ========================================================================
    # PART 6: Check associated curation
    # ========================================================================
    print(f"\n{'='*80}")
    print("🎨 ASSOCIATED CURATION")
    print('='*80)
    
    curation = await db.curations.find_one({'curation_id': new_curation_id})
    if curation:
        print("\n✅ Curation FOUND")
        curation['_id'] = str(curation['_id'])
        print(json.dumps(curation, indent=2, ensure_ascii=False, default=str))
    else:
        print("\n❌ Curation NOT FOUND")
    
    client.close()
    print(f"\n{'='*80}\n")

if __name__ == "__main__":
    asyncio.run(check_restaurant())
