# Environment Setup Guide - Concierge Collector

## ✅ Quick Environment Check

### Frontend (JavaScript)
```bash
cd /Users/wagnermontes/Documents/GitHub/Concierge-Collector
node --version    # v25.2.0 ✓
npm --version     # 11.6.2 ✓
npm test          # Run tests
```

### Backend (Python)
```bash
cd /Users/wagnermontes/Documents/GitHub/Concierge-Collector/concierge-api-v3

# IMPORTANT: Always activate venv first!
source venv/bin/activate

# Then run commands
python --version  # Python 3.12.11 ✓
pytest --version  # pytest 8.3.4 ✓
pytest            # Run tests
```

## 🔧 Setup Commands (One-time)

### Frontend Setup
```bash
cd /Users/wagnermontes/Documents/GitHub/Concierge-Collector
npm install
```

### Backend Setup
```bash
cd /Users/wagnermontes/Documents/GitHub/Concierge-Collector/concierge-api-v3

# Create venv (if not exists)
python3 -m venv venv

# Activate venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

## 📝 Common Commands

### Frontend Testing
```bash
# From project root
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage
npm run test:ui             # Interactive UI
npm test AudioRecording     # Specific file
```

### Backend Testing
```bash
# From concierge-api-v3/ WITH VENV ACTIVATED
pytest                      # All tests
pytest tests/test_auth.py   # Specific file
pytest -v                   # Verbose
pytest --cov=app            # With coverage
pytest -k "test_create"     # Filter by name
```

## ⚠️ Important Notes

1. **Backend:** ALWAYS activate venv first: `source venv/bin/activate`
2. **Frontend:** No special activation needed, just `npm test`
3. **Environment Variables:** Backend uses `concierge-api-v3/.env`, frontend uses project root

## 🚨 Troubleshooting

### "No module named pytest"
```bash
# You forgot to activate venv!
cd concierge-api-v3
source venv/bin/activate
pytest
```

### "command not found: npm"
```bash
# Node.js not installed or not in PATH
brew install node
```

### Tests failing with "API not available"
```bash
# Backend not running or .env not configured
cd concierge-api-v3
source venv/bin/activate
uvicorn main:app --reload
```

## 📦 Package Versions

### Frontend
- Node.js: v25.2.0
- npm: 11.6.2
- vitest: ^1.6.1
- jsdom: ^24.0.0

### Backend
- Python: 3.12.11
- pytest: 8.3.4
- pytest-asyncio: 0.24.0
- FastAPI: (check requirements.txt)

## 🔄 Before Running Tests

### Always:
```bash
# Frontend (from project root)
npm test

# Backend (from concierge-api-v3/)
source venv/bin/activate && pytest
```

### Never assume:
- ❌ Don't assume pytest is not installed - check venv first
- ❌ Don't assume dependencies are missing - they're in venv
- ✅ Always activate venv for backend commands
- ✅ Check environment before reporting missing packages
