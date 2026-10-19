# Glucose Guardian — website (story version)

This is the full, working "Care, shared." story website for Glucose Guardian, exported from the Claude design board on October 19, 2026.

## Open it

1. Unzip the folder and keep everything together.
2. Double-click **index.html**. It opens in any browser and works offline.
3. To try it on a phone, put the folder online (GitHub Pages, Vercel or Netlify all work by uploading the folder as-is), or run a quick local server from inside the folder: `npx serve` or `python3 -m http.server`.

## What's in the folder

| File | What it is |
|---|---|
| `index.html` | The main page: the scroll story, the care circle, founders, Join the beta, and the "Try the app yourself" demo |
| `main.html` | The older family page plus the Schools and Doctors pages (linked from the bottom of the story) |
| `support.js` | The small engine both pages run on. Keep it next to the HTML files |
| `images/` | Meal photos, the robot mascot (waving + head), and `portal/` doctor-portal screenshots |
| `source/` | The exact original files from the Claude design board (`Cinematic.dc.html` = story, `Main.dc.html` = family/Schools/Doctors), before image paths were changed for this export |

## How the pages are built

Each page is a single HTML file in Claude Design's format:

- Everything between `<x-dc>` and `</x-dc>` is the page template. `{{name}}` placeholders and `onClick="{{handler}}"` are filled in by `support.js` (it bundles React).
- All CSS is in one `<style>` block at the top.
- The `<script>` at the bottom holds `class Component extends DCLogic`:
  - `state` holds the **view** (Caring for someone / My own diabetes) and **theme** (Light / Dark). Both are remembered in `localStorage` (`gg_site_view`, `gg_site_theme`).
  - `componentDidMount()` sets up the scroll story, the live glucose line, the tap labels and the demo.

You can edit the HTML, CSS and text directly in `index.html`. If you'd rather move it into a normal framework (Next.js, Astro, etc.), the markup and CSS port over as-is; the scroll and demo logic is plain JavaScript inside `componentDidMount()`.

## Finding things in index.html

Search for these comments or names:

- **Story steps:** `class="step step-0` through `step-11` hold the text for the 12 steps. The phone screens they drive are the `class="sv sv-…"` blocks (`sv-glucose`, `sv-readings`, `sv-pred`, `sv-log`, `sv-food`, `sv-calc`, `sv-dose`, `sv-chat`, `sv-dash`, `sv-ins`, `sv-care`, `sv-alerts`). Inside a screen, `class="win"`, `class="after"` and `class="tw"` with `--a` / `--b` make parts appear at a point in the step's scroll progress (`--t`, from 0 to 1).
- **Phone layout on mobile:** `/* ── mobile v5` (one column: phone pinned at top, text scrolling underneath). Desktop poses are per step, under `@media (min-width:901px)`.
- **Tap labels under the phone:** `var HINTS = [`.
- **Try-it demo:** `/* ── Try-it demo` in the script.
  - The guided tour is the `T` array: each step lists the screen, its progress point, the tap area, and the robot's words.
  - "Explore on my own" is the `free` function: what every button does.
  - Styles: `/* ── Demo overlay` and `/* ── demo: 3D phone`.
- **Brand:** the logo is drawn inline (`gn-lg`), colors are blue `#1d8cff`, cyan `#22d3ee`, teal `#2ef2c6`. App screens inside the phone stay purple on purpose, to match the real app.
- **Disclaimers:** search `estimates only` (top of page, Insulin page, bottom, demo finish screen).

## Rules we've kept to

- Dexcom only.
- Show only real app features. Screens or buttons we don't have real screenshots for get a short explanation from the robot instead of made-up screens.
- Glucose Guardian is an assistant, not a replacement for care: "provides estimates only and does not replace medical advice. Always follow your doctor's instructions."
- All numbers and names (Mia, Joe, readings, A1C 6.9%) are sample data.
- iPhone beta: https://testflight.apple.com/join/jnr9HbAa. Android is coming soon.

## Open items

- Founders section: real photos and short stories for Brian Bethea and Brett Hoffman (placeholders now).
- `main.html` (family, Schools, Doctors) still uses the older purple style and drop logo; it needs the new blue/teal brand.
- Robot mascot: currently on the mobile layout only. Cleaner transparent versions and more poses (pointing, thinking, cheering) would help, and it still needs adding to desktop.
- Demo: real screenshots of Notifications, Alert Thresholds, Emergency Contacts, Doctor Office, Doctor Code and Help, so those buttons can open real screens.
- Going live: point glucoseguardian.io (GoDaddy) at wherever the site is hosted.
