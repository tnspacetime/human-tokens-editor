import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { describeQualities, QUALITIES, type Quality } from "../lib/qualities";
import type { PostPage } from "../lib/types";
import { toggleQualityFn } from "../server/site.functions";
import { QualityIcon } from "./QualityIcon";

// Inside the qualities sheet: the four ways a piece can read, as tiles to
// pick (any that fit), each with how many readers chose it.
export function QualityChoices({ post }: { post: PostPage }) {
	const router = useRouter();
	const [busy, setBusy] = useState<Quality | null>(null);
	const summary = describeQualities(post.qualities);

	async function toggle(quality: Quality) {
		setBusy(quality);
		try {
			await toggleQualityFn({ data: { id: post.id, quality } });
			await router.invalidate();
		} finally {
			setBusy(null);
		}
	}

	return (
		<>
			<p className="sheet-lede">
				{summary ? `Readers found this ${summary}.` : "No one has said yet."} Pick any that fit.
			</p>
			<div className="quality-buttons">
				{QUALITIES.map((q) => {
					const chosen = post.mine.includes(q.id);
					const count = post.qualities[q.id] ?? 0;
					return (
						<button
							key={q.id}
							type="button"
							className="quality"
							aria-pressed={chosen}
							disabled={busy !== null}
							onClick={() => toggle(q.id)}
						>
							<span className="quality-label">
								<QualityIcon name={q.id} />
								{q.label}
								{count > 0 && <span className="quality-count">{count}</span>}
							</span>
							<span className="quality-hint">{q.hint}</span>
						</button>
					);
				})}
			</div>
		</>
	);
}
