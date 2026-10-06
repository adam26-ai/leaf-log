# Feed responsive layout

The ordered card-width transitions live in `lib/flights/feed-layout.ts`.
The list shares one layout, using the trophy sets on the current page. Column
alignment therefore does not depend on whether a particular row has badges.
Page padding scales smoothly from 12px to 24px. The pilot column has a separate
compact snap that releases 30px to the flight card as the window narrows.
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
keep the shared slot for alignment until badge columns combine below 300px.

In decreasing **card width** order:

1. First, group trophies down to one pill (below 680px).
2. Below 640px: trophy pills become 24px icons instead of 44px detailed pills, hiding the secondary icon.
3. Below 600px: hide upload source.
4. Below 360px: put the site above a single date/time/duration line, releasing the date column. Takeoff and arrow/landing share a line when both fit; otherwise the landing wraps as a unit below takeoff. The date/time/duration line truncates rather than wrapping when space runs out. Maximum altitude occupies its own column spanning both rows while visible.
5. Below 300px: hide maximum altitude and combine the friends and trophy badges into one column, side by side. Its width follows each flight's actual badges: 32px for friends only, 24px for a trophy only, or 60px for both including a 4px gap. The site and date/time/duration use all remaining space up to the badges. For flights with neither badge, both text rows span the whole card.

Font sizes stay at their widest-layout values at every width: site names 16px,
date/time/duration 13px, and pilot names 14px. Other text retains its existing size.

The pilot column scales at 16% of **whole list width**, up to 176px total.
It includes the 46px avatar, a 6px gap, and the remaining name/handle area.
When that text area would fall below 90px, it snaps to a fixed 60px, hides
the handle, and lets the name wrap to two lines at 14px. The total pilot column
then stays at 112px. This happens below 887.5px list width (roughly 936px page
width). The avatar stays beside the name. Thresholds use actual available space,
not device labels.

No trophies are discarded by grouping; their details remain in the tooltip.
Names and site labels may still truncate when minimum badge and identity sizes
leave insufficient room. These are deliberate starting priorities for iteration.
