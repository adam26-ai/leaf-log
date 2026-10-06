# Feed responsive layout

The ordered card-width transitions live in `lib/flights/feed-layout.ts`.
The list shares one layout, using the trophy sets on the current page. Column
alignment therefore does not depend on whether a particular row has badges.
Page padding scales smoothly from 12px to 24px, avoiding breakpoint jumps that
could make cards wider as the window narrows and reverse a layout transition.
Feed text uses 100% text-size-adjust to prevent mobile text inflation; pilot
names have a fixed 14px font size and 20px line height.

Before hiding information, date (16%), altitude (10%), and friends (5%) scale
with card width between their minimum and maximum sizes. Padding and gaps also
shrink. Trophy capacity is reduced first, and the site gets all remaining
space. The date minimum is 104px at every width;
altitude is at least 76px and friends at least 32px. Avatars remain 46px and
the outer kudos column remains 40px, with a 20px thumb centered above the count.

Trophies group using the existing medal-priority rules as their capacity shrinks.
At 840px and above, up to six pills fit. Below 840/800/760/720/680px,
capacity falls to five/four/three/two/one pills respectively. This depends only
on card width: hiding altitude, hiding upload source, stacking text, or using
smaller trophy icons never restores a slot. Widening the card reverses the steps
normally, so the same width always produces the same layout.
The shared column then uses only the width of the largest rendered trophy group
set on this page. It never reserves empty theoretical badge slots. If no flights
on the page have trophies, that track is removed entirely; otherwise empty rows
keep the shared slot for alignment.

In decreasing **card width** order:

1. First, group trophies down to one pill (below 680px).
2. Below 640px: trophy pills become 24px icons instead of 44px detailed pills, hiding the secondary icon.
3. Below 600px: hide upload source.
4. Below 400px: hide maximum altitude.
5. Below 360px: put the site above a single date/time/duration line, releasing the date column. Takeoff and arrow/landing share a line when both fit; otherwise the landing wraps as a unit below takeoff. The date/time/duration line truncates rather than wrapping when space runs out.

Font sizes stay at their widest-layout values at every width: site names 16px,
date/time/duration 13px, and pilot names 14px. Other text retains its existing size.

Independently, below 600px of **whole list width** (roughly 434px card width),
hide the handle and let the pilot name wrap to two lines at 14px. The avatar
stays beside the name. Thresholds use actual available space, not device labels.

No trophies are discarded by grouping; their details remain in the tooltip.
Names and site labels may still truncate when minimum badge and identity sizes
leave insufficient room. These are deliberate starting priorities for iteration.
