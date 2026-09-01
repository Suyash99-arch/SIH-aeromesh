# CSS Color Audit Report - Dark Theme Migration

## CRITICAL FINDINGS

Based on comprehensive grep search across all CSS files, the following issues have been identified:

### 1. **BUTTON PRIMARY TEXT - Dark text on gradient button**

- **File**: `frontend/src/styles/app.css` line 11
- **Current Rule**: `.button.primary{color:#061017;...}`
- **Issue**: Sets button text to dark (#061017) on light gradient button
- **Fix**: Change to `color: var(--text-primary)` (#e5f3f7)
- **Severity**: HIGH - affects all primary action buttons

### 2. **TOAST NOTIFICATION ICON - Dark text on colored background**

- **File**: `frontend/src/styles/pages.css` line 707
- **Current Rule**: `.toast > span { ... color: #061017; ... }`
- **Issue**: Sets toast notification icon text to dark (#061017)
- **Fix**: Change to `color: var(--text-on-accent)` or `var(--bg-page)`
- **Severity**: MEDIUM - affects success/info toast notifications

### 3. **HUD DISPLAY - Hardcoded cyan text (acceptable but should use tokens)**

- **File**: `frontend/src/styles/app.css` line 52-53
- **Current Rule**: `.hud { color: #42d7ff; background: rgba(6, 16, 23, 0.7); }`
- **Issue**: Hardcoded light cyan - should use CSS variable
- **Fix**: Change to `color: var(--accent-primary)` (#00d9ff)
- **Severity**: LOW - works but inconsistent with token system

### 4. **VIDEO FALLBACK TEXT - Hardcoded light cyan (acceptable)**

- **File**: `frontend/src/styles/app.css` line 37
- **Current Rule**: `.video-fallback span { ... color: #d8f9fc; ... }`
- **Issue**: Hardcoded light cyan - should use CSS variable
- **Fix**: Change to `color: var(--text-light)` or `var(--accent-primary)`
- **Severity**: LOW - works but inconsistent

### 5. **HOMEPAGE BADGE COLORS - Hardcoded status colors**

- **File**: `frontend/src/styles/homepage.css` lines 673, 678
- **Current**: `color: #fbbf24` (line 673), `color: #818cf8` (line 1649)
- **Issue**: Hardcoded colors instead of using tokens
- **Fix**: Replace with appropriate token variables
- **Severity**: LOW - accent colors, might be intentional

### 6. **RGB COLOR REFERENCES**

Multiple instances of hardcoded rgba() background overlays that might be using old color values:

- app.css line 5: `rgba(124,58,237,.18)` - violet overlay (might be stale)
- app.css line 37: `rgba(3,13,17,.72)` - video fallback dark overlay (OK)

---

## VERIFICATION

### Text Hierarchy in Dark Theme (Should be):

- **Headings/Primary Text**: `var(--text-primary)` = #e5f3f7 (bright cyan-tinted white)
- **Body/Secondary Text**: `var(--text-secondary)` = #a8c5d1 (lighter blue)
- **Labels/Muted Text**: `var(--text-muted)` = #6b8895 (darker blue-gray)

### Accent Colors (Should be cyan-based):

- **Primary Accent**: `var(--accent-primary)` = #00d9ff (cyan)
- **Secondary Accent**: `var(--accent-secondary)` = #0ea5e9 (blue)

### Status Colors:

- **Success**: `var(--success)` = #10b981 (green)
- **Warning**: `var(--warning)` = #f59e0b (amber)
- **Danger**: `var(--danger)` = #ef4444 (red)

---

## FILES WITH VIOLATIONS FOUND

1. **app.css** - 3 violations (button text, HUD color hardcoding, old violet references)
2. **pages.css** - 1 violation (toast icon text)
3. **homepage.css** - 2 violations (badge colors)
4. **sih.css** - Appears OK, uses token variables
5. **theme.css** - OK, defines tokens correctly
6. **video-player.css** - Appears OK, uses token variables

---

## ACTION ITEMS

- [x] Identify all hardcoded colors
- [ ] Replace `.button.primary color:#061017` with `var(--text-primary)`
- [ ] Replace `.toast > span color:#061017` with `var(--text-on-accent)`
- [ ] Replace `.hud color:#42d7ff` with `var(--accent-primary)`
- [ ] Replace `.video-fallback span color:#d8f9fc` with `var(--text-light)`
- [ ] Audit homepage.css badge colors
- [ ] Run comprehensive contrast checker
- [ ] Verify no dark-on-dark or unreadable text combinations remain
