/**
 * User-facing release notes shown on /whats-new. Newest first. Keep entries
 * friendly and benefit-oriented (no PR numbers or internals) — FEATURES.md is the
 * developer-facing log. Add a new entry at the top when a feature ships.
 */
export interface ReleaseNote {
  /** ISO date (YYYY-MM-DD) the feature rolled out. */
  date: string;
  title: string;
  body: string;
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    date: "2026-09-02",
    title: "Ratings sign-offs are live",
    body: "If you're the instructor named on a flight, you can now sign off USHPA P2/P3/P4 skills you witnessed — precision landings, demonstrated skills and knowledge. It shows up immediately on the pilot's Ratings page as \"Signed off by [you] on [date]\", permanently credited to you.",
  },
  {
    date: "2026-09-02",
    title: "Instructors can leave private notes",
    body: "If you're the instructor named on a flight, you can now leave a private note right on that flight's page — coaching points, what to work on next time. Only you and the pilot can see it, never anyone else the flight is shared with.",
  },
  {
    date: "2026-09-01",
    title: "Name a flight's instructor",
    body: "A flight's edit page now has an Instructor card — name any accepted friend as the instructor of record for that flight. It's the first step toward instructor sign-offs on your Ratings page; for now it's just a tag you control, with no notification sent.",
  },
  {
    date: "2026-08-31",
    title: "Tag flight details for your ratings",
    body: "A flight's edit page now has a Flight details card: Occupancy (solo/tandem), Flight type (like Cross Country), Launch type (Ridge Soaring, Cliff Launch, and more), and Landing (Restricted Landing Field). Tagging a tandem flight keeps it out of your solo airtime on the Ratings page. The other tags show up there too, as your own self-reported tally — a great way to track what you've flown before talking it through with an instructor.",
  },
  {
    date: "2026-08-29",
    title: "Track your ratings progress",
    body: "A new Ratings page shows how you're coming along toward USHPA's P2, P3, and P4 paragliding ratings — flight count, flying days, airtime, and the variety of sites and gliders you've flown, all worked out automatically from your logbook. Criteria that need an instructor's sign-off show up too, clearly marked as coming soon.",
  },
  {
    date: "2026-08-29",
    title: "Edit a flight after the fact",
    body: "Tap the pencil next to a flight's title to open its new edit page — change who can see it, jot down notes about the conditions or how it went, add more photos, or delete the flight, all in one place. Notes are just for you; they show up on the flight page but only when you're the one looking.",
  },
  {
    date: "2026-08-29",
    title: "A bigger, smarter 3D replay",
    body: "The 3D replay is now the main event — bigger, wider, and on by default. A new set of controls sits right on the map: toggle the ground shadow, hover the camera icon to pick Follow, Chase, or Fixed, hover the basemap icon to swap styles, jump straight back to your glider, or zoom out to frame the whole route in one tap. Playback now lives in a single compact bar right on the map, with a simple speed dropdown alongside the scrubber.",
  },
  {
    date: "2026-08-29",
    title: "Cleaner flight stats and sharing",
    body: "Your flight's key numbers got a refresh — start and landing time now sit right in the stats card, climb and sink read together on one line, and your wing rounds out the header row. Kudos and your flight's visibility now sit together as simple icons next to the title. Prefer feet and mph? The Metric/Imperial toggle now follows you into the 3D replay's live readout too, so everything matches.",
  },
  {
    date: "2026-08-26",
    title: "Navigation, everywhere",
    body: "The Logbook / Feed / Upload / Profile menu now follows you onto a flight page and onto any pilot's profile — not just the pages you'd expect it on. If you were signed in, you no longer lose your way back after opening a flight from your feed.",
  },
  {
    date: "2026-08-26",
    title: "Flight stats, at a glance",
    body: "A flight's key numbers now live in one clean card — date, airtime, altitude gained, best climb and sink, distance flown, and where you launched, each with its own icon so you can scan it in a second. Prefer feet and miles over meters and kilometers? Flip the Metric/Imperial toggle right on the card — it remembers your choice next time.",
  },
  {
    date: "2026-08-24",
    title: "Simplifying: just sites for now",
    body: "We added \"spots\" within a site a few sprints back — a north launch, a specific LZ — plus boundaries and community editing to go with them. It turned out to be more than most flying needs day to day, so we're stepping back to just sites for now, one name per launch or landing. Nothing you've named is gone: any spot you'd already added still keeps your flight tagged to its site, we're just not showing the extra layer right now. If it turns out pilots want it back, it's a quick flip, not a rebuild.",
  },
  {
    date: "2026-08-23",
    title: "Sites you make public are community property now",
    body: "A public site or spot isn't just yours anymore — it belongs to everyone who flies there. Any signed-in pilot can now fix a typo in a public name or redraw a boundary that's a little off, not just whoever created it. Every public site and spot shows who's contributed to it and a short history of what's changed, right in its info — tap its name from any flight to see it, even one that isn't yours. You can also endorse a site you trust with a one-tap upvote. Deleting or making a site private again still only works for the original creator, and locks once another pilot has pitched in — nobody can pull a place out from under the community that's built it up.",
  },
  {
    date: "2026-08-21",
    title: "Draw the actual shape",
    body: "A circle around one point can't capture a 3km ridge, or tell apart two launches tucked close together. Now you can trace the real outline of a site or spot instead — open its naming dialog, tap \"Edit boundary,\" and draw it right on the map. Flights land inside the shape you drew, not just a fixed radius, so a ridge-long site finally catches flights from both ends, and a tight launch stops grabbing its neighbor's. No boundary drawn yet? Everything keeps working exactly as it does today — this is entirely optional, and you can reach it for any of your own sites or spots even before a flight is named at all, from \"Edit a boundary on one of my sites\" in the naming dialog.",
  },
  {
    date: "2026-08-20",
    title: "Launches and LZs, by name",
    body: "Real sites usually have more than one spot — a north launch, a south bowl, a lower LZ. You can now name those too. Open a flight bound to a site you've already named, and you'll see an optional \"Which spot?\" step where you can add the exact launch or landing, public or private, same as naming the site itself. Skip it any time — a site with no named spots keeps working exactly as it always has. Once you've named a spot, your next flight from there (and your older flights nearby) pick it up automatically, showing \"Site — Spot\" instead of just the site name.",
  },
  {
    date: "2026-08-19",
    title: "Every site is pilot-named now",
    body: "We retired the small starter list of pre-loaded launches — Leaf Log's gazetteer is now built entirely by pilots, using the naming tool above. If a flight you upload from a well-known launch shows \"Unknown site,\" you're probably the first to log it here — go ahead and name it (see \"Name your own launch\" below) so it's ready for the next pilot too.",
  },
  {
    date: "2026-08-19",
    title: "Name your own launch",
    body: "Flew somewhere Leaf Log didn't recognize? You can name it now. Open the flight, tap \"Unknown site\" (takeoff or landing), and give it a name — share it publicly so every pilot who launches from there gets it too, or keep it private just for you. Your next flight from the same spot names itself automatically, and so do your older flights from there. If a nearby site already exists, we'll offer it first so you're not creating a duplicate.",
  },
  {
    date: "2026-08-19",
    title: "See what your Leaf uploaded",
    body: "Connected devices now show their latest uploaded flight, with a direct link from Settings → Devices. Pairing also remembers the Leaf Log account shown on your vario, and reconnecting or unlinking cleans up the old device access automatically.",
  },
  {
    date: "2026-07-27",
    title: "Your Leaf uploads its own flights",
    body: "Connect your Leaf vario once and your flights land in your logbook on their own — no SD card, no exporting, no dragging files into a browser. Your Leaf shows a code you can scan or tap, you confirm it's yours, and that's it. Manage your connected varios (and disconnect one any time) under Settings → Devices. This needs a Leaf firmware update that's still on its way — once your vario has it, everything here is ready and waiting.",
  },
  {
    date: "2026-06-28",
    title: "A better 3D replay",
    body: "The 3D flight replay got three upgrades: cleaner \"2D\" / \"3D\" view buttons, a ground-shadow toggle that drapes your track's footprint on the terrain so you can see how high you were, and a new Chase camera that flies behind the glider and turns with it (it smooths out tight thermals so it won't make you dizzy).",
  },
  {
    date: "2026-06-28",
    title: "Find your friends",
    body: "Searching for pilots is easy now — on the Friends page, start typing a name or @handle and matching pilots appear as you type, ready to add with a tap.",
  },
  {
    date: "2026-06-28",
    title: "Fly with friends",
    body: "Leaf Log is social now. Send a friend request and, once it's accepted, you're connected both ways. Share flights just with your circle by setting any flight — or your upload default — to \"Friends only.\" Give a thumbs-up to flights you can see, and follow along in a new Feed of your friends' latest flights.",
  },
  {
    date: "2026-06-27",
    title: "Stay signed in",
    body: "After you click your magic sign-in link, you can now choose to stay signed in on your device for a month — no more re-requesting a link every visit. And once you're signed in, opening Leaf Log takes you straight to your logbook.",
  },
  {
    date: "2026-06-26",
    title: "Frame your profile photo",
    body: "When you add a profile photo, you can now pan and zoom to choose exactly what shows in your avatar circle.",
  },
  {
    date: "2026-06-26",
    title: "Profile & settings",
    body: "A new settings page to set your handle, display name, and bio, upload an avatar, and pick the default privacy (public or private) for flights you upload.",
  },
  {
    date: "2026-06-24",
    title: "Photos on your flights",
    body: "Add photos to a flight and see them pinned right where you took them — along your track on the 2D map and floating over the 3D replay — with a gallery on the flight page. HEIC photos from iPhones are supported.",
  },
  {
    date: "2026-06-19",
    title: "3D flight replay",
    body: "Relive a flight in 3D over real terrain, with a follow-camera, a scrubbing timeline linked to the barograph, and selectable basemaps including satellite.",
  },
];
