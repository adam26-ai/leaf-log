# Leaf Log — Design Language

**Principle:** *Same DNA as [leafvario.com](https://leafvario.com/), warmer room.* Leaf Log
is the official companion to the Leaf vario, so it must read as unmistakably part of the
family — but it is a **social logbook for beginner/intermediate pilots**, so it softens the
hardware site's austerity into something warm, welcoming, and human. Keep the anchors;
relax the coldness.

> Extracted from leafvario.com (Astro site) — these are the real tokens the hardware brand
> uses, not approximations.

## What we inherit from leafvario.com (the anchors — keep these)

- **Typography:** **Roboto** (body) + **Roboto Condensed** (headings — compact, signage-like).
- **Base palette:** black / near-black / white monochrome foundation.
- **Signature accent:** Leaf blue **`#0099ff`**, used for primary actions, links, focus
  rings, selected controls, and section-heading bars.
- **Leaf wordmark:** the custom `leaf` display font (`font.ttf`) — used for the logo lockup
  only.

## What we warm up (the "warmer room")

- **Corners:** soften from the site's `border-radius: 0` to a **small radius (~4–6px)** on
  cards, buttons, and inputs. Keep the blue accent bar sharp.
- **Elevation:** allow **subtle, soft shadows** on cards (feed, flight tiles) where the
  hardware site is strictly flat — gives the social UI a friendlier, tactile depth.
- **State colors:** use Leaf lime on charcoal for completed and success marks, emergency
  orange for warnings, and red for errors and destructive actions. Keep status copy neutral
  so the icon carries the state without reducing readability.
- **Imagery:** real **flight photography** — golden-hour, human, joyful — not spec diagrams.
- **Voice:** encouraging and plain-language; celebrate small wins. Technical accuracy is
  available on demand but never the headline. (Mirror leafvario.com's "approachable" tone,
  dialed toward warmth over spec-sheet.)

## Color tokens

| Token | Value | Role |
|---|---|---|
| `--ink` | `#000000` | Primary text, strong structure |
| `--ink-soft` | `#272727` | Secondary surfaces / near-black |
| `--paper` | `#ffffff` | Background |
| `--brand-blue` | `#0099ff` | Primary actions, links, focus rings, selections, accent bars |
| `--brand-blue-strong` | `#007dcc` | Blue hover and high-contrast link text |
| `--success-accent` | `#d8ff00` | Check marks and positive-state accents |
| `--success-surface` | `#424242` | High-contrast surface behind success marks |
| `--emergency-orange` | `#c2410c` | Warning text and borders |
| `--emergency-orange-light` | `#fff0e5` | Warning surfaces |
| red | Tailwind red scale | Errors and destructive actions |
| neutral grays | Defined in `app/globals.css` | Borders, muted text, surfaces |

## Typography tokens

- **Display / wordmark:** `leaf` (custom, logo lockup only).
- **Headings:** `Roboto Condensed`, bold.
- **Body / UI:** `Roboto`, regular/medium.
- **Mono (data, IGC details, coordinates):** system mono stack (matches leafvario.com's
  `--font-mono` usage).

## Control and UI type sizes

- Use the shared `Button` component for standard actions: small is 32px high with 14px
  text, medium is 40px high with 14px text, and large is 48px high with 16px text.
- Use 14px (`text-sm`) for form labels, status messages, menus, and ordinary control text.
- Use 12px (`text-xs`) only for supporting metadata and space-constrained controls.
- Replay, map, and icon-only controls may use purpose-built dimensions when their layout
  depends on a compact control cluster.

## Signature motifs to reuse

1. **Blue accent bar** under section headers.
2. **Roboto Condensed headers** for that technical-yet-approachable signage feel.
3. **High-contrast monochrome base** so blue, lime, and flight photography pop.

## Anti-patterns (don't do these)

- Don't go fully austere/cold — this is a social app, not a spec sheet.
- Don't drown the monochrome base in color — blue and lime are accents, not the field.
- Don't round corners heavily (no pill-everything) — stay closer to the Leaf's crisp,
  technical restraint than to a bubbly consumer app.
