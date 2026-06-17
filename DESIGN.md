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
- **Signature accent:** warm amber **`#ffb459`**, used on the hardware site as a **3px
  underline bar** beneath section headings. Carry this accent-bar motif over as a
  recognizable through-line.
- **Leaf wordmark:** the custom `leaf` display font (`font.ttf`) — used for the logo lockup
  only.

## What we warm up (the "warmer room")

- **Corners:** soften from the site's `border-radius: 0` to a **small radius (~4–6px)** on
  cards, buttons, inputs. Keep the amber accent *bar* sharp as a deliberate nod.
- **Elevation:** allow **subtle, soft shadows** on cards (feed, flight tiles) where the
  hardware site is strictly flat — gives the social UI a friendlier, tactile depth.
- **Color warmth:** lean on amber more generously (not a lone hairline), and introduce a
  **leaf-green secondary** nodding to the device's green reflective LCD — used for nature /
  "sky & growth" / positive states (PBs, milestones, success).
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
| `--amber` (accent) | `#ffb459` | Signature accent — accent bar, highlights, primary CTA |
| `--leaf-green` | _provisional ~`#6FAE5E`_ | Secondary — nature, success, milestones (refine to match LCD/logo) |
| neutral grays | TBD scale | Borders, muted text, surfaces |

> `--leaf-green` is provisional — pin the exact value against the device's LCD green and the
> official logo before locking.

## Typography tokens

- **Display / wordmark:** `leaf` (custom, logo lockup only).
- **Headings:** `Roboto Condensed`, bold.
- **Body / UI:** `Roboto`, regular/medium.
- **Mono (data, IGC details, coordinates):** system mono stack (matches leafvario.com's
  `--font-mono` usage).

## Signature motifs to reuse

1. **Amber 3px accent bar** under section headers — the single most recognizable Leaf cue.
2. **Roboto Condensed headers** for that technical-yet-approachable signage feel.
3. **High-contrast monochrome base** so amber and flight photography pop.

## Anti-patterns (don't do these)

- Don't go fully austere/cold — this is a social app, not a spec sheet.
- Don't drown the monochrome base in color — amber and green are *accents*, not the field.
- Don't round corners heavily (no pill-everything) — stay closer to the Leaf's crisp,
  technical restraint than to a bubbly consumer app.
