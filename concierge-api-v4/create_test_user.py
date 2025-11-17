"""
Quick script to create test user for Collector integration
"""
import requests
import json

API_URL = "http://localhost:8001/api/v4"

def create_test_user():
    """Create test user: test/test123"""
    url = f"{API_URL}/auth/register"
    data = {
        "username": "test",
        "password": "test123",
        "email": "test@test.com"
    }
    
    try:
        response = requests.post(url, json=data)
        print(f"Status: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)}")
        
        if response.status_code == 200:
            print("\n✅ Test user created successfully!")
            print("Username: test")
            print("Password: test123")
            return True
        else:
            print(f"\n⚠️ Failed to create user: {response.json()}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to API. Is it running on port 8001?")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def test_login():
    """Test login with created user"""
    url = f"{API_URL}/auth/login"
    data = {
        "username": "test",
        "password": "test123"
    }
    
    try:
        response = requests.post(url, data=data)  # Form data for OAuth2
        print(f"\n🔐 Login test:")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            token_data = response.json()
            print(f"✅ Login successful!")
            print(f"Token: {token_data['access_token'][:50]}...")
            return token_data['access_token']
        else:
            print(f"⚠️ Login failed: {response.json()}")
            return None
            
    except Exception as e:
        print(f"❌ Login error: {e}")
        return None

if __name__ == "__main__":
    print("🚀 Creating test user for Collector integration\n")
    
    if create_test_user():
        token = test_login()
        if token:
            print(f"\n✅ Ready for Collector integration!")
            print(f"\nUse this token for testing:")
            print(f"Authorization: Bearer {token}")
