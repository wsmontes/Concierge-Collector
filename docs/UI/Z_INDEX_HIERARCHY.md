# Z-Index Hierarchy Documentation
**Last Updated:** October 19, 2025  
**Purpose:** Maintain proper layering of UI elements

## Overview
This document defines the z-index stacking order for all UI elements in the Concierge Collector application to prevent visual conflicts and ensure proper layering.

---

## Z-Index Hierarchy (Lowest to Highest)

### **Layer 0-10: Base Content**
```
z-index: 0-10
```
**Elements:**
- Default page content
- Recording section (`#recording-section` = 1)
- Circular timer container (`#circular-timer-container` = 1)
- Timer display (`#timer` = 2)
- Audio preview (`#audio-preview` = 5)
- Processing status elements (`#processing-status`, `.processing-step` = 10)

**Purpose:** Normal document flow and content

---

### **Layer 1000: Dropdowns**
```
z-index: 1000 (--z-dropdown)
```
**Elements:**
- Select dropdowns
- Autocomplete menus
- Context menus

**Purpose:** Interactive menus that appear over content

---

### **Layer 1020: Sticky Elements**
```
z-index: 1020 (--z-sticky)
```
**Elements:**
- Sticky headers
- Sticky navigation
- Sticky filters

**Purpose:** Elements that stick during scroll

---

### **Layer 1030: Fixed Elements**
```
z-index: 1030 (--z-fixed)
```
**Elements:**
- Fixed toolbars (`#restaurant-edit-toolbar`, `#curator-edit-toolbar`)
- Floating Action Button (FAB)
- Fixed navigation

**Purpose:** Elements fixed to viewport

---

### **Layer 1040: Modal Backdrops**
```
z-index: 1040 (--z-modal-backdrop)
```
**Elements:**
- Modal overlay backgrounds
- `.loading-overlay` (from components.css)

**Purpose:** Dim background when modals are open

---

### **Layer 1050: Modals**
```
z-index: 1050 (--z-modal)
```
**Elements:**
- Modal dialogs
- Sync settings modal
- Confirmation dialogs

**Purpose:** Primary modal content

---

### **Layer 1060: Popovers**
```
z-index: 1060 (--z-popover)
```
**Elements:**
- Popovers
- Date pickers
- Color pickers

**Purpose:** Contextual UI that appears above modals

---

### **Layer 1070: Tooltips**
```
z-index: 1070 (--z-tooltip)
```
**Elements:**
- Tooltips
- Inline help text

**Purpose:** Informational overlays

---

### **Layer 9999: Toast Notifications**
```
z-index: 9999 !important
```
**Elements:**
- `.toastify` notifications
- `.toastify-container`
- `[class*="toast"]` elements

**Purpose:** Temporary notification messages that should appear above everything except loading

---

### **Layer 10000: Loading Overlay**
```
z-index: 10000 !important
```
**Elements:**
- `#loading-overlay` (main loading indicator)

**Purpose:** Highest priority - blocks all interaction during loading

---

## Design System Variables

From `styles/design-system.css`:
```css
--z-0: 0;
--z-10: 10;
--z-20: 20;
--z-30: 30;
--z-40: 40;
--z-50: 50;
--z-dropdown: 1000;
--z-sticky: 1020;
--z-fixed: 1030;
--z-modal-backdrop: 1040;
--z-modal: 1050;
--z-popover: 1060;
--z-tooltip: 1070;
```

---

## Implementation Rules

### ✅ **DO:**
1. Use design system variables when available
2. Document any new z-index values in this file
3. Keep related elements in same z-index layer
4. Use `!important` sparingly, only for critical overlays
5. Test z-index changes across all UI states

### ❌ **DON'T:**
1. Use arbitrary z-index values (e.g., 999999)
2. Create unnecessary stacking contexts
3. Mix inline styles with CSS for z-index
4. Use z-index without `position` property
5. Forget to update this documentation

---

## Common Issues & Solutions

### **Issue:** Recording timer appears above notifications
**Solution:** 
- Recording section: `z-index: 1`
- Notifications: `z-index: 9999 !important`
- Loading overlay: `z-index: 10000 !important`

### **Issue:** Modal appears behind toolbar
**Solution:**
- Toolbar: `z-index: 1030` (--z-fixed)
- Modal: `z-index: 1050` (--z-modal)

### **Issue:** Dropdown hidden by sticky header
**Solution:**
- Dropdown: `z-index: 1000` (--z-dropdown)
- Sticky header: `z-index: 1020` (--z-sticky)

---

## Testing Checklist

When adding or modifying z-index values:

- [ ] Test with recording section active
- [ ] Test with modals open
- [ ] Test with notifications showing
- [ ] Test with loading overlay active
- [ ] Test toolbar interactions
- [ ] Test on mobile viewport
- [ ] Test with multiple overlapping elements
- [ ] Verify no visual regression

---

## File Locations

### Z-Index Definitions:
1. **`styles/design-system.css`** - Design system variables (lines 179-192)
2. **`styles/mobile-enhancements.css`** - Recording section hierarchy (lines 600-680)
3. **`styles/components.css`** - Loading overlay, modals (line 857)
4. **`styles/style.css`** - Legacy overrides

### Usage Examples:
```css
/* Good - Using design system variable */
.my-modal {
    z-index: var(--z-modal);
}

/* Good - Documented custom value */
#loading-overlay {
    z-index: 10000 !important; /* Highest - blocks all interaction */
}

/* Bad - Arbitrary value */
.some-element {
    z-index: 99999; /* Don't do this */
}
```

---

## Visual Diagram

```
┌─────────────────────────────────────────┐
│ #loading-overlay (10000)                │ ← Blocks everything
├─────────────────────────────────────────┤
│ .toastify notifications (9999)          │ ← Always visible
├─────────────────────────────────────────┤
│ Tooltips (1070)                         │
├─────────────────────────────────────────┤
│ Popovers (1060)                         │
├─────────────────────────────────────────┤
│ Modals (1050)                           │
├─────────────────────────────────────────┤
│ Modal Backdrops (1040)                  │
├─────────────────────────────────────────┤
│ Fixed Toolbars (1030)                   │
├─────────────────────────────────────────┤
│ Sticky Elements (1020)                  │
├─────────────────────────────────────────┤
│ Dropdowns (1000)                        │
├─────────────────────────────────────────┤
│ Processing Status (10)                  │
├─────────────────────────────────────────┤
│ Audio Preview (5)                       │
├─────────────────────────────────────────┤
│ Timer (2)                               │
├─────────────────────────────────────────┤
│ Recording Section (1)                   │
├─────────────────────────────────────────┤
│ Base Content (0)                        │
└─────────────────────────────────────────┘
```

---

**Maintainers:** Review this document when:
- Adding new overlays or modals
- Fixing z-index conflicts
- Implementing new UI features
- Onboarding new developers

**Version:** 1.0  
**Status:** Active ✅
