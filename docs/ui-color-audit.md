# UI color suggestions for review

September 10, 2026. Source audit of application pages and shared components. The reviewed friend actions, upload links, default avatars, warning surfaces, primary-button foreground, and success/completed states are applied.

The current implementation uses brand blue (`#0099ff`), lime (`#d8ff00`) for replay accents/public sharing, and neutral surfaces. `DESIGN.md` still describes the earlier amber/leaf-green scheme. These suggestions use the current application tokens as the reference.

| Suggested item | Current appearance and locations | Suggested change |
| --- | --- | --- |
| Accept and Add friend buttons | Updated | Current primary blue with white text in request lists and profiles/search results. |
| Upload result links | Updated | Current brand-blue link treatment. |
| Default avatars | Updated | Pale brand-blue fallback with strong-blue initials; uploaded images retain a neutral placeholder. |
| Success and completed states | Applied | Replaced muted green with a charcoal disc and Leaf-lime check for activation, pairing, import, rating milestones, and saved confirmations. All use the shared `SuccessMark` / `SuccessStatus` treatment with a 3.25 px check stroke for better visibility. |
| Import and attachment warnings | Updated | Existing emergency-orange warning tokens now cover manual-entry duplicates, CSV-preview duplicates, undo-import confirmation, and mismatched IGC dates. |
| Destructive actions and errors | Retained | Red remains the error/delete palette; emergency orange remains the warning/caution palette. |
| Selected controls and primary button text | Primary buttons updated | Primary buttons now use white on blue, matching replay/visibility controls. Pale-blue map defaults and solid-blue logbook filters remain appropriate for their different selected states. |

Consistency follow-ups were also applied: `DESIGN.md` now documents the approved palette and common control/type sizes; lime and charcoal UI treatments share semantic tokens; and the dormant green flight-row hover now uses brand blue.

Gold/silver/bronze medal colors, the blue/green flight-performance shading, and the map’s metric/terrain colors encode data. They are not suggested for a blanket brand-color replacement.
