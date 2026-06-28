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
