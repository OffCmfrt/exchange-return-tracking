# Black Screen Issue - FIXED

## Problem
When clicking the "Leaderboard" link in the sidebar, the page showed a black/empty screen instead of the leaderboard content.

## Root Cause
The leaderboard page div (`#page-leaderboard`) was incorrectly placed **AFTER** the closing `</main>` tag, causing it to render outside the main content area.

## Solution
Moved the leaderboard page div to be **INSIDE** the `<main class="ia-main">` tag, making it a sibling to the ambassadors page div.

### Before (INCORRECT):
```html
<main class="ia-main">
  <div class="ia-content" id="page-ambassadors">
    ... ambassadors content ...
  </div>
</main>  <!-- ❌ Leaderboard was AFTER this closing tag -->

<div class="ia-content" id="page-leaderboard" style="display: none;">
  ... leaderboard content ...
</div>
```

### After (CORRECT):
```html
<main class="ia-main">
  <div class="ia-content" id="page-ambassadors">
    ... ambassadors content ...
  </div>

  <div class="ia-content" id="page-leaderboard" style="display: none;">
    ... leaderboard content ...
  </div>  <!-- ✅ Now INSIDE the main tag -->
</main>
```

## File Modified
- `public/page.influencer-admin.liquid`

## What Changed
1. Removed the duplicate leaderboard page div that was outside the main tag
2. Added the leaderboard page div inside the main tag, right after the ambassadors page div
3. Both pages are now siblings within the main content area

## How Page Navigation Works
1. User clicks "Leaderboard" in sidebar
2. `showPage('leaderboard', this)` function is called
3. Function hides all pages (`display: none`)
4. Function shows leaderboard page (`display: block`)
5. Function calls `loadFullLeaderboard('30d')` to fetch and display data

## Testing
After this fix:
1. Click "Ambassadors" → Shows ambassador management page ✅
2. Click "Leaderboard" → Shows premium leaderboard page ✅
3. Both pages now load correctly with all content visible ✅

## Lesson Learned
**CRITICAL**: When adding new full-page sections to the admin dashboard, ALWAYS place the page div INSIDE the `<main>` tag as a sibling to existing page divs, never after the closing `</main>` tag.
