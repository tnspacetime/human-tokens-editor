import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { authClient } from "../lib/auth-client";
import { getDevSignIn } from "../server/site.functions";

// DEVELOPMENT ONLY: stands in for Google and GitHub on localhost until real
// keys are in .dev.vars. Not found anywhere else (getDevSignIn), and the
// endpoint behind it isn't in a production build.
export const Route = createFileRoute("/auth/dev")({
	validateSearch: (search: Record<string, unknown>) => ({
		return: typeof search.return === "string" ? search.return : undefined,
	}),
	loader: () => getDevSignIn(),
	head: () => ({ meta: [{ title: "Dev sign-in · Human Tokens" }, { name: "robots", content: "noindex" }] }),
	component: DevSignIn,
});

function DevSignIn() {
	const { authors } = Route.useLoaderData();
	const { return: back } = Route.useSearch();
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function signIn(as: string, event?: FormEvent) {
		event?.preventDefault();
		setBusy(true);
		setError(null);
		const result = await authClient.$fetch("/dev/sign-in", { method: "POST", body: { as, name } });
		if (result.error) {
			setError(result.error.message ?? "That didn't work.");
			setBusy(false);
			return;
		}
		// A full load, so every part of the page sees you signed in.
		window.location.assign(back?.startsWith("/") && !back.startsWith("//") ? back : "/");
	}

	return (
		<main className="page-narrow auth-page">
			<p className="auth-dev-badge">Development only · localhost</p>
			<h1 className="empty-title">Dev sign-in</h1>
			<p className="auth-lede">
				A stand-in for Google and GitHub while they have no keys. It makes a real user and session here, and exists
				only in <code>bun run dev</code> on this machine.
			</p>

			<form className="auth-dev-reader" onSubmit={(e) => signIn("reader", e)}>
				<h2>As a reader</h2>
				<p>The same name signs you back in as the same reader.</p>
				<div className="auth-dev-row">
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Dev Reader"
						maxLength={60}
						aria-label="Your name"
					/>
					<button type="submit" className="primary" disabled={busy}>
						Sign in
					</button>
				</div>
			</form>

			<section className="auth-dev-authors">
				<h2>As an author</h2>
				<p>Links that author to you, so you get the author's tools on their pieces.</p>
				<div className="auth-dev-row">
					{authors.map((author) => (
						<button
							key={author.handle}
							type="button"
							className="auth-dev-author"
							disabled={busy}
							onClick={() => signIn(`author:${author.handle}`)}
						>
							{author.name}
						</button>
					))}
				</div>
			</section>

			{error && (
				<p className="auth-error" role="alert">
					{error}
				</p>
			)}
			<p className="auth-back">
				<Link to="/">Back to reading</Link>
			</p>
		</main>
	);
}
