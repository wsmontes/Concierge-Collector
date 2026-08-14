# Security Policy

## 🔒 Security Overview

Concierge Collector follows industry best practices for security and credential management. This document outlines our security policies and procedures.

---

## 🚨 Reporting Security Issues

If you discover a security vulnerability, please:

1. **DO NOT** open a public GitHub issue
2. Email the security team directly: [wmontes@gmail.com]
3. Include detailed description and steps to reproduce
4. Allow 48 hours for initial response

---

## 🔑 Credential Management

### Environment Variables (Production)

All sensitive credentials are stored in Render.com Environment Variables:

**Required Variables:**
```
MONGODB_URL                  # MongoDB Atlas connection string
MONGODB_DB_NAME             # Database name (concierge-collector)
OPENAI_API_KEY              # OpenAI API key for AI services
GOOGLE_OAUTH_CLIENT_ID      # Google OAuth 2.0 Client ID
GOOGLE_OAUTH_CLIENT_SECRET  # Google OAuth 2.0 Client Secret
API_SECRET_KEY              # JWT token signing key (32+ chars)
CORS_ORIGINS                # Comma-separated allowed origins
```

**Optional Variables:**
```
ENVIRONMENT                 # production/development
GOOGLE_PLACES_API_KEY       # Google Places API key (future feature)
```

### Local Development

1. **Never commit `.env` files:**
   - Protected by `.gitignore`
   - Contains sensitive credentials
   
2. **Use `.env.example` as template:**
   ```bash
   cp concierge-api-v3/.env.example concierge-api-v3/.env
   # Edit .env with your local credentials
   ```

3. **Use different credentials for dev/prod:**
   - Development: Local MongoDB or test Atlas cluster
   - Production: Production Atlas cluster with strict access controls

---

## 🛡️ Security Best Practices

### MongoDB Atlas

**✅ Implemented:**
- Database user authentication (not root/admin)
- SSL/TLS encryption for connections
- Connection string in environment variables only

**📋 Recommended:**
- Enable MongoDB Atlas IP whitelist
- Use VPC peering for production (paid tiers)
- Enable audit logs (Atlas M10+)
- Regular backup verification

### Google OAuth 2.0

**✅ Implemented:**
- PKCE flow for enhanced security
- State parameter for CSRF protection
- Refresh tokens for persistent sessions
- User authorization verification

**📋 Configuration:**
1. Authorized JavaScript Origins:
   ```
   http://localhost:8080
   https://concierge-collector-web.onrender.com
   https://concierge-collector.onrender.com
   ```

2. Authorized Redirect URIs:
   ```
   http://localhost:8000/api/v3/auth/callback
   https://concierge-collector.onrender.com/api/v3/auth/callback
   ```

### API Security

**✅ Implemented:**
- JWT tokens for session management
- Token expiration (1 hour for access, 30 days for refresh)
- CORS policy enforcement
- User authorization checks in backend

**📋 Recommended:**
- Rate limiting (future implementation)
- API key rotation every 90 days
- Webhook signature verification (future)

### CORS Policy

**Current Configuration:**
```
http://localhost:3000
http://localhost:5500
http://localhost:8080
http://127.0.0.1:5500
https://concierge-collector-web.onrender.com
https://concierge-collector.onrender.com
```

**Rules:**
- No wildcards (`*`) in production
- Exact domain matching required
- Include all subdomains explicitly

---

## 📝 Git Security

### Protected Files (.gitignore)

```
✅ Environment files:
- .env
- .env.*
- !.env.example

✅ Credentials:
- *.pem
- *.key
- *.crt
- secrets/
- credentials/

✅ Build artifacts:
- __pycache__/
- .venv/
- node_modules/
```

### Pre-commit Checks

Before committing:
1. Run `git status` to verify no `.env` files
2. Search for hardcoded credentials: `mongodb+srv://`, `sk-proj-`, API keys
3. Review diff for sensitive data

### If Credentials Are Exposed

**Immediate Actions:**
1. Rotate compromised credentials immediately
2. Revoke exposed API keys
3. Update Render.com environment variables
4. Force git history rewrite (if necessary):
   ```bash
   # USE WITH EXTREME CAUTION
   git filter-branch --force --index-filter \
     'git rm --cached --ignore-unmatch path/to/file' \
     --prune-empty --tag-name-filter cat -- --all
   ```

---

## 🔄 Credential Rotation Schedule

| Credential | Rotation Frequency | Last Rotated |
|------------|-------------------|--------------|
| MongoDB Password | 90 days | Setup date |
| OpenAI API Key | 90 days | Setup date |
| Google OAuth Secret | 180 days | Setup date |
| API_SECRET_KEY | 180 days | Setup date |

---

## 🚀 Deployment Security

### Render.com

**✅ Implemented:**
- Environment variables encrypted at rest
- HTTPS/TLS for all traffic
- Automatic SSL certificates
- Deploy from private GitHub repository

**📋 Access Control:**
- Limit Render.com team members
- Use GitHub branch protection rules
- Require PR reviews for `main` branch

### CI/CD Security

**Current:** Automatic deployment from `main` branch (auto-deploy is unreliable — deployments are verified and triggered manually after each push)

**Rules:**
- Only authorized contributors can merge to `main`
- All PRs require review
- No direct commits to production branch
- Build logs are private

---

## 📚 Security Resources

- [Render.com Security](https://render.com/docs/security)
- [MongoDB Atlas Security](https://www.mongodb.com/docs/atlas/security/)
- [Google OAuth 2.0 Best Practices](https://developers.google.com/identity/protocols/oauth2/best-practices)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

## ✅ Security Checklist

### Development
- [ ] Local `.env` file never committed
- [ ] Using `.env.example` as template
- [ ] Different credentials for dev/prod
- [ ] No hardcoded secrets in code

### Deployment
- [ ] All environment variables set in Render.com
- [ ] MongoDB Atlas IP whitelist configured
- [ ] Google OAuth origins/redirects configured
- [ ] CORS policy restrictive (no wildcards)
- [ ] API_SECRET_KEY is 32+ characters
- [ ] Branch protection enabled on `main`

### Maintenance
- [ ] Regular credential rotation (90-180 days)
- [ ] Monitor Render.com logs for suspicious activity
- [ ] Review MongoDB Atlas access logs
- [ ] Update dependencies regularly (`pip install -U`)

---

**Last Updated:** November 20, 2025  
**Security Contact:** wmontes@gmail.com
