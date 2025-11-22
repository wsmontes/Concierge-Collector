# ✅ Local Development Checklist

Use this checklist to verify your local development setup is working correctly.

## 📋 Initial Setup

- [ ] Python 3.9+ installed (`python3 --version`)
- [ ] Git repository cloned
- [ ] `.env` file created in `concierge-api-v3/`
- [ ] MongoDB configured (local or Atlas)
- [ ] Virtual environment created (`venv/` folder exists)
- [ ] Dependencies installed (`pip list` shows fastapi, uvicorn, motor, etc.)

## 🔧 Configuration

- [ ] `.env` contains `MONGODB_URL`
- [ ] `.env` contains `API_SECRET_KEY` (any value for local dev)
- [ ] (Optional) `.env` contains `GOOGLE_PLACES_API_KEY`
- [ ] (Optional) `.env` contains `OPENAI_API_KEY`
- [ ] (Optional) `.env` contains `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`
- [ ] `.env` file is git-ignored (should not appear in `git status`)

## 🚀 Backend Tests

- [ ] Start backend: `cd concierge-api-v3 && ./run_local.sh`
- [ ] Backend starts without errors
- [ ] Health check works: http://localhost:8000/api/v3/health returns JSON
- [ ] API info works: http://localhost:8000/api/v3/info returns JSON
- [ ] Swagger docs load: http://localhost:8000/api/v3/docs
- [ ] ReDoc loads: http://localhost:8000/api/v3/redoc

### MongoDB Tests (if configured)

- [ ] Backend connects to MongoDB (check startup logs for "✅ MongoDB connected")
- [ ] Can fetch entities: http://localhost:8000/api/v3/entities returns JSON array
- [ ] Can fetch curations: http://localhost:8000/api/v3/curations returns JSON array

### Places API Tests (if configured)

- [ ] Places search works: http://localhost:8000/api/v3/places/nearby?query=restaurant&location=40.7,-74.0
- [ ] Returns valid JSON with places array

### AI Tests (if configured)

- [ ] Concept extraction endpoint exists: http://localhost:8000/api/v3/ai/extract-concepts
- [ ] (Try POST with sample text to verify OpenAI key works)

## 🌐 Frontend Tests

- [ ] Open `index.html` with Live Server (VSCode)
- [ ] Or start server: `python3 -m http.server 5500`
- [ ] Frontend loads at http://127.0.0.1:5500
- [ ] No console errors in browser DevTools
- [ ] Check console for: "🚀 Initializing V3 API Service..."
- [ ] Check console shows: "baseUrl: http://localhost:8000/api/v3"
- [ ] UI loads without errors

### Frontend Features (No Auth Required)

- [ ] "Places" tab visible
- [ ] Places search field present
- [ ] Can search for restaurants (requires Places API key)
- [ ] Can view entity list (requires MongoDB)
- [ ] Can view curation list (requires MongoDB)

### Frontend Features (Auth Required)

- [ ] "Sign in with Google" button visible
- [ ] OAuth flow works (requires OAuth credentials)
- [ ] Can create entities after sign-in
- [ ] Can create curations after sign-in
- [ ] Can edit entities after sign-in

## 🔄 Environment Detection

- [ ] Open browser console on frontend
- [ ] Run: `console.log(AppConfig.api.backend.baseUrl)`
- [ ] Should show: `"http://localhost:8000/api/v3"`
- [ ] Backend logs show: "Running on http://localhost:8000"

## 🐛 Common Issues

### "Module not found" errors
```bash
cd concierge-api-v3
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

### "Cannot connect to MongoDB"
- Check MongoDB is running: `mongosh` or `mongo`
- Or use MongoDB Atlas URL in `.env`
- API will start anyway - only Places will work without MongoDB

### Frontend can't reach backend
- Verify backend is running: http://localhost:8000/api/v3/health
- Check browser console for CORS errors
- Add your frontend URL to `CORS_ORIGINS` in `.env`:
  ```
  CORS_ORIGINS=["http://localhost:5500","http://127.0.0.1:5500"]
  ```

### "401 Unauthorized" for write operations
- This is expected without OAuth sign-in
- Read operations (GET) work without auth
- Sign in with Google to enable write operations

### OAuth redirect error
- Check `.env` has `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`
- Verify redirect URI in Google Console includes: `http://localhost:8000/api/v3/auth/callback`
- Leave `GOOGLE_OAUTH_REDIRECT_URI` empty in `.env` for auto-detection

## ✨ Success Criteria

Your local environment is working correctly if:

1. ✅ Backend starts and responds to health checks
2. ✅ Frontend loads and connects to local backend
3. ✅ No critical errors in backend logs or browser console
4. ✅ At least one feature works (Places search OR entity list)
5. ✅ Environment detection shows local URLs (not production)

## 📚 Next Steps

Once everything works:

- [ ] Read [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) for development workflow
- [ ] Review [ENVIRONMENT_DETECTION.md](ENVIRONMENT_DETECTION.md) to understand auto-detection
- [ ] Check [API-REF/API_DOCUMENTATION_V3.md](API-REF/API_DOCUMENTATION_V3.md) for API reference
- [ ] Start building features!

## 🆘 Need Help?

1. Check backend logs for errors
2. Check browser console for frontend errors  
3. Verify environment detection: `console.log(AppConfig.environment)`
4. Test API directly: `curl http://localhost:8000/api/v3/health`
5. Review configuration: `cat concierge-api-v3/.env`
