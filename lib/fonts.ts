import localFont from "next/font/local";

// Bundle fonts so production builds do not depend on Google's CSS responses.
// Upstream sources and redistribution licenses are recorded in ./fonts/.
// Body / UI — Roboto (DESIGN.md anchor, matches leafvario.com)
export const roboto = localFont({
  src: "./fonts/Roboto.ttf",
  variable: "--font-roboto",
  weight: "400 700",
  style: "normal",
  display: "swap",
});

// Headings / signage — Roboto Condensed (compact, technical-yet-approachable)
export const robotoCondensed = localFont({
  src: "./fonts/RobotoCondensed.ttf",
  variable: "--font-roboto-condensed",
  weight: "400 700",
  style: "normal",
  display: "swap",
});

// Data / coordinates / IGC details — mono
export const robotoMono = localFont({
  src: "./fonts/RobotoMono.ttf",
  variable: "--font-roboto-mono",
  weight: "100 700",
  style: "normal",
  display: "swap",
});

export const fontVariables = `${roboto.variable} ${robotoCondensed.variable} ${robotoMono.variable}`;
