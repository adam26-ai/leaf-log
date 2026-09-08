# Replay and logbook improvements

Implemented on `codex/friends-flight-replay`, September 8, 2026.

## Replay

- Photo hover and lightbox navigation leave playback time, play/pause state, and selected pilot alone. Crossing a visible pilot's photo during forward playback shows a dismissing preview for four wall-clock seconds. Scrubbing does not trigger these previews.
- Scrubbing starts elapsed-track rendering, just as pressing Play does. The full-route preference still overrides this behavior.
- Clicking the XC metric toggles the selected pilot's scored ground route. The original request ended after “toggle”; this uses the proposed show/hide interpretation.
- Basemap flyouts retain focus during pointer movement, and each style replacement reinstalls terrain and overlays after `style.load`. Switching away cancels stale callbacks.
- Overview framing stops tracking synchronously before fitting the route, so subsequent playback frames cannot interrupt the animation.
- Follow and chase position the pilot using altitude within that flight's min/max range. The highest point leaves clearance for the entire badge below the instruments; the lowest anchor is 12% above the map bottom.
- Orbit takes 60 seconds per revolution. Chase recognizes nearly straight travel over 12 seconds (at least 60 m, with net displacement at least 97% of travelled distance), backed by a 300 m / 60-second course window. It does not bridge recorder gaps. Small thermal circles hold the heading; heading changes ease with a one-second time constant, capped at 24 degrees per second.
- Playback camera position, elevation, and altitude-dependent framing follow a critically damped spring in all tracking modes. It retains velocity for gradual acceleration, runs on wall-clock animation frames, and increases its catch-up rate as screen-space drift grows. Pause allows it to settle; explicit centering, scrubbing while paused, pilot selection, and manual navigation remain immediate. Fixed/overview mode stops the spring.
- Manual chase rotation stores a bearing offset. Selecting Chase again resets the offset.
- GPS speed averages travelled distance over a centered ten-second window, weighted by time and excluding recorder gaps. Turning flight is measured along its path, not as a chord.
- Units move to the flight actions row. Settings use “Draw flight during playback” and “Always show full route.”
- Replays without companion pilots use a compact friends/refresh pill; discovering a companion expands the full pilot card.

## Narrow screens

- Map margins, instruments, and fonts shrink; the map has enough minimum height for the controls. Main controls sit below native zoom controls and above playback controls.
- Pilot banners use initials. Navigation icons remain visible, and compact logbook rows hide source and visibility icons below 400 px.
- One-finger horizontal dragging rotates; vertical dragging tilts. Two fingers add pinch zoom and rotation. Tracking modes retain the pilot's position during these gestures.
- Site and wing dropdowns stay within the viewport.

## Trophies and filters

- Personal all-time gold, silver, and bronze ranks cover duration, maximum MSL altitude, gain from launch, and each of the three XC route categories. Filters do not recalculate ranks.
- Ties share a medal and skip subsequent places (two golds followed by bronze). Missing, nonfinite, or failed-flight metrics do not receive awards. Approximate XC scores are labeled “best found.”
- Gain from launch is maximum altitude minus the first recorded altitude, separate from cumulative climb. An owner-scoped query reads just the first altitude from stored artifacts; no schema change is required.
- One trophy shows its medal and category icon. Multiple trophies show the highest-earned medal with a plus. Hover or keyboard focus exposes a “Personal Bests” panel with medal/category icons, record labels, and right-aligned values.
- Site, wing, and trophy filters intersect. Site/wing filters can be enabled independently; dropdowns support All/None. Site options include flight counts and “Unknown site”; wings include airtime. Summary statistics reflect ready flights in the filtered list.
- Only one filter dropdown opens at a time. Outside pointer/touch interaction, focus moving outside, and Escape dismiss it; selecting checkboxes or All/None inside keeps it open.

## Validation

- Full unit/component suite passed (556 tests), followed by four focused replay tests including the added flyout and XC-toggle regressions.
- TypeScript, scoped ESLint, and the production build passed.
- Browser checks covered basemap selection, overview during playback, altitude framing, site filtering, and 320/390 px layouts without horizontal overflow.
- Chromium mobile emulation exercised horizontal touch rotation and two-finger pinch/tilt. Physical Chromebook and phone testing remains useful for hardware-specific gesture and GPU behavior.
