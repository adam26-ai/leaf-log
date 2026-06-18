import { Roboto, Roboto_Condensed, Roboto_Mono } from "next/font/google";

// Body / UI — Roboto (DESIGN.md anchor, matches leafvario.com)
export const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

// Headings / signage — Roboto Condensed (compact, technical-yet-approachable)
export const robotoCondensed = Roboto_Condensed({
  variable: "--font-roboto-condensed",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

// Data / coordinates / IGC details — mono
export const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
  display: "swap",
});

export const fontVariables = `${roboto.variable} ${robotoCondensed.variable} ${robotoMono.variable}`;
