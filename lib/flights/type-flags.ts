import { z } from "zod";

export const FLIGHT_FLAGS = ["tandem", "siv", "competition", "tow"] as const;
export type FlightFlag = (typeof FLIGHT_FLAGS)[number];
export const FLIGHT_FLAG_LABELS: Record<FlightFlag, string> = {
  tandem: "Tandem", siv: "SIV", competition: "Competition", tow: "Tow",
};
export const flightFlagsSchema = z.array(z.enum(FLIGHT_FLAGS)).max(4).transform(values => [...new Set(values)]);

/** Include tags saved by the earlier CSV and special-skills editors. */
export function flightFlags(flight: { flightFlags?: string[]; occupancy?: string | null; launchTypes?: string[] }): FlightFlag[] {
  return FLIGHT_FLAGS.filter(flag => flight.flightFlags?.includes(flag)
    || (flag === "tandem" && flight.occupancy === "tandem")
    || (flag === "tow" && flight.launchTypes?.includes("ST")));
}
