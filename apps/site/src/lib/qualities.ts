// The ways a reader can say how a post read to them, instead of a like.
export const QUALITIES = [
	{ id: "novel", label: "Novel", hint: "An idea I hadn't met before" },
	{ id: "fresh", label: "Fresh", hint: "A familiar subject, seen anew" },
	{ id: "clear", label: "Clear", hint: "Easy to follow all the way" },
	{ id: "sharp", label: "Sharp", hint: "Well reasoned, it holds up" },
	{ id: "moving", label: "Moving", hint: "It stayed with me" },
] as const;

export type Quality = (typeof QUALITIES)[number]["id"];
export type QualityCounts = Partial<Record<Quality, number>>;

export const isQuality = (value: unknown): value is Quality =>
	typeof value === "string" && QUALITIES.some((q) => q.id === value);

/** "novel and clear", strongest first; qualities only one reader chose are left out once others are stronger. */
export function describeQualities(counts: QualityCounts): string | null {
	const ranked = QUALITIES.map((q) => ({ label: q.label.toLowerCase(), count: counts[q.id] ?? 0 }))
		.filter((q) => q.count > 0)
		.sort((a, b) => b.count - a.count);
	if (ranked.length === 0) return null;
	const top = ranked[0].count;
	const shown = ranked.filter((q) => q.count >= Math.max(1, top / 3)).map((q) => q.label);
	return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}
