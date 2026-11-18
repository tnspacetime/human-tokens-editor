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

/** A piece as the archive lists it: a line, no cover. */
export type ArchiveItem = Pick<FeedItem, "id" | "slug" | "title" | "publishedAt" | "minutes" | "qualities" | "comments"> & {
	author: string;
};

/** Every piece, one year at a time, in months (1-12), newest first. */
export type Archive = {
	years: { year: number; count: number }[];
	year: number;
	total: number;
	/** When the first piece of all was published. */
	since: string | null;
	months: { month: number; items: ArchiveItem[] }[];
};

/** An author's page: who they are, what readers made of their writing, and every piece of theirs, newest first. */
export type AuthorPage = {
	author: { handle: string; name: string; image: string | null };
	/** `parts`: a series published whole, with this many chapters. */
	pieces: (FeedItem & { parts: number | null })[];
	/** When their first piece was published. */
	since: string | null;
	words: number;
	/** Every reaction to their pieces, by quality. */
	qualities: QualityCounts;
	comments: number;
	/** How many different people reacted to their pieces. */
	readers: number;
	/** The viewer is this author. */
	isYou: boolean;
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

/** A link to another piece, with who wrote it. */
export type PieceLink = { id: string; slug: string; title: string; author: { name: string; handle: string } };

/** A piece as its own page shows it. */
export type PostPage = FeedItem & {
	html: string;
	allowDebate: boolean;
	/** The qualities the viewer chose (none when signed out). */
	mine: Quality[];
	/** A whole series published as one piece: its chapters, for the contents (none for a single piece). */
	chapters: { id: string; title: string }[];
	/** The piece this one responds to: the author's own (`own`, a follow-up) or someone else's (a reply). */
	respondsTo: (PieceLink & { own: boolean }) | null;
	/** Later pieces of the author's that follow this one up, oldest first. */
	followUps: PieceLink[];
	/** Pieces by others that reply to this one, oldest first. */
	replies: (PieceLink & { publishedAt: string })[];
	/** The author's notes under the piece, oldest first (rendered markdown). */
	postscripts: { id: string; html: string; createdAt: string }[];
	commentList: Comment[];
	/** Who's reading, or null when signed out; isAuthor when it's their piece. */
	viewer: { name: string; isAuthor: boolean } | null;
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
	/** The top ten pieces for each quality, most chosen first (the feed shows three). */
	top: Record<Quality, BoardEntry[]>;
};

/** The live board: every time window, and which one to open on. */
export type Board = { windows: BoardWindow[]; initial: BoardWindow["id"] };
