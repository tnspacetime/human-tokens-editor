import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { describeQualities, QUALITIES, type Quality } from "../lib/qualities";
import type { PostPage } from "../lib/types";
import { toggleQualityFn } from "../server/site.functions";
import { QualityIcon } from "./QualityIcon";
import { SignInPrompt } from "./SignIn";

// Inside the qualities sheet: the five ways a piece can read, as tiles to
// pick (any that fit), each with how many readers chose it. Signed out, you
// see the counts and are asked to sign in to pick.
export function QualityChoices({ post }: { post: PostPage }) {
	const router = useRouter();
	// Your choices as you've just made them, shown at once; the page's own
	// catch up once the site has them.
	const [choosing, setChoosing] = useState<Partial<Record<Quality, boolean>>>({});
	const [error, setError] = useState<string | null>(null);
	const summary = describeQualities(post.qualities);

	async function toggle(quality: Quality) {
		if (choosing[quality] !== undefined) return;
		const chosen = !post.mine.includes(quality);
		setChoosing((now) => ({ ...now, [quality]: chosen }));
		setError(null);
		try {
			await toggleQualityFn({ data: { id: post.id, quality } });
			await router.invalidate();
		} catch {
			setError("That didn't save. Try again.");
		} finally {
			setChoosing(({ [quality]: _, ...rest }) => rest);
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
					const saved = post.mine.includes(q.id);
					const chosen = choosing[q.id] ?? saved;
					const count = (post.qualities[q.id] ?? 0) + (chosen === saved ? 0 : chosen ? 1 : -1);
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
