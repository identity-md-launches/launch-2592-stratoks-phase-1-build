# Stratoks design system

## Overview

Stratoks is a full-viewport observer for a small autonomous settlement. The visual idea is a quiet isometric clearing under compact, cream-colored observation tools. Yellow creatures, timber shelters, restrained foliage and a visible lake make the simulation legible. The interface uses plain language, progressive disclosure and explicit connection/demo labels. It is a prototype world, not a marketing landing page or ownership game.

Source of truth: `web/src/styles.css`; product composition in `App.tsx`; native controls and inspection patterns in `Panels.tsx`; canvas artwork in `renderer.ts` and `icons.tsx`.

## Colors

The final CSS uses these semantic tokens:

| Token | Value | Role |
|---|---|---|
| `--paper` | `#fafaf1` | Opaque readable panels, toolbar, labels and modal surfaces |
| `--surface` | `#f3f4e8` | Form fields |
| `--soft` | `#e9eddf` | Secondary controls, notice and segment backgrounds |
| `--ink` | `#263f31` | Primary text |
| `--muted` | `#5c6c58` | Supporting text and labels |
| `--line` | `#d9dece` | Structural separators |
| `--accent` | `#315d40` | Primary action and selected dock control |
| `--accent-hover` | `#244b32` | Primary hover |
| `--danger` | `#98462e` | Destructive controls and errors |
| `--danger-bg` | `#f4e5da` | Destructive confirmation notice |
| `--focus` | `#29592e` | 3px visible keyboard outline |

The original canvas palette is deliberately separate from UI semantics: grass around `#a4bc82`, water around `#87b8b1`, foliage `#3b754c`–`#94bf7f`, straw/timber roofs and yellow `#eac451` / `#f8dc76` bodies. It is artwork, not a second UI theme. Status always has text as well as color. There is no dark mode.

Readable world headings/statuses have opaque paper backgrounds so moving foliage cannot lower text contrast. Actual measured pairs and the limitations of canvas contrast automation are in `docs/VALIDATION.md` and `docs/results/interface-checks.json`.

## Typography

One locally bundled family: **Manrope Variable**, with Manrope/Arial/sans-serif fallback. The Latin WOFF2 comes from the locked Fontsource dependency and supports weights 200–800. The interface requests only **400, 600 and 800**. `font-display: swap`; no remote font request. Native inputs use 16px to avoid iOS input zoom.

Exactly six size tokens: 12px (`--text-xs`, captions/data), 14px (`--text-sm`, controls/supporting prose), 16px (`--text-md`, fields/small headings), 20px (`--text-lg`, panel headings), 24px (`--text-xl`, identity/metrics/mobile introduction), 32px (`--text-display`, desktop introduction). Headings use approximately 1.25 line height, body copy 1.5–1.6. The introduction uses 1.15 and slight negative tracking; ordinary text has natural tracking and casing. Changing metrics use tabular numerals. Long addresses and request IDs wrap rather than truncate; only the header’s intentionally shortened wallet identifier abbreviates an address, with the full address in its account dialog.

## Layout

A fullscreen canvas sits under HTML controls. The app uses `height: 100dvh` with a `100vh` fallback and no fixed minimum height. Desktop header utilities stay at the upper right and the unboxed brand at the upper left. The world label/compact metric strip sit near the upper left; the tool dock sits at the lower center. Content grouping uses roughly 4, 8, 12, 16, 20, 24 and 32px increments. Sidebar width is 340px; modals normally 420px, at most viewport minus 32px.

Implemented breakpoints are 1150, 800, 600 and 360px, plus short-height adaptations. At 1150, secondary chrome simplifies. At 800, connection labeling moves into the world heading and footer status moves above the dock. At **600 and below**, the dock fills the available width, the sidebar becomes an inset sheet between base top 244px and bottom 96px, and its body scrolls under a stable heading. Footer status and camera controls hide while that sheet is open so they cannot cover its content. Focusing a form does not resize the sheet. The help icon moves into Settings on small screens. Below 360, spacing tightens and secondary geometry text hides.

Connection failures reserve space below the header. `App.tsx` measures the notice with `ResizeObserver` and supplies `--connection-space` (notice height plus 12px). The heading, metrics, welcome, panel and extinction banner use this as a block-start margin. Wrapping notices therefore move content down and reduce the panel's available height; clearing the error removes that space. The canvas and bottom toolbar stay in place.

At **560px height and below**, the header is 56px and the footer is 80px plus the bottom safe area. Decorative welcome art, heading and prose hide, leaving the demo and server controls visible. During a connection error, the notice's Settings control replaces the repeated server link/status in the compact welcome. Scene labels and metrics hide while a short-height panel is open; the panel spans base top 64px to bottom 88px plus the safe area. Its body has `min-height: 0` and scrolls internally. The dock remains reachable. Camera controls form a row above 600px width and retain their narrow column below it.

Phone modals align above the bottom safe area, use 20px inner padding and scroll within the viewport. Wallet rows are at least 52px tall. Many compact controls are 34–44px; the probe verifies at least 24px or sufficient spacing, not that every control reaches the 44px comfort target. Revision browser evidence covers 320×700, 360×540, 390×844, 568×320, 667×375, 844×390, 768×1024 and 1440×1000. Native browser zoom, RTL and localization were not tested; English is the implemented locale.

## Elevation & Depth

Floating surfaces use `--shadow: 0 8px 32px #243e3020`; the introductory panel and modal have stronger shadows. Fields/separators use borders. A single surface does not combine border and shadow. The canvas paints projected ground shadows under original sprites. Modal backdrops dim and blur the world; native `showModal()` makes the background inert. Header/footer overlays have independent stacking layers and do not stop the simulation.

## Shapes

`--radius: 16px` is the main panel radius. Controls use 8–10px, dock 14–16px, large introduction/modal 16–20px, portraits a circle. Canvas shapes are small rounded bodies, layered foliage and faceted roofs. Do not replace creatures with status dots: bodies, faces, arms/legs and event-specific animation are part of the product.

## Components

- **`Icon` / `Mascot` (`icons.tsx`):** original SVG icons with a consistent 1.7px stroke, `currentColor`, and decorative `aria-hidden`. The mascot has normal/rest variants. Names belong on their containing buttons.
- **Buttons (`styles.css`):** `.primary` for the leading action, `.secondary` for support, `.danger-button` for destructive actions, `.icon-button` for compact utilities, `.text-button` for underlined contextual actions. Hover is pointer-gated; keyboard focus uses a 3px outline; disabled state is explicit; no `transition: all`.
- **`Modal` (`Modal.tsx`):** native dialog, accessible title, Close and Escape, outside-click dismissal, background inertness and trigger focus restoration. Used by settings/help/wallet flows. Explicit Tab/Shift+Tab wrapping supplements native inertness, including when focus was cleared by an external tool.
- **`SidePanel` (`Panels.tsx`):** stable header and independently scrolling content. Opening moves focus to its heading; Escape and Close return to the dock. It is a nonmodal inspector so the dock remains usable.
- **Residents and inspector:** search/filter native buttons, needs as native `meter` elements, relationships as navigable controls, bounded memory/decision lists, honest loading/error/death states and retry. The world snapshot supplies learning status while individual statistics and visitor memories load. Canvas selection has an equivalent Residents-list path.
- **History:** textual metrics, labeled SVG charts, life/settlement event filters, and CSV download. Event sequence IDs are stable; received events are deduplicated.
- **Tools/visit forms:** visible labels, 16px inputs, bounded ranges, explicit destructive confirmation, pending/error/success text. Visitor placement and timed refresh require an affirmative service presence response; capacity rejection clears success, disables visitor actions and offers an explicit later retry. Uncertain intervention requests show the exact persistent ID/body and a same-ID retry.
- **Wallet sheet (`wallet.tsx`):** named EIP-6963 wallets, generic “Browser wallet” only if needed, Coinbase row, and four mobile app links with real marks. Connected wallet and authenticated session are separate states. Smart-account sign-in limitations are shown before signing.
- **`WorldCanvas` / `WorldRenderer`:** native pointer capture, two-pointer pinch, pan/zoom/center controls and keyboard alternatives. Rendering interpolates supplied positions and displays actual stage/carry/need state. Reduced motion and the preference switch remove cosmetic motion; the private demo additionally has a simulation pause.

## Do’s and Don’ts

- Reuse `SidePanel`, `Modal`, existing button variants and semantic tokens for a new observation tool. Add its dock/panel state in `App.tsx`; keep data work in the connection/store layer.
- Put text on an opaque reading surface over the world. Preserve visible status, last update and demo labels.
- Keep one primary action within a task. Use a destructive style plus consequence text for fire, storms and startle.
- Keep the simulation separate from rendering. Never fabricate “live” counts, hide extinction by reseeding, or turn a local demo into a claim about the shared service.
- Preserve wallet branding only for connector choices, and keep connection distinct from authenticated capability.
- Use no auto-playing decorative CSS animation. Actual simulation state can update under reduced motion; cosmetic walk/bob interpolation must not.
