# Restaurant Finder CLI

CLI tool to find and import top-rated restaurants from any city using Google Places API and Concierge API V3.

## Features

✅ **Smart Search**: Find restaurants via Google Places API  
✅ **Quality Filter**: Filter by minimum rating (1.0-5.0)  
✅ **Deduplication**: Checks existing entities by name and Google Place ID  
✅ **Beautiful CLI**: Rich tables, progress bars, and colored output  
✅ **Dry Run Mode**: Test without creating entities  
✅ **Batch Import**: Import up to 100 restaurants at once  
✅ **25+ Cities**: Pre-configured major cities worldwide

## Installation

```bash
pip install rich httpx
```

## Usage

### Basic Usage
```bash
python scripts/find_restaurants.py --city "Rio de Janeiro" --limit 10
```

### With Rating Filter
```bash
python scripts/find_restaurants.py --city "New York" --limit 20 --min-rating 4.5
```

### Dry Run (Test Without Creating)
```bash
python scripts/find_restaurants.py --city "Paris" --limit 15 --dry-run
```

### Custom API URL
```bash
python scripts/find_restaurants.py --city "Tokyo" --limit 10 --api-url http://localhost:8000
```

### Skip Details (Faster)
```bash
# Skip detailed place information - uses only search results
python scripts/find_restaurants.py --city "Barcelona" --limit 50 --no-details
```

## Arguments

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--city` | ✅ Yes | - | City name (e.g., "Rio de Janeiro", "New York") |
| `--limit` | No | 20 | Maximum number of restaurants (1-100) |
| `--min-rating` | No | 4.0 | Minimum rating (1.0-5.0) |
| `--type` | No | restaurant | Place type (restaurant, cafe, bar, etc.) |
| `--dry-run` | No | False | Test mode - no entities created |
| `--no-details` | No | False | Skip detailed API calls (faster) |
| `--api-url` | No | http://localhost:8000 | Concierge API base URL |

## Supported Cities

### Americas
- Rio de Janeiro, São Paulo, Brasília (Brazil)
- New York, Los Angeles, Chicago, Miami (USA)
- Toronto, Vancouver (Canada)
- Mexico City (Mexico)
- Buenos Aires (Argentina)
- Lima (Peru)

### Europe
- London (UK)
- Paris, Lyon, Marseille (France)
- Barcelona, Madrid, Valencia (Spain)
- Rome, Milan (Italy)
- Berlin, Munich (Germany)
- Amsterdam (Netherlands)
- Lisbon, Porto (Portugal)

### Asia & Oceania
- Tokyo, Osaka, Kyoto (Japan)
- Bangkok (Thailand)
- Singapore
- Dubai (UAE)
- Sydney, Melbourne (Australia)

*For other cities, the script will attempt to geocode the name via Google Places API.*

## Output Example

```
🍽️  Restaurant Finder CLI
City: Rio de Janeiro | Limit: 10 | Min Rating: 4.5

✅ API is accessible
🔍 Searching for restaurants in Rio de Janeiro...
✅ Found 10 places (filtered from 20)

┏━━┳━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━┳━━━━━━━━┳━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━┓
┃  ┃ Name                ┃ Rating ┃ Reviews┃ Price┃ Address               ┃
┣━━╋━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━╋━━━━━━━━╋━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━┫
┃1 ┃ Fogo de Chão        ┃ ⭐ 4.8 ┃ 32979  ┃ $$   ┃ Av. Reporter Nestor...┃
┃2 ┃ Tacacá do Norte     ┃ ⭐ 4.7 ┃  5565  ┃ $$   ┃ Rua Barão de Iguatemi ┃
┃3 ┃ Joia Comida         ┃ ⭐ 4.7 ┃  1608  ┃ $$$  ┃ R. do Lavradio, 133   ┃
┗━━┻━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━┻━━━━━━━━┻━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━┛

📥 Importing restaurants...
   ✅ Fogo de Chão
   ✅ Tacacá do Norte
   ✅ Joia Comida

📊 Import Statistics
Total Found: 10
✅ Created: 10
⚠️ Duplicates: 0
❌ Errors: 0

✅ Import complete!
```

## How It Works

1. **Search**: Uses `/places/nearby` endpoint (proxied Google Places API)
2. **Filter**: Filters by rating and sorts by rating + review count
3. **Deduplicate**: Checks existing entities via `/entities` endpoint
4. **Transform**: Converts Google Places format → Entity format
5. **Create**: Creates entities via `POST /entities` endpoint

## Entity Data Mapping

The script transforms Google Places data into Concierge entities:

```python
{
    "name": place.name,
    "entity_type": "restaurant",
    "category": "Restaurants",
    "google_place_id": place.place_id,
    "coordinates": {
        "latitude": place.geometry.location.latitude,
        "longitude": place.geometry.location.longitude
    },
    "contact": {
        "phone": place.formatted_phone_number,
        "website": place.website
    },
    "metadata": {
        "google_rating": place.rating,
        "user_ratings_total": place.user_ratings_total,
        "price_level": place.price_level,
        "address": place.formatted_address,
        "photos": [place.photos[0:5]]
    }
}
```

## Error Handling

- ❌ **API Unreachable**: Check if API is running (`curl http://localhost:8000/api/v3/health`)
- ❌ **Invalid City**: Add city coordinates to `_get_city_coordinates()` or use exact name
- ❌ **No Results**: Try lowering `--min-rating` or increasing `--limit`
- ❌ **502 Bad Gateway**: Google Places API issue - check API key in API V3 config

## Limitations

- **Rate Limits**: Google Places API has rate limits (check your quota)
- **Results**: Maximum 60 results per search (Google Places limitation)
- **Cities**: Only 25+ cities hardcoded - others require exact name matching
- **Updates**: Currently only creates new entities - doesn't update existing ones

## Future Improvements

- 🔄 **Update Mode**: Update existing entities instead of only creating
- 🌍 **Geocoding API**: Auto-resolve any city name (not just hardcoded)
- 📊 **Progress File**: Resume interrupted imports
- 🔍 **Search by Type**: Cafe, bar, bakery, etc.
- 🏷️ **Auto-Tagging**: Extract tags from reviews/types

## Debug Mode

Use Python's verbose output for debugging:

```bash
python -u scripts/find_restaurants.py --city "Rio de Janeiro" --limit 3 --dry-run 2>&1
```

## Related Scripts

- **import_michelin_restaurants.py**: Import from Michelin CSV files
- **export_entities.py**: Export entities to JSON

## License

Part of Concierge Collector project.
