# API Authentication & Security

## 🔐 Overview

The Concierge Collector API V3 uses **API Key authentication** to protect write operations. This ensures only authorized clients can create, update, or delete data.

## Authentication Method

**Type:** API Key via HTTP Header  
**Header Name:** `X-API-Key`  
**Format:** URL-safe base64 string (256 bits of entropy)

## Protected Endpoints

### ✅ Authentication Required

All write operations require the `X-API-Key` header:

```http
POST   /api/v3/entities           - Create entity
PATCH  /api/v3/entities/{id}      - Update entity
DELETE /api/v3/entities/{id}      - Delete entity

POST   /api/v3/curations          - Create curation
PATCH  /api/v3/curations/{id}     - Update curation
DELETE /api/v3/curations/{id}     - Delete curation

POST   /api/v3/ai/orchestrate     - AI orchestration (costs money!)
```

### 🌐 Public Endpoints (No Auth)

Read operations are publicly accessible:

```http
GET    /api/v3/entities           - List entities
GET    /api/v3/entities/{id}      - Get entity details
GET    /api/v3/curations          - List curations
GET    /api/v3/health             - Health check
GET    /api/v3/info               - API info
GET    /api/v3/places/*           - Google Places integration
GET    /api/v3/ai/health          - AI services health
```

---

## Setup Guide

### 1. Generate API Key

**Option A: Using provided script**
```bash
cd concierge-api-v3
python scripts/generate_api_key.py
```

**Option B: Using Python directly**
```bash
python -c 'import secrets; print(secrets.token_urlsafe(32))'
```

**Example output:**
```
7AxYmOWqcVoSUylQQ3do5_nHAf9Fxh4i7-EhD-2wxoc
```

### 2. Configure Environment

Add to your `.env` file:

```bash
# API Security
API_SECRET_KEY=7AxYmOWqcVoSUylQQ3do5_nHAf9Fxh4i7-EhD-2wxoc
```

⚠️ **IMPORTANT:**
- Never commit `.env` to git (already in `.gitignore`)
- Use different keys for dev/staging/production
- Keep your key secret - treat it like a password

### 3. Test Configuration

```bash
# Start server
uvicorn main:app --reload

# Test without auth (should fail)
curl -X POST http://localhost:8000/api/v3/entities \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "test", "type": "restaurant", "name": "Test"}'

# Expected response: 403 Forbidden

# Test with auth (should succeed)
curl -X POST http://localhost:8000/api/v3/entities \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 7AxYmOWqcVoSUylQQ3do5_nHAf9Fxh4i7-EhD-2wxoc" \
  -d '{"entity_id": "test", "type": "restaurant", "name": "Test"}'

# Expected response: 201 Created
```

---

## Usage Examples

### JavaScript/Fetch

```javascript
const API_KEY = '7AxYmOWqcVoSUylQQ3do5_nHAf9Fxh4i7-EhD-2wxoc';

// Create entity
const response = await fetch('http://localhost:8000/api/v3/entities', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY
  },
  body: JSON.stringify({
    entity_id: 'rest_001',
    type: 'restaurant',
    name: 'Amazing Restaurant'
  })
});

const data = await response.json();
console.log(data);
```

### Python/Requests

```python
import requests

API_KEY = '7AxYmOWqcVoSUylQQ3do5_nHAf9Fxh4i7-EhD-2wxoc'

# Create entity
response = requests.post(
    'http://localhost:8000/api/v3/entities',
    headers={'X-API-Key': API_KEY},
    json={
        'entity_id': 'rest_001',
        'type': 'restaurant',
        'name': 'Amazing Restaurant'
    }
)

print(response.json())
```

### cURL

```bash
curl -X POST http://localhost:8000/api/v3/entities \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 7AxYmOWqcVoSUylQQ3do5_nHAf9Fxh4i7-EhD-2wxoc" \
  -d '{
    "entity_id": "rest_001",
    "type": "restaurant",
    "name": "Amazing Restaurant"
  }'
```

---

## Error Responses

### Missing API Key

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: ApiKey

{
  "detail": "Missing API key. Include X-API-Key header in your request."
}
```

### Invalid API Key

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: ApiKey

{
  "detail": "Invalid API key"
}
```

### API Key Not Configured (Server Error)

```http
HTTP/1.1 500 Internal Server Error

{
  "detail": "API_SECRET_KEY not configured. Generate one with: python -c 'import secrets; print(secrets.token_urlsafe(32))'"
}
```

---

## Security Best Practices

### ✅ DO

- **Generate strong keys** using `secrets.token_urlsafe(32)` (256 bits)
- **Use HTTPS in production** to encrypt API keys in transit
- **Store keys in environment variables** never in code
- **Use different keys** for development, staging, production
- **Rotate keys periodically** (e.g., every 90 days)
- **Monitor API usage** for suspicious activity
- **Revoke compromised keys immediately**
- **Use rate limiting** in production (coming soon)

### ❌ DON'T

- ❌ Commit `.env` to git
- ❌ Share keys in Slack, email, or documents
- ❌ Use the same key across environments
- ❌ Hardcode keys in frontend code
- ❌ Expose keys in URLs or logs
- ❌ Use weak/predictable keys
- ❌ Keep using a key you suspect is compromised

---

## Key Rotation

When rotating keys (recommended every 90 days):

1. **Generate new key**
   ```bash
   python scripts/generate_api_key.py
   ```

2. **Update `.env`**
   ```bash
   API_SECRET_KEY=<new_key_here>
   ```

3. **Restart server**
   ```bash
   # Development
   uvicorn main:app --reload
   
   # Production (systemd)
   sudo systemctl restart concierge-api
   ```

4. **Update all clients** with new key

5. **Monitor** for authentication failures

6. **Document** rotation in changelog

---

## Testing with Authentication

Tests use a dedicated test key defined in `conftest.py`:

```python
TEST_API_KEY = "test_api_key_for_testing_only"
```

Use the `auth_headers` fixture in tests:

```python
@pytest.mark.asyncio
async def test_create_entity(client, sample_entity_data, auth_headers):
    response = await client.post(
        "/api/v3/entities",
        json=sample_entity_data,
        headers=auth_headers  # Includes X-API-Key
    )
    assert response.status_code == 201
```

Run tests:
```bash
pytest tests/ -v
```

---

## Production Deployment

### Environment Variables

```bash
# Production .env
ENVIRONMENT=production
API_SECRET_KEY=<strong_production_key>

# MongoDB (with strong password)
MONGODB_URL=mongodb+srv://user:strong_password@cluster.mongodb.net/
MONGODB_DB_NAME=concierge-collector

# External APIs (regenerate these!)
GOOGLE_PLACES_API_KEY=<restricted_production_key>
OPENAI_API_KEY=<production_key_with_limits>
```

### Additional Security Layers

1. **HTTPS Only**
   - Use nginx or traefik as reverse proxy
   - Enforce TLS 1.2+
   - HSTS headers

2. **Rate Limiting**
   ```bash
   pip install slowapi
   ```
   (Implementation guide coming soon)

3. **IP Whitelisting** (optional)
   - Restrict MongoDB Atlas to known IPs
   - Use firewall rules for API

4. **Monitoring**
   - Log all authentication failures
   - Alert on suspicious patterns
   - Track API usage by endpoint

---

## Troubleshooting

### "Missing API key" error

**Problem:** Request doesn't include `X-API-Key` header

**Solution:**
```javascript
// Add header to your request
headers: {
  'X-API-Key': 'your_key_here'
}
```

### "Invalid API key" error

**Problem:** API key doesn't match `API_SECRET_KEY` in `.env`

**Solutions:**
1. Verify key in `.env` file
2. Restart server after changing `.env`
3. Check for typos in key
4. Regenerate key if needed

### "API_SECRET_KEY not configured" error

**Problem:** Environment variable not set

**Solution:**
```bash
# Generate and add to .env
python scripts/generate_api_key.py
echo "API_SECRET_KEY=<generated_key>" >> .env
```

### Tests failing with 403

**Problem:** Tests not using `auth_headers` fixture

**Solution:**
```python
# Add auth_headers parameter
async def test_endpoint(client, auth_headers):
    response = await client.post(url, headers=auth_headers)
```

---

## API Key Management Service (Future)

Planned features for key management:

- [ ] Multiple API keys per environment
- [ ] Key scopes/permissions (read-only, full-access)
- [ ] Automatic key rotation
- [ ] Usage analytics per key
- [ ] API key revocation endpoint
- [ ] Key expiration dates
- [ ] Admin dashboard for key management

---

## Support

For security issues or questions:
- Check this documentation first
- Review error messages carefully
- Test with cURL before debugging client code
- Contact: [your-email@example.com]

**⚠️ Security Vulnerability?**
Report privately via email, don't open public issues.

---

## Changelog

### 2025-11-17 - Initial Implementation
- ✅ API Key authentication implemented
- ✅ Protected write endpoints (POST, PATCH, DELETE)
- ✅ Public read endpoints (GET)
- ✅ Test suite updated with auth
- ✅ Documentation complete
- ✅ Key generation script added

### Next Steps
- [ ] Add rate limiting
- [ ] Implement usage analytics
- [ ] Add IP whitelisting option
- [ ] Create admin key management UI
