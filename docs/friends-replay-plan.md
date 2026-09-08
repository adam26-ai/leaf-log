# Friends in flight replay

Status: discussion draft, 2026-09-08. No application changes implemented.
Recommendations below are proposed defaults, not confirmed product decisions.

## Product model

Three identities must remain distinct:

- **Primary flight**: the flight whose page was opened. It anchors discovery and the initial time.
- **Viewer**: the signed-in person. Their flights, avatar rings, banners, and photo accents use hero green (`#d8ff00`); other pilots use sidekick blue (`#0099ff`).
- **Selected flight**: the single flight supplying the camera target, live instruments, highlighted route, altitude profile, and XC ground overlay.

Opening your own flight makes all three coincide. Opening someone else's flight initially selects that primary flight; a matching flight of your own can still appear at the top with a green ring. Selection does not change ownership colors or navigate to another page.

## Display and interactions

- Put the viewer's avatar first when their matching flight is present, then the primary pilot if different, then other pilots in a stable order. Never reorder the list as playback advances or selection changes.
- Keep the ownership ring green/blue; identify selection separately with a thicker outer outline, size, or selection indicator. Provide names, keyboard selection, and accessible selected state. Use initials when an avatar is missing.
- Selecting an avatar selects its flight, sets the camera to follow, and centers on that pilot. Preserve the current UTC instant, playback speed, and playing/paused state. Later camera controls can still select chase/orbit/fixed as today.
- Selected route: existing climb-green/sink-blue treatment and ground shadow/altitude trails, subject to the shadow toggle. Other routes: thinner neutral white/light grey, no shadows or altitude trails. Check contrast on every supported basemap before choosing the neutral shade.
- Show pilot banners for all displayed pilots, colored by ownership. Prioritize the selected label when labels overlap; identify other pilots on hover/tap rather than allowing unreadable stacks.
- Show only the selected flight's existing XC route/score on the ground. If its score is unavailable, clear the preceding flight's overlay. Viewing a friend does not enqueue scoring or grant edit permissions.
- Apply elapsed/full-route mode consistently to every displayed flight. In elapsed mode, future flights have no flown trail; completed flights retain their completed trail. In full mode, future/completed routes may be visible as context, but their pilots must not appear airborne.
- Keep the existing center-on-pilot and fit-route controls scoped to selection. Add a secondary fit-group action if needed; ordinary selection should not zoom out to every route.
- Make the avatar column scrollable on small screens, with an accessible participant list for overflow. Include a separate show/hide control so selection and visibility are not conflated. Hiding the selected pilot first selects the primary pilot, which remains available.

### Other parts of the flight page

- The live readout names the selected pilot and uses that flight's instrument ranges and altitude source.
- The altitude graph follows the selected flight, drawn on the **group's time axis**, with empty regions outside that flight. Its cursor and scrubber therefore stay aligned. Defer overlaying every pilot's altitude curve unless comparison warrants the extra clutter.
- The page title, whole-flight key statistics, notes, navigation, share/edit controls, kudos, and instructor notes remain attached to the primary flight. Label the selected replay pilot clearly so this distinction is visible.
- Clicking a primary-flight statistic such as maximum altitude explicitly reselects the primary flight and seeks to that event. Clicking its XC statistic selects it before fitting that XC route. Current replay events need a flight identity to prevent selection confusion.

## Playback

Use one shared UTC clock. For each flight:

`flightTimeSeconds = (currentUtcMs - flight.takeoffMs) / 1000`

The slider spans earliest takeoff through latest landing of the flights included in the replay. Open paused at the **primary flight's takeoff**, with that flight selected. This preserves the purpose of opening a particular log while allowing rewind to an earlier friend's launch. Add a clear primary-takeoff mark and a jump-to-start action for the full group.

Example: your friend flies 10:00-12:00 and you fly 10:30-13:00. The slider spans 10:00-13:00 and opens at 10:30. Selecting your friend at 11:00 still shows both pilots at 11:00.

- Show the clock consistently in the primary flight's local timezone, with the date when the group crosses midnight. Changing pilots must not change the displayed timezone. UTC drives matching and playback, not local dates or elapsed time since each pilot launched.
- Stop at the group's final landing. Play at the end restarts from the group's beginning; a separate primary-takeoff action returns to the initial position.
- Before takeoff: show a muted launch marker and "Not launched" status. After landing: show a muted landing marker and "Landed" status. Show unavailable live readings as dashes, not clamped airborne values.
- Selecting an inactive pilot keeps the clock fixed and targets the appropriate endpoint, with an explicit jump-to-takeoff option. Reaching a pilot's landing does not automatically select someone else or stop the group clock.
- Distinguish a recorder gap from landing. Do not invent motion across substantial missing data. Derive a gap threshold from recording cadence, with a documented minimum, and test sparse but valid tracks separately.
- Discovery and downloads must not reset playback. If friends arrive after the user has started scrubbing/playing, preserve the absolute time and announce their availability. Explicitly adding more flights may extend the range; merely hiding a loaded track does not shrink it or move the clock.

### Several flights from one pilot

Proposed default: one avatar per pilot, containing all of that pilot's independently matching flights. Follow their flight active at the current time. Between flights, show a landed/waiting state and leave a gap in the graph; never draw a connection or interpolate a trip between landing and the next launch.

Provide a small takeoff-time flight picker for explicit selection and ambiguous overlapping uploads. Prefer an explicit choice during overlaps, otherwise the primary flight if applicable, then a stable deterministic order. Keep distinct flight IDs and photo ownership throughout. Selecting a pilot should not silently discard their other matching flights.

## Photos

- Include photos from the displayed flights with green/blue accents and the owner's name/avatar in previews and the lightbox. Colors alone cannot distinguish several friends.
- Carry `flightId`, `ownerId`, and photo ID with each item; existing photo components assume every photo belongs to one flight.
- Convert a time-placed photo using its own flight's takeoff plus `tSec`. Use the placement result consistently; do not reinterpret EXIF timestamps in the browser.
- Proposed click behavior: open the lightbox, pause, select the owning flight, and seek to its capture time when known. Hover previews should not switch pilots or move the camera. A photo without usable time opens without seeking; one without coordinates stays out of the map.
- Sort the combined gallery by known capture time, with untimed photos separately identified. Load thumbnails as needed, and full images only on demand.
- Preserve owner-only upload/edit permissions. Selecting a friend's avatar never retargets drag-and-drop uploads to their flight; uploads on the primary flight page still require ownership of that primary flight.

## Automatic matching

Treat this as finding a nearby **outing**, not proof that two pilots flew side by side.

Proposed rule: a ready flight from an eligible pilot qualifies when its airtime overlaps the primary flight or the interval gap is at most **60 minutes**, and the shortest horizontal distance between the two flight routes is at most **5 km**. Time overlap and spatial proximity are independent conditions; the nearest route points need not have occurred simultaneously. If the desired meaning is specifically "airborne near one another," that requires a stricter time-aligned distance rule instead.

For primary interval `[Astart, Aend]`, the initial time filter is:

`candidateStart <= Aend + 60 minutes AND candidateEnd >= Astart - 60 minutes`

Then:

1. Authorize the primary flight and determine eligible pilots from the accepted friendship graph; pending requests do not qualify. The graph scope is an open decision below.
2. Query ready, viewer-visible candidate flights with valid start/end times using the interval filter. Missing/invalid dates are not repaired by guessing from an upload date.
3. Reject candidates whose route bounding boxes cannot be within 5 km. Use latitude-aware distance expansion and handle the antimeridian conservatively.
4. Compare the remaining route geometry in metres, using segment distances so a crossing between sampled points is detected. Reuse a spatial index for the primary route when necessary; avoid a full raw-fix Cartesian comparison.
5. Rank matches by overlapping airtime first, then proximity and time gap, with a deterministic tie-breaker. Test threshold boundaries explicitly.

Do **not** require nearby start/end points as a prerequisite: friends can launch and land far apart while meeting along an XC route. The proposed 10 km endpoint rule is cheap, but both misses those flights and admits unrelated nearby-site flights. Bounding boxes are a better conservative first pass.

The existing simplified 2D track is useful for screening, but its degree-based simplification and final point cap do not promise a metre-based error bound. For a reliable 5 km cutoff, use matching geometry with a recorded simplification tolerance. Classify only cases safely outside/inside that tolerance from the simplified lines; refine uncertain candidates against valid recorded segments. Do not count invented segments across recorder gaps as proximity.

Every candidate must match the **primary flight** directly. Do not recursively add friends of friends or flights matching only another companion, which could expand one replay across a whole day or region.

## Discovery, permissions, and cost

### Friends-of-friends boundary

Discussion refinement, 2026-09-08: discovery may introduce a new pilot, but access must never be inherited through the primary pilot. The proposed default preserves the existing meaning of friends-only: **direct accepted friends of that flight's owner**.

Example: you are friends with Alice; Alice is friends with Ben; you and Ben are not friends. When you open Alice's replay:

- Ben's matching **public** flight may appear under the proposed owner-network discovery scope, allowing you to discover him and explicitly send a friend request.
- Ben's **friends-only** flight does not appear unless you and Ben are directly accepted friends. Alice being able to see it grants you nothing.
- Ben's **private** flight is excluded from automatic social discovery. Existing instructor access to an explicitly opened flight does not expand a replay audience.

Apply this per flight, not per profile or group: a pilot can have both public and friends-only flights. Photos inherit the individual flight's access, too.

Filter before returning participant identities, flight IDs, times, photos, counts, or pagination metadata. Do not show a greyed-out avatar, "one hidden pilot," or another clue that an inaccessible flight participated. A person's public profile is separate from permission to associate them with a particular private outing.

The same replay URL can therefore show different companions to different viewers. Resolve the group for the actual viewer on every load; the primary owner cannot make another person's flight public by sharing their replay. Do not publish an owner-authorized group manifest as the shared replay.

Public-flight discovery still makes existing public information easier to find and can suggest a social connection. Describe these pilots as "Flying nearby" or "Pilots in this replay," not as confirmed people who flew together or a public list of the primary pilot's friends. Do not expose friendship edges or mutual-friend badges through the manifest. If pilots need finer control later, consider an explicit group-discovery preference; do not silently reinterpret existing friends-only flights as friends-of-friends.

### Loading and performance

Rechecking on page load is the recommended design. A later upload becomes discoverable on the next load without any permanent pairing records. Add "Refresh friends" for a page left open while others upload. Continuous polling and upload notifications are unnecessary for the first release.

The expected query scope is the eligible friends' nearby time window, not everyone's entire flight history. Validate actual database plans and representative data before promising latency. Candidate work, replay downloads, and rendering all need bounds; a small visible list alone does not bound discovery work.

- Add a lightweight, viewer-scoped companion manifest endpoint, for example `/api/flights/[id]/companions`. Return participant identity, flight IDs, timing, availability, and pagination, not raw IGC or image bytes. Evaluate geometry on the server before returning matches.
- Reuse the flight repository's authorization seam for every returned flight and existing protected replay/photo routes for payloads. Friendship to the primary pilot does not authorize viewing somebody else's friends-only flight.
- Automatic social discovery should include the viewer's own matching flights and eligible public/friends-visible flights. Private flights accessible only through instructor roles should not be auto-discovered as social companions; explicitly opening an authorized private primary flight continues to work.
- Recheck access on each request. An unfriend, visibility change, or deletion affects subsequent discovery and payload requests. Previously delivered data cannot be recalled; revalidation removes inaccessible companions from an open session when it next checks.
- Keep the companion response `no-store` initially. Cache derived per-flight geometry/replay artifacts behind fresh authorization, rather than caching an authorized group's response across viewers.
- Load the primary replay immediately. Start companion discovery independently; companion errors cannot break solo replay. Each failed companion gets its own retry/unavailable state.
- Provisional initial display budget: primary plus up to five companion pilots, with explicit "Show more" and per-pilot controls. Benchmark this number on a phone and desktop before fixing it. Support paged candidate scanning and surfaced partial results if discovery needs a work limit; never silently present a truncated result as exhaustive.
- Limit concurrent companion downloads. Cache geometry in the client for selection changes; fetch selected terrain/XC details as needed. Use simpler neutral paths for companions rather than multiplying the expensive selected-flight effects.

## Code findings and implementation shape

Reviewed against the current repository:

- `prisma/schema.prisma` already stores accepted friendships, flight owners/visibility/status, UTC takeoff/landing, endpoints/bounds, avatars, and time-placed photos. Flight list indexes currently use owner/status/date rather than the proposed timestamp query.
- `lib/igc/replay.ts` supplies time-aligned samples, UTC takeoff, altitude source, and vario, capped at 24,000 samples per flight.
- `app/api/flights/[id]/replay/route.ts` currently reparses raw IGC and derives the replay on every request.
- Both `FlightViz` and `FlightReplay3D` independently fetch that replay endpoint. Consolidate this into one data owner before adding companions.
- `FlightReplay3D` has one track, one terrain offset, one ground cache, and singleton shadow/overlay IDs. Multi-flight rendering needs identities and state per flight, with selected-only effects; it is more than drawing additional polylines.
- Terrain anchoring corrects each recording's altitude reference at takeoff. Keep that correction per flight and separate from raw instrument values; switching pilots must not reuse another flight's correction or terrain profile.
- Interpolation currently clamps to a flight's endpoints. Wrap it with explicit before/active/gap/after state before using it for group playback.
- The slider, graph, photo callbacks, and metric events currently use seconds since one takeoff. All require conversion at their boundaries to the common clock.
- `lib/flights/repo.ts` and `lib/photos/repo.ts` contain existing visibility/access rules, including instructor exceptions that need to remain distinct from social eligibility.
- The installed Next.js Route Handlers guide confirms request-time database/auth routes can remain dynamic; there is no need to introduce static group-response caching.

Suggested client shape: one replay controller owns primary ID, participants, selected pilot/flight, UTC time, transport, and visibility. The map receives prepared flight data; it does not independently fetch each route. Static geometry is memoized per flight, and animation updates positions/camera without rebuilding every route each frame.

Store versioned derived replay and matching artifacts alongside `FlightData`, retaining raw IGC as the source of truth. Include source hash and parser/derivation versions. Generate on ingest; lazily build for old flights with concurrency protection, and update the reprocessing script to invalidate/rebuild them. Compare artifact timing with the indexed flight metadata so a parser change cannot leave discovery and playback using different takeoff times.

Start with a suitable owner/status/takeoff timestamp index and measure the query plan; add landing/spatial indexes only if justified. Bounds can initially be filtered in application code after the indexed time query. No new geospatial service is assumed.

## Delivery stages

1. **Replay foundation:** consolidate fetching, add the shared-clock adapter and explicit flight states, persist/version replay and matching artifacts, retain solo behavior, and add timing/cache regression coverage.
2. **Companion discovery:** implement viewer-scoped matching, query/index changes, lazy legacy artifact generation, deterministic results, pagination/limits, refresh, and permission tests.
3. **Group rendering:** support several tracks/pilots, avatar selection, per-flight terrain state, selected instruments/graph/XC, stable camera behavior, and mobile participant controls.
4. **Photos and release validation:** add ownership-aware photo aggregation and interactions, finish partial-failure states, and measure discovery latency, first-primary-paint, transferred bytes, and frame rate with representative groups. All four stages belong to the requested feature.

## Acceptance cases

- Opening a solo flight still works without friends, photos, or an avatar.
- Two flights with different launch times show the correct simultaneous positions. Switching selection changes the camera/readout/graph/XC without changing UTC time.
- Earlier/later flights, midnight rollover, different local timezone offsets, endpoint boundaries, and recorder gaps behave correctly.
- Several sequential flights by one pilot have no fabricated connecting path; overlapping uploads can be chosen explicitly.
- A route crossing far from all four endpoints qualifies; a near miss outside 5 km does not. Exactly 5 km and exactly 60 minutes follow the documented inclusive rule. Nearby routes more than 60 minutes apart do not qualify.
- Discovery after a later upload finds it. Empty discovery, partial downloads, a deleted flight, and refresh during playback preserve a usable primary replay.
- Owner/friend/stranger/anonymous access, pending/unfriended relationships, private visibility, instructor-only access, and protected photo bytes are tested independently. Counts and metadata reveal only eligible visible results.
- In an Alice-Ben-viewer chain with no Ben-viewer friendship, Ben's public flight can qualify but his friends-only/private flights and their participation metadata cannot. Sharing Alice's replay does not carry Alice's permissions to the recipient. Accepting/removing a direct Ben-viewer friendship changes eligibility on the next request.
- Ownership accents remain stable while selection changes; selected-only shadows and XC clear correctly. Basemap switching and terrain loading do not leave stale overlays.
- Photo clicks identify the correct owner/flight and seek correctly; untimed photos do not seek, and uploads remain owned by the primary flight's owner.
- Profile/slider time axes align, primary statistic clicks target the primary flight, and keyboard/mobile controls remain usable.
- Benchmark representative long flights and larger candidate sets, with database-backed tests and browser checks on desktop and mobile. Use findings to set the initial participant budget; no performance claim is made yet.

## Open decisions

The first three questions have been sent for discussion:

1. On someone else's flight page, discover the primary owner's friends plus the viewer's own matching flight (proposed), the viewer's friends, or restrict the first release to viewing your own flights? Each candidate must independently pass viewer access checks. For signed-out viewers, propose solo replay initially rather than exposing an automatic friend roster; confirm public group behavior as part of this choice.
2. Include nearby flights with up to a one-hour airtime gap (proposed), or require overlapping airtime?
3. One avatar per pilot covering their matching flights (proposed), or separate avatars per flight?

Other defaults to review: open at the primary takeoff rather than earliest group takeoff; selection preserves time; show explicit not-launched/landed states; the altitude graph follows selection; photo clicks pause/select/seek; primary page statistics and actions keep their existing subject.
