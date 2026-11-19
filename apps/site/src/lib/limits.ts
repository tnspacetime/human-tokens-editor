// What a reader or Fold MD hears when they've done something too many times
// in a minute (src/server/limits.server.ts). A person never gets near the
// limits; a script does.
export const TOO_FAST = "That's a lot in one minute. Wait a moment, then try again.";

/** The message to show for a failed save: the site's own, when it's the limit. */
export function failure(error: unknown, otherwise: string): string {
	return error instanceof Error && error.message === TOO_FAST ? TOO_FAST : otherwise;
}
