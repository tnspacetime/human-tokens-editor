import { shorten } from "./trails";
import type { Trail, TrailPost, Trails } from "./types";

// Made-up trails, to see the board's look on the local site only: the
// homepage shows them for ?trails=full, few, quiet or none (routes/index.tsx).
// The posts don't exist: their links lead nowhere.

let n = 0;
const post = (title: string, author: string): TrailPost => ({
	id: `fake${(++n).toString().padStart(4, "0")}`,
	slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
	title,
	author,
});
const trail = (votes: number, ...path: TrailPost[]): Trail => {
	const { shown, more } = shorten(path);
	return { votes, posts: shown, more };
};

const grading = post("Why we should stop grading essays", "Maren Holt");
const notGrading = post("Grades aren’t the problem. Deadlines are.", "Tobias Reyes");
const keepGrading = post("What I’d keep from grading, after ten years of teaching", "Maren Holt");
const cities = post("Small cities are better places to think", "Ines Varga");
const bigCities = post("I moved to a small city and stopped writing", "Daniel Osei");
const fourier = post("Why the Fourier transform keeps showing up", "Lena Brandt");
const fourierWrong = post("The Fourier transform isn’t a change of basis, and that matters", "Kofi Mensah");
const fourierBoth = post("You’re both right: a note on infinite dimensions", "Ruth Calder");
const typing = post("I write everything by hand first", "Sam Whitlow");
const typingNo = post("Handwriting is a ritual, not a method", "Priya Nair");
const typingYes = post("A ritual is a method", "Sam Whitlow");
const typingData = post("I tried both for a month and kept a log", "Owen Fraser");
const typingLast = post("What Owen’s log actually shows", "Priya Nair");
const reading = post("Read fewer books, twice", "Hana Sato");
const readingReply = post("Twice is not enough for the books that matter", "Marco Bellini");
const tests = post("Tests are a design tool, not a safety net", "Aisha Karim");
const testsReply = post("Then why do my best designs have no tests?", "Jonas Weller");
const sleep = post("The case against the morning routine", "Clara Moreau");
const sleepReply = post("My morning routine is the only time no one asks me for anything", "Felix Andersen");
const sleepFollow = post("Felix is right, and here is what I got wrong", "Clara Moreau");

// A long one: ten posts, three writers answering each other.
const remote = [
	post("Remote work made me a worse writer", "Nadia Petrov"),
	post("It made me a better one: no meetings, only documents", "Elliot Park"),
	post("Documents aren’t writing. They’re minutes.", "Nadia Petrov"),
	post("Minutes are writing, if you write them well", "Elliot Park"),
	post("Then show me good minutes", "Nadia Petrov"),
	post("Here are mine, from last Tuesday", "Elliot Park"),
	post("These are good. That’s the problem.", "Nadia Petrov"),
	post("A third view: you’re both describing editing", "Yusuf Demir"),
	post("Editing is where the writing happens", "Elliot Park"),
	post("Then we agree: the office was never the point", "Nadia Petrov"),
];

const FULL: Trails = {
	week: [
		trail(203, ...remote),
		trail(184, grading, notGrading, keepGrading),
		trail(131, fourier, fourierWrong),
		trail(97, typing, typingNo, typingYes, typingData, typingLast),
		trail(62, cities, bigCities),
		trail(40, sleep, sleepReply, sleepFollow),
	],
	month: [
		trail(612, fourier, fourierWrong, fourierBoth),
		trail(540, grading, notGrading, keepGrading),
		trail(388, reading, readingReply),
		trail(301, typing, typingNo, typingYes, typingData, typingLast),
		trail(214, tests, testsReply),
	],
	all: [
		trail(2410, reading, readingReply),
		trail(1985, fourier, fourierWrong, fourierBoth),
		trail(1702, tests, testsReply),
		trail(1290, grading, notGrading, keepGrading),
		trail(866, cities, bigCities),
	],
};

/** By the homepage's ?trails=: plenty; a couple; none this week; none at all. */
export const FAKE_CASES: Record<string, Trails> = {
	full: FULL,
	few: {
		week: [trail(23, grading, notGrading)],
		month: [trail(71, grading, notGrading), trail(18, cities, bigCities)],
		all: [trail(71, grading, notGrading), trail(18, cities, bigCities)],
	},
	quiet: {
		week: [],
		month: [trail(48, fourier, fourierWrong), trail(12, reading, readingReply)],
		all: [trail(48, fourier, fourierWrong), trail(12, reading, readingReply)],
	},
	none: { week: [], month: [], all: [] },
};
