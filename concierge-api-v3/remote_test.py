"""
Remote Test Runner - Execute tests on Render deployment
Usage: python remote_test.py
"""
import requests
import sys
import urllib3

# Disable SSL warnings for testing (not recommended for production)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

RENDER_URL = "https://concierge-collector.onrender.com"
API_BASE = f"{RENDER_URL}/api/v3"

# Session with SSL verification disabled for testing
session = requests.Session()
session.verify = False

def test_health():
    """Test API health endpoint"""
    print("🏥 Testing health endpoint...")
    response = session.get(f"{API_BASE}/health")
    assert response.status_code == 200
    data = response.json()
    print(f"   ✅ API Status: {data.get('status')}")
    print(f"   ✅ MongoDB: {data.get('database')}")
    return True

def test_places_health():
    """Test Google Places health endpoint"""
    print("\n📍 Testing Places API health...")
    response = session.get(f"{API_BASE}/places/health")
    assert response.status_code == 200
    data = response.json()
    print(f"   ✅ Places Status: {data.get('status')}")
    print(f"   ✅ API Key: {data.get('api_key_configured')}")
    return True

def test_places_nearby():
    """Test Google Places nearby search"""
    print("\n🍽️  Testing nearby restaurant search...")
    params = {
        "latitude": -23.5505,
        "longitude": -46.6333,
        "radius": 1000,
        "type": "restaurant",
        "max_results": 3
    }
    response = session.get(f"{API_BASE}/places/nearby", params=params)
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert data["status"] == "OK"
    print(f"   ✅ Found {len(data['results'])} restaurants")
    
    if data['results']:
        place = data['results'][0]
        print(f"   ✅ Sample: {place.get('name')} (ID: {place.get('place_id', 'N/A')[:20]}...)")
    return True

def test_places_response_format():
    """Test API returns correct response format"""
    print("\n📋 Testing response format...")
    params = {
        "latitude": -23.5505,
        "longitude": -46.6333,
        "radius": 1000,
        "type": "restaurant",
        "max_results": 1
    }
    response = session.get(f"{API_BASE}/places/nearby", params=params)
    data = response.json()
    
    # Check response structure
    assert "results" in data, "Response should have 'results' key"
    assert "status" in data, "Response should have 'status' key"
    print("   ✅ Response has 'results' array (not 'places')")
    
    # Check place structure
    if data['results']:
        place = data['results'][0]
        assert "place_id" in place, "Place should have 'place_id' field"
        assert "id" not in place or "place_id" in place, "Should use 'place_id' not 'id'"
        print("   ✅ Places have 'place_id' field (not 'id')")
    
    return True

def run_all_tests():
    """Run all remote tests"""
    print("=" * 60)
    print("🧪 Remote Test Suite - Render Deployment")
    print("=" * 60)
    print(f"Target: {RENDER_URL}")
    print()
    
    tests = [
        ("Health Check", test_health),
        ("Places Health", test_places_health),
        ("Nearby Search", test_places_nearby),
        ("Response Format", test_places_response_format),
    ]
    
    passed = 0
    failed = 0
    
    for name, test_func in tests:
        try:
            test_func()
            passed += 1
        except AssertionError as e:
            print(f"   ❌ {name} failed: {e}")
            failed += 1
        except Exception as e:
            print(f"   ❌ {name} error: {e}")
            failed += 1
    
    print()
    print("=" * 60)
    print(f"📊 Results: {passed} passed, {failed} failed")
    print("=" * 60)
    
    return failed == 0

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
