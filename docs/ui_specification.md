# Restaurant Editor UX/UI Specification

## Overview

This document outlines the UX/UI specifications for the Restaurant Editor application, a companion tool to the Concierge Collector. The design system is built to ensure consistency, usability, and a seamless transition between both applications while providing the advanced functionality required for restaurant data management.

## Design System Foundation

### Technology Stack
- **CSS Framework**: Tailwind CSS (matching Concierge Collector)
- **Icons**: Material Icons
- **Typography**: Inter font family for UI, JetBrains Mono for code or monospaced elements
- **Component Library**: Custom components using Tailwind CSS utilities

## Visual Design Language

### Color Palette

The Restaurant Editor maintains the same core color palette as Concierge Collector:

```css
/* Primary Colors */
--primary: #7c3aed;        /* Violet 600 */
--primary-light: #a78bfa;  /* Violet 400 */
--primary-dark: #6d28d9;   /* Violet 700 */

/* Secondary Colors */
--secondary: #f97316;      /* Orange 500 */
--secondary-light: #fb923c;/* Orange 400 */

/* Neutral Colors */
--neutral-50: #fafafa;
--neutral-100: #f4f4f5;
--neutral-200: #e4e4e7;
--neutral-300: #d4d4d8;
--neutral-400: #a1a1aa;
--neutral-600: #52525b;
--neutral-700: #3f3f46;
--neutral-800: #27272a;
--neutral-900: #18181b;

/* Utility Colors */
--success: #10b981;        /* Green 500 */
--error: #ef4444;          /* Red 500 */
--warning: #f59e0b;        /* Amber 500 */
--info: #3b82f6;           /* Blue 500 */
```

#### Additional Color Requirements

For the advanced restaurant visualization features, we'll extend the palette with:

- **Data Visualization Colors**: A specialized palette for charts, graphs, and maps
- **Geographic Visualization**: An extended color range for heatmaps and location density displays

### Typography

```css
/* Base Typography */
--font-sans: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', SFMono-Regular, ui-monospace, Menlo, Consolas, monospace;

/* Android-specific font fallbacks */
--android-font-sans: 'Inter', Roboto, 'Noto Sans', 'Droid Sans', sans-serif;
```

#### Type Scale

| Element              | Size (rem) | Weight | Line Height |
|----------------------|------------|--------|-------------|
| Main Heading (h1)    | 1.875      | 800    | 1.2         |
| Section Heading (h2) | 1.25       | 700    | 1.3         |
| Subsection Head (h3) | 1.125      | 600    | 1.4         |
| Body Text            | 0.875      | 400    | 1.5         |
| Small Text           | 0.75       | 400    | 1.5         |

### Spacing System

Maintain the same spacing system as Concierge Collector, using Tailwind's default spacing scale.

### Shadow System

```css
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
--shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04);
--shadow-md: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.03);
--shadow-lg: 0 20px 25px -5px rgba(0, 0, 0, 0.08), 0 10px 10px -5px rgba(0, 0, 0, 0.03);
```

### Border Radius

```css
--radius-sm: 0.25rem;
--radius: 0.5rem;
--radius-md: 0.75rem;
--radius-lg: 1rem;
--radius-full: 9999px;
```

### Transitions

```css
--transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-smooth: 300ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-bounce: 500ms cubic-bezier(0.34, 1.56, 0.64, 1);
```

## Layout Architecture

### Main UI Structure

The Restaurant Editor will feature a more advanced layout than Concierge Collector to accommodate its enhanced functionality:

1. **Top Navigation Bar**
   - Application logo and title
   - Global search
   - User profile/settings
   - Dark/light mode toggle
   - Help/support access

2. **Sidebar Navigation (New Feature)**
   - Restaurant list
   - Concept management
   - Media library
   - Search & filters
   - Visualization & analytics
   - Import/export functions

3. **Main Content Area**
   - Contextual to current view (list, detail, edit, visualizations)
   - Supports tabs for multi-document interface
   - Responsive to different screen sizes

4. **Information Panel**
   - Context-sensitive details
   - Can be collapsed/expanded
   - Shows additional metadata for selected items

### Responsive Behavior

- **Desktop** (1024px+): Full featured with multi-pane interface
- **Tablet** (768px - 1023px): Collapsible sidebar, optimized workspace
- **Mobile** (below 768px): 
  - Stack panels vertically
  - Hide sidebar with hamburger menu access
  - Simplified view focused on core tasks

## Component Specifications

### Core Components

#### 1. Restaurant Card

A standardized presentational component that displays:

```html
<div class="restaurant-card bg-white p-4 rounded-lg shadow hover:shadow-md transition-all">
    <h3 class="text-lg font-bold mb-2">[Restaurant Name]</h3>
    <p class="text-sm text-gray-500 mb-2">Added: [Date]</p>
    
    <!-- Description (limited to 15 words) -->
    <p class="text-sm mb-3 italic text-gray-600">"[Description]"</p>
    
    <!-- Concepts as tags, grouped by category -->
    <div class="mt-4">
        <div class="mb-2">
            <!-- Concept tags similar to Concierge Collector -->
            <span class="concept-tag cuisine">Italian</span>
        </div>
    </div>
    
    <!-- Actions -->
    <button class="view-details w-full">
        View Details
    </button>
</div>
```

#### 2. Concept Tags

Maintain the same gradient-based styling from Concierge Collector:

```css
.concept-tag {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.25;
  color: white;
  border-radius: var(--radius-full);
  margin: 0.125rem;
  box-shadow: var(--shadow-sm);
}

.concept-tag.cuisine { 
  background: linear-gradient(135deg, #f87171, #ef4444); 
}
/* Additional category styles as in Concierge Collector */
```

#### 3. Buttons

Follow the existing button hierarchy:

```html
<!-- Primary Action -->
<button class="bg-blue-500 text-white px-4 py-2 rounded flex items-center">
    <span class="material-icons mr-1">check</span>
    Primary Action
</button>

<!-- Secondary Action -->
<button class="bg-gray-500 text-white px-4 py-2 rounded flex items-center">
    <span class="material-icons mr-1">close</span>
    Secondary Action
</button>

<!-- Delete/Destructive Action -->
<button class="bg-red-500 text-white px-4 py-2 rounded flex items-center">
    <span class="material-icons mr-1">delete</span>
    Delete
</button>
```

#### 4. Form Elements

Match input styling from Concierge Collector:

```css
input[type="text"],
input[type="password"],
textarea,
select {
  width: 100%;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  line-height: 1.5;
  border: 1px solid var(--neutral-300);
  border-radius: var(--radius);
  background-color: white;
}

input[type="text"]:focus,
input[type="password"]:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: var(--primary-light);
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.2);
}
```

### New Components for Restaurant Editor

#### 1. Data Grid for Restaurant Lists

```html
<div class="overflow-x-auto">
  <table class="min-w-full bg-white">
    <thead>
      <tr class="bg-gray-100 border-b">
        <th class="py-3 px-4 text-left font-medium text-gray-700 sort-header">
          <div class="flex items-center">
            Name
            <span class="material-icons ml-1 text-gray-400 text-sm">unfold_more</span>
          </div>
        </th>
        <!-- Additional headers -->
      </tr>
    </thead>
    <tbody>
      <!-- Restaurant rows -->
    </tbody>
  </table>
</div>
```

#### 2. Filter and Search Panel

```html
<div class="bg-white p-4 rounded-lg shadow">
  <h3 class="text-lg font-semibold mb-4 flex items-center">
    <span class="material-icons mr-2 text-purple-500">filter_list</span>
    Filters
  </h3>
  
  <div class="space-y-4">
    <!-- Filter groups -->
    <div>
      <h4 class="font-medium mb-2">Cuisine</h4>
      <div class="flex flex-wrap gap-2">
        <label class="inline-flex items-center px-3 py-1 bg-purple-50 hover:bg-purple-100 rounded-full cursor-pointer">
          <input type="checkbox" class="mr-2 accent-purple-500">
          Italian
        </label>
        <!-- More filter options -->
      </div>
    </div>
  </div>
  
  <div class="mt-4 pt-4 border-t flex justify-between">
    <button class="text-gray-500">Clear all</button>
    <button class="bg-purple-500 text-white px-4 py-2 rounded">Apply</button>
  </div>
</div>
```

#### 3. Map Visualization Component

```html
<div class="bg-white p-4 rounded-lg shadow">
  <h3 class="text-lg font-semibold mb-4 flex items-center">
    <span class="material-icons mr-2 text-blue-500">map</span>
    Restaurant Locations
  </h3>
  
  <div class="h-96 rounded-lg border overflow-hidden bg-gray-50" id="map-container">
    <!-- Map will be rendered here -->
  </div>
  
  <div class="mt-4 flex justify-between">
    <div class="text-sm text-gray-500">
      <span class="font-medium">42</span> restaurants displayed
    </div>
    <div class="space-x-2">
      <button class="bg-white border border-gray-300 px-3 py-1 rounded text-sm flex items-center">
        <span class="material-icons text-sm mr-1">layers</span>
        Layers
      </button>
      <button class="bg-white border border-gray-300 px-3 py-1 rounded text-sm flex items-center">
        <span class="material-icons text-sm mr-1">fullscreen</span>
        Expand
      </button>
    </div>
  </div>
</div>
```

#### 4. Data Visualization Components

```html
<div class="bg-white p-4 rounded-lg shadow">
  <h3 class="text-lg font-semibold mb-4 flex items-center">
    <span class="material-icons mr-2 text-green-500">pie_chart</span>
    Concept Distribution
  </h3>
  
  <div class="h-80 rounded-lg" id="chart-container">
    <!-- Chart will be rendered here -->
  </div>
  
  <div class="mt-4 grid grid-cols-2 gap-2 text-sm">
    <div class="bg-gray-50 p-2 rounded flex justify-between">
      <span>Italian</span>
      <span class="font-medium">42</span>
    </div>
    <!-- More stats -->
  </div>
</div>
```

#### 5. Side Panel Component

```html
<div class="w-80 bg-white border-l border-gray-200 h-full flex flex-col">
  <div class="p-4 border-b flex justify-between items-center">
    <h3 class="font-semibold">Details</h3>
    <button class="text-gray-500">
      <span class="material-icons">close</span>
    </button>
  </div>
  
  <div class="overflow-y-auto flex-grow p-4">
    <!-- Panel content -->
  </div>
</div>
```

## Component States

### Interactive Elements

1. **Default**: Normal state
2. **Hover**: Subtle highlight or transform
3. **Active/Pressed**: Slightly depressed appearance
4. **Focus**: Visible focus ring (accessibility)
5. **Disabled**: Muted appearance with reduced opacity
6. **Loading**: Animated indicator for async operations
7. **Error**: Visual indication of validation or process errors

### Animation Guidelines

- Use subtle transitions for state changes (match Concierge Collector's durations)
- Utilize animation sparingly to avoid distractions
- Ensure animations respect user preferences (reduced motion)

## Navigation Patterns

### Main Navigation

- Sidebar-based primary navigation (a departure from Concierge Collector's tab-based approach)
- Expandable/collapsible sections for related features
- Visual indicators for current location
- Breadcrumbs for complex nested structures

### Global Actions

- Consistent placement in the header area
- Important actions (import/export) elevated for visibility
- Quick action button (FAB) for contextual operations

## Responsive Breakpoints

Maintain the same breakpoints as Concierge Collector:

```css
/* Small (mobile) */
@media (max-width: 640px) {
  /* Mobile-specific styles */
}

/* Medium (tablet) */
@media (min-width: 641px) and (max-width: 1024px) {
  /* Tablet-specific styles */
}

/* Large (desktop) */
@media (min-width: 1025px) {
  /* Desktop-specific styles */
}
```

## Dark Mode Implementation

The dark mode implementation follows Concierge Collector's approach:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --neutral-50: #27272a;
    --neutral-100: #18181b;
    --neutral-200: #3f3f46;
    --neutral-300: #52525b;
    --neutral-400: #71717a;
    --neutral-600: #d4d4d8;
    --neutral-700: #e4e4e7;
    --neutral-800: #f4f4f5;
    --neutral-900: #fafafa;
  }
  
  /* Component-specific dark mode adjustments */
}
```

## Accessibility Guidelines

- Maintain WCAG 2.1 AA compliance for all components
- Proper contrast ratios for text and interactive elements
- Keyboard navigation for all interactive elements
- Screen reader friendly markup with appropriate ARIA attributes
- Support for text scaling and zooming
- Respect user preferences for reduced motion
- Consistent focus indicators

## Interaction Patterns

### Data Entry

- Real-time validation where appropriate
- Clear error messaging
- Autosave for form data when possible
- Context-preserving navigation

### Bulk Operations

- Checkbox selection in list views
- Batch actions in toolbar
- Progress indicators for operations on multiple items
- Cancelable operations when possible

### Drag and Drop

- Used for concept management
- Visual indicators for draggable items
- Clear drop targets with visual feedback
- Keyboard alternatives for all drag operations

## Keyboard Shortcuts

- Standard shortcuts for common operations (Ctrl+S for save, etc.)
- Custom shortcuts for application-specific functions
- Visible shortcut hints in tooltips
- Keyboard shortcut reference screen

## Loading States and Transitions

- Consistent loading indicators
- Skeleton screens for content loading
- Transition animations between major views
- Progress indicators for long-running operations

## Mobile-Specific Considerations

- Touch-friendly target sizes (minimum 44×44 CSS pixels)
- Simplified views for smaller screens
- Bottom navigation pattern for primary actions
- Pull-to-refresh for list updates
- Swipe gestures where appropriate

## Error Handling UX

- Clear error messages
- Contextual help for resolving issues
- Non-blocking notifications for non-critical errors
- Graceful degradation for network issues

## Implementation Notes

1. The UI components should be developed as a reusable library
2. Match Concierge Collector's CSS variable naming for seamless transition
3. Prioritize performance and responsiveness
4. Implement proper view transitions for a fluid user experience
5. Consider code sharing between applications where possible

## Prototype and Testing Guidelines

1. Create interactive prototypes for complex workflows
2. Test with real data from Concierge Collector exports
3. Include usability testing with actual users of Concierge Collector
4. Performance test with large datasets to ensure responsiveness
5. Test across different devices and screen sizes
