// Places: named groups of Platforms by where I play (Couch, Game room). Pure.
import { samePlatformName } from "./platform";

export const PLACE_NAME_MAX = 50;
/** Most Platforms one Place can hold. */
export const PLACE_PLATFORMS_MAX = 50;

/** A Place: a name and the Platforms I can play there. A Platform can be in several Places. */
export interface Place {
  id: string;
  name: string;
  platformIds: string[];
}

/** A Place name as stored: trimmed, 1..PLACE_NAME_MAX characters. Undefined when the input can't be one. */
export function cleanPlaceName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.trim();
  return name.length > 0 && name.length <= PLACE_NAME_MAX ? name : undefined;
}

/** Same rule as Platform names: case- and accent-insensitive. */
export const samePlaceName = samePlatformName;
