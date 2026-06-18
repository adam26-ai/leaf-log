declare module "tz-lookup" {
  /** Returns the IANA timezone name for a coordinate. Throws on invalid input. */
  export default function tzlookup(lat: number, lon: number): string;
}
