# PythonAnywhere Deployment Guide

## MongoDB Atlas Setup ✅
- **Cluster**: concierge-collector.7bwiisy.mongodb.net
- **Username**: wmontes_db_user
- **Password**: JSpeUhOW9YyU6qPB
- **Database**: concierge_collector_v4

## Pre-Deployment Checklist

### 1. Security Configuration
```bash
# Generate a secure SECRET_KEY (run locally)
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```
Update `SECRET_KEY` in `.env.production` with the generated key.

### 2. MongoDB Atlas Whitelist
- Go to MongoDB Atlas → Network Access
- Add PythonAnywhere IP ranges or use `0.0.0.0/0` (allow from anywhere)
- **Important**: This is required for PythonAnywhere to connect

### 3. Test MongoDB Connection Locally
```bash
# Test connection string
python3 -c "from pymongo import MongoClient; client = MongoClient('mongodb+srv://wmontes_db_user:JSpeUhOW9YyU6qPB@concierge-collector.7bwiisy.mongodb.net/?retryWrites=true&w=majority'); print('✅ Connected:', client.list_database_names())"
```

## PythonAnywhere Deployment Steps

### 1. Upload Files to PythonAnywhere
```bash
# From your local machine, create a deployment package
cd /Users/wagnermontes/Documents/GitHub/Concierge-Collector/concierge-api-v4
tar -czf concierge-api-v4.tar.gz app/ requirements.txt .env.production

# Upload via PythonAnywhere Files tab or use scp
```

### 2. Setup on PythonAnywhere Console
```bash
# SSH into PythonAnywhere console
cd ~
mkdir concierge-api-v4
cd concierge-api-v4

# Upload and extract files (or use Git)
# If using the tar file:
tar -xzf concierge-api-v4.tar.gz

# Copy production config
cp .env.production .env

# Update SECRET_KEY in .env with your secure key
nano .env  # Edit and change SECRET_KEY
```

### 3. Install Dependencies
```bash
# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Test API Locally
```bash
# Still in PythonAnywhere console
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Test in another terminal
curl http://localhost:8000/health
```

### 5. Configure WSGI File
PythonAnywhere Web Tab → WSGI configuration file:

```python
# /var/www/wsmontes_pythonanywhere_com_wsgi.py
import sys
import os

# Add your project directory to the sys.path
project_home = '/home/wsmontes/concierge-api-v4'
if project_home not in sys.path:
    sys.path.insert(0, project_home)

# Activate virtual environment
activate_this = os.path.join(project_home, 'venv/bin/activate_this.py')
with open(activate_this) as f:
    exec(f.read(), {'__file__': activate_this})

# Import FastAPI application
from app.main import app as application
```

### 6. Configure Static Files (Optional)
Web Tab → Static files:
- URL: `/static`
- Directory: `/home/wsmontes/concierge-api-v4/static`

### 7. Reload Web App
Click "Reload" button in PythonAnywhere Web tab

## Verification

### Test Endpoints
```bash
# Health check
curl https://wsmontes.pythonanywhere.com/health

# Get entities (should require auth in production)
curl https://wsmontes.pythonanywhere.com/entities/
```

### Expected Results
- `DEV_MODE=false` → Authentication required
- MongoDB Atlas connected
- All CRUD operations working

## Frontend Integration

Update `config.js` in frontend:
```javascript
// For production
api: {
    version: 'v4',
    baseUrl: 'https://wsmontes.pythonanywhere.com',
    endpoints: {
        // ... existing endpoints
    }
}
```

## Troubleshooting

### Connection Issues
- Check MongoDB Atlas whitelist (Network Access)
- Verify connection string format
- Check PythonAnywhere error logs: `/var/log/wsmontes.pythonanywhere.com.error.log`

### Authentication Issues
- Ensure `DEV_MODE=false` in production `.env`
- Generate and use JWT tokens for API access
- Check CORS origins include your frontend domain

### Database Issues
- Verify MongoDB Atlas cluster is running
- Check database name matches: `concierge_collector_v4`
- Test connection string manually

## Monitoring

### PythonAnywhere Logs
```bash
# Error log
tail -f /var/log/wsmontes.pythonanywhere.com.error.log

# Access log
tail -f /var/log/wsmontes.pythonanywhere.com.access.log
```

### MongoDB Atlas Monitoring
- Go to Atlas Dashboard → Metrics
- Monitor connections, operations, storage

## Security Notes

⚠️ **CRITICAL**:
1. Never commit `.env` with production credentials to Git
2. Change `SECRET_KEY` from default value
3. Keep MongoDB Atlas password secure
4. Use HTTPS only in production
5. Enable proper CORS origins (not `*`)

## Next Steps

After deployment:
1. Test authentication flow
2. Create initial curator users via `/auth/register`
3. Verify sync operations work
4. Monitor performance and logs
5. Setup backup strategy for MongoDB Atlas
