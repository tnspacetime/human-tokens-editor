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

/** A batch of one month's lines, newest first; `next` is where the next batch starts. */
export type ArchiveLines = { items: ArchiveItem[]; next: string | null };

/**
 * Every post, one month at a time: the All time board, the years and the
 * chosen year's months (1-12) with how many posts each has, and the chosen
 * month's first lines (the rest come as you scroll).
 */
export type Archive = ArchiveLines & {
	board: Ranking;
	years: { year: number; count: number }[];
	year: number;
	months: { month: number; count: number }[];
	/** The month shown (1-12), or null when nothing's published yet. */
	month: number | null;
	total: number;
	/** When the first post of all was published. */
	since: string | null;
};

/** A batch of an author's posts, newest first; `parts`: a series published whole, with this many chapters. */
export type AuthorPosts = { pieces: (FeedItem & { parts: number | null })[]; next: string | null };

/**
 * An author's page, the same for everyone (whether it's you is worked out in
 * the browser): who they are, what readers made of their writing, and their
 * first posts (the rest come as you scroll).
 */
export type AuthorPage = AuthorPosts & {
	author: { handle: string; name: string; image: string | null };
	/** How many posts they have, and when the first was published. */
	posts: number;
	since: string | null;
	words: number;
	/** Every reaction to their posts, by quality. */
	qualities: QualityCounts;
	comments: number;
};

/** One page of the feed; `next` asks for the page after it. */
export type FeedPage = { items: FeedItem[]; next: string | null };

export type Comment = {
	id: string;
	name: string;
	body: string;
	authorNote: string | null;
	createdAt: string;
};

/** A link to another piece, with who wrote it. */
export type PieceLink = { id: string; slug: string; title: string; author: { name: string; handle: string } };

/**
 * A piece as its own page shows it, the same for everyone (Cloudflare stores
 * it, for weeks). No counts: they'd be as old as the stored page. PostLive
 * brings them once the page is up.
 */
export type PostPage = Omit<FeedItem, "qualities" | "comments"> & {
	html: string;
	/** A whole series published as one piece: its chapters, for the contents (none for a single piece). */
	chapters: { id: string; title: string }[];
	/** Until when its author can still fix it; null once it's locked. */
	fixableUntil: string | null;
	/** The piece this one responds to: the author's own (`own`, a follow-up) or someone else's (a reply). */
	respondsTo: (PieceLink & { own: boolean }) | null;
	/** Later pieces of the author's that follow this one up, oldest first. */
	followUps: PieceLink[];
	/** Pieces by others that reply to this one, oldest first. */
	replies: (PieceLink & { publishedAt: string })[];
	/** The author's notes under the piece, oldest first (rendered markdown). */
	postscripts: { id: string; html: string; createdAt: string }[];
};

/** What readers made of a piece, as it is now: the same for everyone, stored 5 minutes. The first page of comments; `next` asks for more. */
export type PostLive = { qualities: QualityCounts; comments: number } & CommentPage;

/** Comments, oldest first, a page at a time; `next` asks for the page after (null at the end). */
export type CommentPage = { page: Comment[]; next: string | null };

/** What's yours on a piece (never kept): your name, whether you wrote it, your reactions and your comment. */
export type PostYou = { name: string; isAuthor: boolean; mine: Quality[]; myComment: Comment | null };

/** A post page as it shows: the kept page, with Live and You put in once they've come. */
export type PostView = PostPage & {
	/** False until Live has come; until then there are no counts to show. */
	live: boolean;
	qualities: QualityCounts;
	comments: number;
	/** Every page of comments loaded so far, yours among them; `moreComments` when there are more. */
	moreComments: boolean;
	/** The qualities you chose (none when signed out). */
	mine: Quality[];
	/** The comments loaded so far, yours marked (and `sending` until the site has it). */
	commentList: (Comment & { mine: boolean; sending?: boolean })[];
	/** You, or null when signed out (or not known yet); isAuthor when it's your piece. */
	viewer: { name: string; isAuthor: boolean } | null;
};

export type RankingEntry = {
	post: { id: string; slug: string; title: string; author: string };
	/** How many readers chose this quality for it in the period. */
	votes: number;
};

export type RankingPeriod = {
	id: "day" | "week" | "month" | "all";
	label: string;
	/** The top ten posts for each quality, most chosen first (the homepage shows three). */
	top: Record<Quality, RankingEntry[]>;
};

/** A board as last worked out: every period, which one to open on, and how often it's worked out. */
export type Ranking = { periods: RankingPeriod[]; initial: RankingPeriod["id"]; workedOutAt: string; cadence: "hourly" | "daily" };
