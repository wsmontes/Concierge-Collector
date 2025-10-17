# Access Control Implementation Guide

## Overview
Simple password gate to prevent accidental access to the Concierge Collector application.

**Design:** Matches main application design system with Lotier logo, consistent typography, and color scheme.

## How It Works

### First Visit
1. User opens the application
2. Password prompt overlay appears
3. User enters password: `concierge2025`
4. Password is stored in localStorage
5. Application loads normally

### Subsequent Visits
- Application loads directly (no password prompt)
- Password remembered permanently in browser

## Security Level

**Protection:** Prevents accidental access only
- ✅ Random visitors cannot see restaurant data
- ✅ No setup friction for team members (enter once per device)
- ❌ NOT secure against intentional/technical access
- ❌ Data not encrypted (visible in DevTools if user knows how)

## Team Usage

### Share Password With Team
Send password via secure channel:
- Signal/WhatsApp message
- Password manager shared vault
- Email (less secure)

**Current password:** `concierge2025`

### First-Time Setup (Per Device)
1. Open application URL
2. Enter password when prompted
3. Click "Unlock" or press Enter
4. Done! No more prompts on this device

## Changing the Password

Edit `/scripts/accessControl.js`:

```javascript
const CORRECT_PASSWORD = 'your-new-password-here';
```

**Important:** After changing password:
- All team members must re-enter password on next visit
- Previous localStorage entries become invalid

## Resetting Access

### For Testing
Open browser console and run:
```javascript
AccessControl.resetAccess();
```
This will:
- Clear stored password
- Reload page with password prompt

### For Revoking Team Member Access
1. Change password in `accessControl.js`
2. Deploy updated version
3. User's stored password no longer works
4. They see password prompt on next visit

## Files Added

```
scripts/accessControl.js       - Access control logic
styles/access-control.css      - Password prompt styling
```

## Files Modified

```
index.html                     - Added CSS and script references
scripts/main.js                - Wrapped initialization in window.startApplication()
```

## Customization

### Change UI Text
Edit `scripts/accessControl.js`, find:
```javascript
overlay.innerHTML = `
    <div class="access-control-container">
        <div class="access-control-card">
            <h1>🔒 Concierge Collector</h1>  ← Change title
            <p>Enter password to access</p>  ← Change subtitle
```

### Change Colors
Edit `styles/access-control.css`:
```css
#access-control-overlay {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    /* Change gradient colors here */
}
```

## Troubleshooting

### Password Not Working
- Check browser console for errors
- Verify password in `accessControl.js` matches what you're entering
- Clear localStorage and try again: `localStorage.clear()`

### Prompt Not Appearing
- Check browser console for JavaScript errors
- Verify `accessControl.js` is loading before `main.js` in `index.html`
- Check network tab to ensure script files loaded

### Need to Reset for All Users
1. Change password in code
2. Deploy to GitHub Pages
3. All users will be prompted on next visit

## Technical Notes

- **Storage:** localStorage (persists until manually cleared)
- **Validation:** Client-side only (no server verification)
- **Encryption:** None (data remains unencrypted in IndexedDB)
- **Browser Support:** All modern browsers
- **Mobile:** Fully responsive, works on all devices

## Migration Path

If you later need stronger security:
1. Current implementation makes it easy to add encryption
2. Can wrap IndexedDB operations with encryption layer
3. Can integrate with OAuth/Auth0 for real authentication
4. Current localStorage key can be repurposed for session management
