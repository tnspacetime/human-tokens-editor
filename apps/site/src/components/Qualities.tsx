import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { describeQualities, QUALITIES, type Quality } from "../lib/qualities";
import type { PostPage } from "../lib/types";
import { toggleQualityFn } from "../server/site.functions";
import { QualityIcon } from "./QualityIcon";

export function Qualities({ post }: { post: PostPage }) {
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
		<section className="qualities" aria-labelledby="qualities-title">
			<h2 id="qualities-title" className="section-title">
				How did this read to you?
			</h2>
			<div className="quality-buttons">
				{QUALITIES.map((q) => {
					const chosen = post.mine.includes(q.id);
					return (
						<button
							key={q.id}
							type="button"
							className="quality"
							aria-pressed={chosen}
							disabled={busy !== null}
							onClick={() => toggle(q.id)}
							title={q.hint}
						>
							<span className="quality-label">
								<QualityIcon name={q.id} />
								{q.label}
							</span>
							<span className="quality-hint">{q.hint}</span>
						</button>
					);
				})}
			</div>
			<p className="quality-summary">
				{summary ? `Readers found this ${summary}.` : "No one has said yet. Pick any that fit."}
			</p>
		</section>
	);
}
