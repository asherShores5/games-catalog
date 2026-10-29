// Pure validation rules, kept free of AWS calls.
import { GAME_NAME_MAX, cleanGameName } from "@games/shared";

/** An error the caller caused. The client sees "<type>: <message>"; anything else is InternalError. */
export class UserError extends Error {
  constructor(public type: "ValidationError" | "NotFound", message: string) {
    super(message);
  }
}

export function validateGameName(raw: unknown): string {
  const name = cleanGameName(raw);
  if (name === undefined) throw new UserError("ValidationError", `Game name must be 1-${GAME_NAME_MAX} characters`);
  return name;
}
