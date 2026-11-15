import { createFileRoute, Link } from "@tanstack/react-router";

// Where Better Auth sends you when signing in with Google or GitHub went
// wrong (it adds ?error=<code>).
export const Route = createFileRoute("/auth/error")({
	validateSearch: (search: Record<string, unknown>) => ({
		error: typeof search.error === "string" ? search.error.slice(0, 80) : undefined,
	}),
	head: () => ({ meta: [{ title: "Sign-in didn't work · Human Tokens" }, { name: "robots", content: "noindex" }] }),
	component: SignInError,
});

function SignInError() {
	const { error } = Route.useSearch();
	return (
		<main className="page-narrow auth-page">
			<h1 className="empty-title">Sign-in didn't work</h1>
			<p className="auth-lede">
				Nothing changed: you're still signed out. Try again from your account at the top of the page.
			</p>
			{error && <p className="auth-code">Reason: {error.replaceAll("_", " ")}</p>}
			<p className="auth-back">
				<Link to="/">Back to reading</Link>
			</p>
		</main>
	);
}
