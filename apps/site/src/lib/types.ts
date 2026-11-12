import type { ShapeBlock } from "@human-tokens/renderer";
import type { Quality, QualityCounts } from "./qualities";

// The shapes of data the server sends to the pages. Components import these
// (never the server modules), so the UI doesn't care where data comes from.

/** A piece as the feed shows it. */
export type FeedItem = {
	id: string;
	slug: string;
	title: string;
	excerpt: string | null;
	author: { name: string; handle: string };
	publishedAt: string;
	minutes: number;
	qualities: QualityCounts;
	comments: number;
	/** The piece's shape, drawn as its tile's cover (worked out at publish). */
	shape: ShapeBlock[];
	/** Its first paragraphs, revealed on the cover (worked out at publish). */
	opening: string[];
};

/** One page of the feed; `next` asks for the page after it. */
export type FeedPage = { items: FeedItem[]; next: string | null };

export type Comment = {
	id: string;
	name: string;
	body: string;
	authorNote: string | null;
	createdAt: string;
	mine: boolean;
};

/** A piece as its own page shows it. */
export type PostPage = FeedItem & {
	html: string;
	allowDebate: boolean;
	/** The qualities this reader chose. */
	mine: Quality[];
	commentList: Comment[];
	viewer: { name: string; isAuthor: boolean };
};

export type BoardEntry = {
	post: { id: string; slug: string; title: string; author: string };
	votes: number;
};

export type BoardWindow = {
	id: "1h" | "12h" | "24h" | "7d";
	label: string;
	pieces: number;
	reactions: number;
	readers: number;
	/** The top three pieces for each quality, most chosen first. */
	top: Record<Quality, BoardEntry[]>;
};

/** The live board: every time window, and which one to open on. */
export type Board = { windows: BoardWindow[]; initial: BoardWindow["id"] };
