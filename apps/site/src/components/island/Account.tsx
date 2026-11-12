import { useRouter } from "@tanstack/react-router";
import { newReaderFn, setAuthorModeFn } from "../../server/site.functions";
import { Slot } from "./Slot";

export type Viewer = { name: string; asAuthor: boolean };

// You. For now an anonymous reader (a prototype stand-in) with New reader
// and Author view; sign-in with Google or GitHub replaces this.
export function Account({ viewer, open, onToggle }: { viewer: Viewer; open: boolean; onToggle: () => void }) {
	const router = useRouter();
	async function run(action: () => Promise<unknown>) {
		await action();
		await router.invalidate();
	}

	return (
		<>
			<button
				type="button"
				className="island-glyph island-you"
				data-author={viewer.asAuthor || undefined}
				aria-expanded={open}
				aria-controls="island-account"
				aria-label={`You: ${viewer.name}${viewer.asAuthor ? ", viewing as author" : ""}`}
				onClick={onToggle}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<circle cx="8" cy="5.6" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.25" />
					<path d="M2.9 13.6a5.2 5.2 0 0 1 10.2 0" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
				</svg>
			</button>
			<Slot open={open}>
				<div id="island-account" className="island-choices">
					<span className="island-who">{viewer.name}</span>
					<button type="button" onClick={() => run(() => newReaderFn())}>
						New reader
					</button>
					<button
						type="button"
						aria-pressed={viewer.asAuthor}
						onClick={() => run(() => setAuthorModeFn({ data: { on: !viewer.asAuthor } }))}
					>
						Author view
					</button>
				</div>
			</Slot>
		</>
	);
}
