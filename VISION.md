# Leaf Log — Vision

> The **official companion platform for the Leaf vario**: a friendly, social flight
> logbook for the **beginner-to-intermediate** free-flight community. Flights arrive by
> drag-drop *or* automatically pushed from a connected Leaf. Each flight is parsed into a
> beautiful, rewarding view and added to your logbook. **Private by default** — you decide
> what to share — with a warm, supportive community layer (not a competitive leaderboard)
> for the flights you choose to make public.

## Identity (non-negotiable)

- **Welcoming, not intimidating.** "Strava for the rest of us." Explicitly *not* chasing
  the XContest / Leonardo XC-hardcore. The product is about progress, encouragement, and
  learning — for the weekend and intermediate pilot.
- **Leaf-native.** A co-designed firmware↔API push path (we influence the Leaf firmware) is
  the wedge no competitor can copy. Onboarding can revolve around "claim your Leaf, and
  your flights flow in automatically."
- **Private-first, opt-in social.** Personal progress is valuable even for a pilot who
  never shares a flight. Sharing is a deliberate, low-pressure choice.

## How it works (the data spine)

1. **Ingestion** — IGC files arrive two ways:
   - Manual drag-drop / file picker in the web app.
   - Device push: a connected Leaf uploads new flights to an authenticated ingestion API.
2. **Parse** — read the IGC header (pilot, glider, date, recorder) + the GPS/baro fix
   stream.
3. **Derive** — duration, takeoff/landing times, max altitude, altitude gained, max
   climb/sink, track distance, straight-line distance.
4. **Locate** — reverse-lookup takeoff/landing coordinates to a **named site**.
5. **Present** — render a beautiful flight-detail page (map, barograph, climb/glide
   analysis) and append the flight to the pilot's logbook.

## Audience & positioning

- **Public community platform**, hosted (cloud), multi-user with accounts and public pilot
  profiles.
- Aimed at the **less competitive, more social** part of the community — beginner and
  intermediate pilots.
- The three reinforcing hooks: (1) seamless Leaf auto-upload, (2) delightful flight
  visualization, (3) supportive social community — *not* leaderboards/competition.

## Privacy model

- **New flights are private by default.** Sharing is opt-in, per flight.
- Consequences for design:
  - The social feed is built entirely from *opt-in* shared flights → design gentle,
    no-pressure nudges to share (e.g. "share this to your home-site feed") rather than
    relying on default-public volume.
  - Solo value must stand alone — the logbook + progress tracking (hours, sites flown,
    personal bests, milestones) must feel great for a pilot who shares nothing.

## MVP — Milestone 1

Accounts + public pilot profiles, IGC upload, parsing, a beautiful flight-detail page, and
a personal logbook list. A real multi-user platform from v1, but the community feed,
following, and device-push land in later milestones.

Phasing of the bigger vision:
- **M1:** Accounts, public profiles, manual upload, parse/derive, flight view, logbook.
- **Later:** Community feed, following, kudos/comments, site communities.
- **Later:** Device-push ingestion API + Leaf firmware integration.

## Design language

Visual identity must read as family with [leafvario.com](https://leafvario.com/) — decision
is **"same DNA, warmer room"**: keep the Leaf anchors (Roboto / Roboto Condensed, monochrome
base, the `#ffb459` amber accent-bar motif, the leaf wordmark) but soften the hardware site's
austerity for a warm, social, beginner-friendly app. Full spec in [`DESIGN.md`](./DESIGN.md).

## Project nature

**Official Leaf companion** — the blessed companion platform for the Leaf vario, with tight
firmware integration, aligned with the Leaf project/brand.

## Open questions (for the planning phase, not the "what is it" phase)

- **Tech stack** — backend, database, frontend, hosting, object storage for IGC files.
- **Sites dataset** — source for takeoff/landing → site naming (ParaglidingEarth and
  similar need real evaluation).
- **Device-auth model** — how a Leaf proves it is *this pilot's* Leaf when pushing to the
  ingestion API.

## Competitive landscape (for reference)

- **XContest, Leonardo / DHV-XC** — competition/scoring-first, intimidating to beginners.
- **Ayvri** — 3D flight visualization.
- **SeeYou Cloud, Flymaster Cloud** — vendor cloud platforms.
- Leaf Log's differentiation: native Leaf integration + a deliberately welcoming, social,
  private-first experience for the non-competitive majority.
