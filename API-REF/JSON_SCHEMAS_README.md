# JSON Schemas and Examples

Complete JSON schemas and real-world examples for Concierge API V3.

## 📄 Files

### schemas.json
**Complete JSON Schema definitions (JSON Schema Draft-07)**

Includes schemas for:
- ✅ Entity (complete + create + update)
- ✅ Curation (complete + create + update)
- ✅ Metadata (extensible from multiple sources)
- ✅ SyncInfo (client-server sync)
- ✅ CuratorInfo (curator details)
- ✅ CurationCategories (AI-extracted concepts)
- ✅ PlaceResult (Google Places)
- ✅ AIOrchestrationRequest (AI workflows)
- ✅ ErrorResponse (standard errors)
- ✅ PaginatedResponse (list results)

**Usage:**
- Validate request/response data
- Generate TypeScript/Python types
- API testing and mocking
- Documentation generation

### examples.json
**Real-world request/response examples**

Complete examples for:
- ✅ **Entities:** create, get, update, list
- ✅ **Curations:** create with AI concepts, search
- ✅ **Places:** nearby search, place details
- ✅ **AI Services:** orchestrate, transcribe, extract concepts, analyze image
- ✅ **Errors:** validation, not found, conflict, unauthorized

**Features:**
- Full request bodies with realistic data
- Complete response structures
- All required and optional fields
- Multiple workflow examples
- Error scenarios

---

## 🚀 Quick Usage

### Validate Data

#### JavaScript
```javascript
import Ajv from 'ajv';
import schemas from './schemas.json';

const ajv = new Ajv();
const validate = ajv.compile(schemas.definitions.Entity);

const entity = {
  "_id": "673abc...",
  "entity_id": "rest_123",
  "type": "restaurant",
  "name": "Mario's",
  "createdAt": "2025-11-18T10:00:00Z",
  "updatedAt": "2025-11-18T10:00:00Z"
};

const valid = validate(entity);
if (!valid) {
  console.error(validate.errors);
}
```

#### Python
```python
import json
import jsonschema

with open('schemas.json') as f:
    schemas = json.load(f)

entity_schema = schemas['definitions']['Entity']

entity = {
    "_id": "673abc...",
    "entity_id": "rest_123",
    "type": "restaurant",
    "name": "Mario's",
    "createdAt": "2025-11-18T10:00:00Z",
    "updatedAt": "2025-11-18T10:00:00Z"
}

try:
    jsonschema.validate(entity, entity_schema)
    print("Valid!")
except jsonschema.ValidationError as e:
    print(f"Invalid: {e.message}")
```

### Generate Types

#### TypeScript (using json-schema-to-typescript)
```bash
npm install -g json-schema-to-typescript
json2ts schemas.json > types.d.ts
```

#### Python (using datamodel-code-generator)
```bash
pip install datamodel-code-generator
datamodel-codegen --input schemas.json --output models.py
```

---

## 📊 Schema Overview

### Entity Schema

**Required Fields:**
- `_id` (MongoDB ObjectId)
- `entity_id` (unique identifier)
- `type` (restaurant, hotel, venue, bar, cafe, other)
- `name` (1-500 characters)
- `createdAt` (ISO 8601 datetime)
- `updatedAt` (ISO 8601 datetime)

**Optional Fields:**
- `status` (active, inactive, draft)
- `externalId` (e.g., Google Place ID)
- `metadata[]` (array of Metadata objects)
- `sync` (SyncInfo object)
- `data` (flexible object for location, contacts, media, etc.)
- `createdBy` (curator ID)
- `updatedBy` (curator ID)
- `version` (optimistic locking version)

### Curation Schema

**Required Fields:**
- `_id` (MongoDB ObjectId)
- `curation_id` (unique identifier)
- `entity_id` (associated entity)
- `curator` (CuratorInfo object)
- `createdAt` (ISO 8601 datetime)
- `updatedAt` (ISO 8601 datetime)

**Optional Fields:**
- `notes` (public/private notes)
- `categories` (AI-extracted concepts)
- `sources[]` (audio, image, text, manual)
- `version` (optimistic locking version)

### Curation Categories (AI Concepts)

All fields are arrays of strings:
- `cuisine` - Cuisine types (Italian, Japanese, etc.)
- `mood` - Atmosphere (romantic, casual, etc.)
- `occasion` - Suitable occasions (date night, business, etc.)
- `price_range` - Price indicators ($, $$, $$$, $$$$)
- `setting` - Setting type (outdoor, rooftop, etc.)
- `crowd` - Typical crowd (families, couples, etc.)
- `food_style` - Food style (fine dining, casual, etc.)
- `drinks` - Drink offerings (craft cocktails, wine, etc.)
- `menu` - Menu items or highlights
- `suitable_for` - Suitable for (vegetarians, groups, etc.)

---

## 🎯 Example Scenarios

### Scenario 1: Create Restaurant from Google Places
```json
{
  "entity_id": "rest_marios_italian",
  "type": "restaurant",
  "name": "Mario's Italian Restaurant",
  "externalId": "ChIJN1t_tDeuEmsRUsoyG83frY4",
  "metadata": [{
    "type": "google_places",
    "source": "Google Places API",
    "data": {
      "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "rating": 4.5,
      "user_ratings_total": 1234
    }
  }]
}
```

### Scenario 2: Add Curation with AI Concepts
```json
{
  "curation_id": "cur_john_marios_2025_11_18",
  "entity_id": "rest_marios_italian",
  "curator": {
    "id": "user_john_doe",
    "name": "John Doe"
  },
  "categories": {
    "cuisine": ["Italian", "Pasta"],
    "mood": ["Romantic", "Intimate"],
    "occasion": ["Date Night"]
  },
  "sources": ["audio", "manual"]
}
```

### Scenario 3: AI Orchestration
```json
{
  "workflow_type": "auto",
  "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
  "audio_file": "base64_audio_data...",
  "curator_id": "user_john_doe",
  "output": {
    "save_to_db": true,
    "return_results": true
  }
}
```

---

## 🔗 Related Files

- **OpenAPI Schema:** [openapi.yaml](./openapi.yaml) - Auto-generated from FastAPI
- **Quick Reference:** [API_QUICK_REFERENCE.md](./API_QUICK_REFERENCE.md)
- **Complete Docs:** [API_DOCUMENTATION_V3.md](./API_DOCUMENTATION_V3.md)
- **Backend README:** [../concierge-api-v3/README.md](../concierge-api-v3/README.md)

---

## 📚 Documentation Standards

### JSON Schema Compliance
All schemas follow **JSON Schema Draft-07** specification:
- `$schema`: "http://json-schema.org/draft-07/schema#"
- Full type definitions with `required` fields
- Descriptions for all properties
- Enums for restricted values
- Format specifications (date-time, email, etc.)
- Min/max constraints where applicable

### Example Structure
Each example includes:
- **Description:** What the example demonstrates
- **Endpoint:** Full API endpoint path
- **Headers:** Required headers (Content-Type, X-API-Key, etc.)
- **Request:** Complete request body with realistic data
- **Response:** Full response including status, headers, and body

---

## 🛠️ Tools & Integration

### Postman
1. Import `examples.json` as Postman collection
2. Use schemas for request validation
3. Auto-generate mock servers

### Insomnia
1. Import `examples.json`
2. Use for API testing
3. Validate responses against schemas

### Swagger/OpenAPI
- Use alongside `openapi.yaml` for complete API documentation
- Generate interactive docs
- Client SDK generation

### Testing
```javascript
// Jest + AJV
const Ajv = require('ajv');
const schemas = require('./schemas.json');

test('validates entity', () => {
  const ajv = new Ajv();
  const validate = ajv.compile(schemas.definitions.Entity);
  const entity = { /* ... */ };
  expect(validate(entity)).toBe(true);
});
```

---

## 📝 Maintenance

### Updating Schemas
Schemas should be updated when:
- New fields are added to models
- Validation rules change
- New entity types are supported
- API structure changes

### Updating Examples
Examples should be updated when:
- New endpoints are added
- Request/response formats change
- New workflows are supported
- Error messages change

### Validation
Before committing changes:
1. Validate JSON syntax: `jsonlint schemas.json examples.json`
2. Check schema compliance: `ajv validate -s schemas.json -d examples.json`
3. Test examples against live API
4. Update related documentation

---

## 📊 Statistics

### schemas.json
- **Definitions:** 12 schemas
- **Lines:** ~450
- **Coverage:** All API entities and operations

### examples.json
- **Examples:** 15+ complete examples
- **Lines:** ~800
- **Coverage:** All endpoints + error scenarios

---

**Note:** These files complement the OpenAPI schema (`openapi.yaml`) by providing detailed JSON Schema validation and real-world examples.
