# Design System Documentation: Tactical Precision & Editorial Depth

## 1. Overview & Creative North Star: "The Sentinel Path"
The North Star for this design system is **The Sentinel Path**. In the high-stakes environment of travel and navigation, design must transcend mere utility to become a reliable co-pilot. We move away from the "standard app" aesthetic by adopting a **High-Contrast Editorial** approach. 

This system rejects the cluttered, line-heavy interfaces of traditional GPS apps. Instead, it utilizes **intentional asymmetry, massive typographic scales, and tonal layering** to create an interface that feels like a premium, heads-up display. We prioritize rapid cognition through "glanceable" layouts—where the most critical information is physically layered "closer" to the user using depth and glassmorphism, ensuring safety and professional reliability.

---

## 2. Colors & Surface Architecture

### The Palette
The color strategy is rooted in high-contrast functionality. We use **Navigation Blue (#003f87)** for authority and **Safety Amber (#904d00)** for critical alerts.

*   **Primary (Navigation Blue):** `#003f87` (On-Primary: `#ffffff`)
*   **Secondary (Safety Amber):** `#904d00` (On-Secondary: `#ffffff`)
*   **Surface Hierarchy:**
    *   `surface_container_lowest`: `#ffffff` (Pure white for highest-priority floating cards)
    *   `surface`: `#f9f9f9` (The primary off-white background)
    *   `surface_dim`: `#dadada` (For inactive or "Deep Slate" adjacent states)
    *   `inverse_surface`: `#2f3131` (The "Deep Slate" night-mode / high-contrast base)

### The "No-Line" Rule
**Borders are prohibited for sectioning.** To define boundaries, you must use background shifts. For example, a `surface_container_low` card sits on a `surface` background. The transition of tone is the divider. This creates a sophisticated, "app-as-an-object" feel rather than a grid of boxes.

### The "Glass & Gradient" Rule
To elevate the "Professional" theme, utilize **Glassmorphism** for floating navigation elements (Instruction cards, ETA bubbles). 
*   **Style:** `surface_container_lowest` at 80% opacity with a `24px` backdrop-blur.
*   **Signature Textures:** Apply a subtle linear gradient from `primary` (#003f87) to `primary_container` (#0056b3) on main CTAs to give them a "machined" look that feels more premium than flat fills.

---

## 3. Typography: The Glanceable Hierarchy
We utilize **Inter** for its exceptional x-height and legibility under motion. The scale is exaggerated to ensure readability at arm's length in a vibrating vehicle.

*   **Display (L/M/S):** Used for primary navigation metrics (Distance remaining, Speed). `3.5rem` to `2.25rem`. Bold weight.
*   **Headline (L/M/S):** For destination names and street turn-by-turn instructions. `2rem` to `1.5rem`.
*   **Title (L/M/S):** For secondary info like "ETA" or "Alternative Routes."
*   **Body (L/M/S):** For community reports and descriptions. Never go below `0.875rem` (`body-md`) for driver-facing content.
*   **Labels:** Reserved for metadata. Use `label-md` (`0.75rem`) with 5% letter spacing for a professional, "instrument panel" look.

---

## 4. Elevation & Depth: Tonal Layering

### The Layering Principle
Depth is achieved by stacking the `surface-container` tiers. 
1.  **Base Layer:** `surface` (#f9f9f9).
2.  **Section Layer:** `surface_container_low` (#f3f3f3).
3.  **Action Layer:** `surface_container_lowest` (#ffffff).
This stacking creates a natural "lift" that guides the eye toward actionable items without the visual noise of shadows.

### Ambient Shadows & "Ghost Borders"
When a component must "float" (e.g., a floating action button or a reroute prompt):
*   **Shadow:** Use a color-matched shadow: 8% opacity of `on_surface` (#1a1c1c), Blur: 32px, Y-Offset: 8px.
*   **Ghost Border:** If a container sits on a background of the same color, use a `1px` border of `outline_variant` (#c2c6d4) at **15% opacity**. Never use a 100% opaque border.

---

## 5. Components

### Navigation Buttons
*   **Primary:** Gradient-filled (`primary` to `primary_container`) with `xl` (0.75rem) rounded corners. Padding: `24px 32px`.
*   **Secondary:** Ghost style using `outline` token at low opacity with `on_surface` text.
*   **Tertiary:** Text-only, bold `label-md`, used for "Dismiss" or "Cancel."

### Safety Chips
*   Used for road hazards. Background: `secondary_container` (#fd8b00). Text: `on_secondary_container`. 
*   **Style:** `full` (pill) roundedness. These should pop against the blue navigation UI.

### Driving Cards & Lists
*   **Strict Rule:** No horizontal dividers.
*   **Separation:** Use `16px` or `24px` of vertical white space from the Spacing Scale. 
*   **Content:** Text within cards should be asymmetrical—primary info (Turn direction) left-aligned, secondary info (Distance) right-aligned and ghosted using `on_surface_variant`.

### Context-Specific: The "Horizon Indicator"
A custom component for this app: A slim, full-width gradient bar at the top of the map view using `tertiary` (#722b00) to signify upcoming heavy traffic or safety alerts, acting as a peripheral warning system.

---

## 6. Do’s and Don’ts

### Do:
*   **DO** use `surface_container_highest` for "active" states in a list.
*   **DO** prioritize the "Safety Amber" for anything requiring driver attention within 3 seconds.
*   **DO** use "Large Touch Targets"—all interactive elements must have a minimum hit area of `48x48dp`.

### Don't:
*   **DON'T** use 1px solid borders to separate list items. Use whitespace.
*   **DON'T** use pure black (#000000). Use `on_background` (#1a1c1c) for text to maintain professional tonal depth.
*   **DON'T** use "Standard" drop shadows. Stick to ambient, diffused tonal lifts or glassmorphism.
*   **DON'T** crowd the display. If a piece of information isn't vital for the next 5 miles, hide it in a sub-menu.