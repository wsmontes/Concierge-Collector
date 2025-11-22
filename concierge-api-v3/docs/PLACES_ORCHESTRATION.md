# Google Places API Orchestration Endpoint

## Overview
The Places Orchestration endpoint provides a unified interface to all Google Places API (New) operations through a single endpoint with intelligent operation detection.

**Endpoint:** `POST /api/v3/places/orchestrate`

## Features
- ✅ Automatic operation detection based on input parameters
- ✅ Unified request/response format
- ✅ Support for all Places API operations:
  - Nearby Search (location-based)
  - Text Search (query-based)
  - Place Details (by place_id)
  - Place Photos (photo retrieval)
  - Autocomplete (predictions)

## Operation Detection Logic

The endpoint intelligently determines which API to call based on your input:

1. **Place Details**: If `place_id` is provided → Details API
2. **Text Search**: If `query` is provided → Text Search API
3. **Nearby Search**: If `latitude` + `longitude` + `included_types` → Nearby Search API
4. **Autocomplete**: Default fallback

## Request Format

```json
{
  // Search parameters
  "query": "italian restaurant",              // Optional: text query
  "place_id": "ChIJ...",                      // Optional: for details lookup
  
  // Location parameters
  "latitude": -23.561684,                     // Optional: center latitude
  "longitude": -46.655981,                    // Optional: center longitude
  "radius": 500.0,                            // Optional: search radius in meters (max 50000)
  
  // Filtering parameters
  "included_types": ["restaurant"],           // Optional: filter by types
  "excluded_types": ["bar"],                  // Optional: exclude types
  "min_rating": 4.0,                          // Optional: minimum rating (0-5)
  "price_levels": ["MODERATE", "EXPENSIVE"],  // Optional: price filters
  "open_now": true,                           // Optional: only open places
  
  // Response parameters
  "max_results": 20,                          // Optional: max results (1-20)
  "language": "en",                           // Optional: language code
  "region_code": "BR",                        // Optional: region code
  
  // Advanced parameters
  "rank_preference": "DISTANCE",              // Optional: POPULARITY or DISTANCE
  "fields": ["id", "displayName", "location"] // Optional: custom field mask
}
```

## Response Format

```json
{
  "operation": "text_search",  // Which operation was executed
  "results": [                 // Array of place results
    {
      "id": "ChIJ...",
      "displayName": {
        "text": "Restaurant Name",
        "languageCode": "pt"
      },
      "formattedAddress": "Address...",
      "location": {
        "latitude": -23.550347,
        "longitude": -46.6450502
      },
      "rating": 4.7,
      "priceLevel": "PRICE_LEVEL_EXPENSIVE",
      "types": ["restaurant", "food"]
    }
  ],
  "total_results": 3,
  "next_page_token": null
}
```

## Usage Examples

### 1. Text Search with Location Bias
Search for Italian restaurants near a specific location:

```bash
curl -X POST http://localhost:8000/api/v3/places/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "query": "italian restaurant",
    "latitude": -23.561684,
    "longitude": -46.655981,
    "radius": 1000,
    "max_results": 5
  }'
```

### 2. Nearby Search
Find all restaurants within 500m:

```bash
curl -X POST http://localhost:8000/api/v3/places/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": -23.561684,
    "longitude": -46.655981,
    "radius": 500,
    "included_types": ["restaurant"],
    "min_rating": 4.0,
    "open_now": true
  }'
```

### 3. Place Details
Get detailed information for a specific place:

```bash
curl -X POST http://localhost:8000/api/v3/places/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "place_id": "ChIJfadx80xYzpQRyHnuTnmQmDA"
  }'
```

### 4. Python Script Usage

```python
import requests

API_URL = "http://localhost:8000/api/v3/places/orchestrate"

def search_places(query: str, lat: float, lng: float):
    """Search for places near a location"""
    response = requests.post(API_URL, json={
        "query": query,
        "latitude": lat,
        "longitude": lng,
        "radius": 1000,
        "max_results": 10
    })
    
    if response.status_code == 200:
        data = response.json()
        print(f"Operation: {data['operation']}")
        print(f"Found {data['total_results']} results")
        
        for place in data['results']:
            print(f"- {place['displayName']['text']}")
            print(f"  ID: {place['id']}")
            print(f"  Rating: {place.get('rating', 'N/A')}")
    
    return response.json()

def get_place_details(place_id: str):
    """Get detailed information for a place"""
    response = requests.post(API_URL, json={
        "place_id": place_id
    })
    
    if response.status_code == 200:
        data = response.json()
        place = data['results'][0]
        
        print(f"Name: {place['displayName']['text']}")
        print(f"Address: {place.get('formattedAddress')}")
        print(f"Phone: {place.get('nationalPhoneNumber')}")
        print(f"Website: {place.get('websiteUri')}")
        print(f"Rating: {place.get('rating')}")
    
    return response.json()

# Examples
search_places("pizza", -23.561684, -46.655981)
get_place_details("ChIJfadx80xYzpQRyHnuTnmQmDA")
```

## Place Types

Common place types for filtering:

**Food & Dining:**
- `restaurant`
- `cafe`
- `bar`
- `bakery`
- `meal_takeaway`

**Cuisine Types:**
- `italian_restaurant`
- `brazilian_restaurant`
- `japanese_restaurant`
- `chinese_restaurant`
- `french_restaurant`

**Services:**
- `spa`
- `hair_care`
- `beauty_salon`
- `gym`

**Entertainment:**
- `night_club`
- `movie_theater`
- `art_gallery`
- `museum`

**Lodging:**
- `lodging`
- `hotel`

## Price Levels

- `PRICE_LEVEL_FREE`
- `PRICE_LEVEL_INEXPENSIVE`
- `PRICE_LEVEL_MODERATE`
- `PRICE_LEVEL_EXPENSIVE`
- `PRICE_LEVEL_VERY_EXPENSIVE`

## Field Mask

The endpoint uses a comprehensive default field mask. You can customize it by providing a `fields` parameter:

```json
{
  "query": "restaurant",
  "fields": [
    "id",
    "displayName",
    "formattedAddress",
    "location",
    "rating",
    "types",
    "priceLevel",
    "websiteUri",
    "nationalPhoneNumber",
    "regularOpeningHours"
  ]
}
```

## Error Handling

The endpoint returns standard HTTP status codes:

- `200`: Success
- `400`: Invalid request (missing required parameters)
- `500`: Google Places API error

Error response format:
```json
{
  "detail": "Error message"
}
```

## Rate Limits

- Respects Google Places API quotas
- Default timeout: 30 seconds
- Max results per request: 20 (Google API limit)

## Integration with Entity Management

This endpoint is used by:
- `scripts/import_michelin_full.py`: Find Google Place IDs during import
- `scripts/fix_entity_ids.py`: Update entity IDs to Google format
- Frontend search functionality

## Migration from Legacy Endpoints

**Old endpoints:**
```
GET /api/v3/places/nearby?lat=...&lng=...
GET /api/v3/places/details/{place_id}
```

**New unified endpoint:**
```
POST /api/v3/places/orchestrate
{
  "latitude": ...,
  "longitude": ...,
  "radius": ...
}
```

The old endpoints still work but the orchestration endpoint is recommended for new integrations.

## Production Configuration

Environment variables required:
- `GOOGLE_PLACES_API_KEY`: Your Google Places API key

The key should have:
- Places API (New) enabled
- Appropriate quotas and billing configured

## Testing

```bash
# Test health
curl http://localhost:8000/api/v3/places/health

# Test orchestrate
curl -X POST http://localhost:8000/api/v3/places/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "latitude": -23.5, "longitude": -46.6}'
```

## Implementation Details

**File:** `concierge-api-v3/app/api/places_orchestrate.py`

**Dependencies:**
- `fastapi`: Web framework
- `httpx`: Async HTTP client
- `pydantic`: Request/response validation

**Router registration:** Added to `main.py` as:
```python
app.include_router(places_orchestrate.router, prefix="/api/v3")
```
