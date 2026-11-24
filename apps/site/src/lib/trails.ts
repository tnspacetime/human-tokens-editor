// Trails (server/ranking.server.ts works them out; components/Trails.tsx
// shows them): the replies readers chose most, each with the posts it
// answers, back to the opening post.

/** How many trails each period shows. */
export const TRAIL_COUNT = 5;

/** Up to this many posts, a trail is shown whole. */
const SHOWN_WHOLE = 4;

/**
 * A long trail keeps its opening post and its last two (the reply, and the
 * post it answers), with how many are left out between them. Only those are
 * stored and shown, however long the conversation.
 */
export function shorten<T>(path: T[]): { shown: T[]; more: number } {
	if (path.length <= SHOWN_WHOLE) return { shown: path, more: 0 };
	return { shown: [path[0], ...path.slice(-2)], more: path.length - 3 };
}
