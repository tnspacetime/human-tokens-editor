import { useState } from "react";
import { failure } from "../lib/limits";
import { describeQualities, QUALITIES, type Quality } from "../lib/qualities";
import { toggleReaction } from "../lib/post-view";
import type { PostView } from "../lib/types";
import { QualityIcon } from "./QualityIcon";
import { SignInPrompt } from "./SignIn";

// Inside the qualities sheet: the five ways a piece can read, as tiles to
// pick (any that fit), each with how many readers chose it. Signed out, you
// see the counts and are asked to sign in to pick.
export function QualityChoices({ post }: { post: PostView }) {
	// Your choices show at once, here and in the island (lib/post-view.ts),
	// and go back if the site says no.
	const [error, setError] = useState<string | null>(null);
	const summary = describeQualities(post.qualities);

	async function toggle(quality: Quality) {
		setError(null);
		try {
			await toggleReaction(post.id, quality);
		} catch (problem) {
			setError(failure(problem, "That didn't save. Try again."));
		}
	}

	return (
		<>
			<p className="sheet-lede">
				{summary ? `Readers found this ${summary}.` : "No one has said yet."}
				{post.viewer && " Pick any that fit."}
			</p>
			{!post.viewer && <SignInPrompt action="say how it read to you" />}
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
							disabled={!post.viewer}
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
			{error && (
				<p className="form-error" role="alert">
					{error}
				</p>
			)}
		</>
	);
}
