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
