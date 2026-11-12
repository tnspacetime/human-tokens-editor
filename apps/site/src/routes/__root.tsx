import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandMark } from "../components/BrandMark";
import { Island } from "../components/island/Island";
import { getViewer } from "../server/site.functions";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	loader: () => getViewer(),
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Human Tokens" },
			{ name: "description", content: "Writing by people. No AI wrote or rewrote any of it." },
			{ name: "color-scheme", content: "light dark" },
			{ name: "theme-color", media: "(prefers-color-scheme: light)", content: "#f5f5f7" },
			{ name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#000000" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
	component: Root,
	notFoundComponent: () => (
		<main className="page-narrow">
			<h1 className="empty-title">Nothing here</h1>
			<p>
				This page doesn't exist. <Link to="/">Back to the feed</Link>.
			</p>
		</main>
	),
});

function Root() {
	const viewer = Route.useLoaderData();
	return (
		<>
			<Island viewer={viewer} />
			<Outlet />
			<footer className="site-footer">
				<BrandMark />
				<p>Written by people, published with Fold MD.</p>
				<p className="site-footer-domain">human-tokens.dev</p>
			</footer>
		</>
	);
}

function RootDocument({ children }: { children: ReactNode }) {
	// The reader's chosen theme, rendered on the server: no flash on load.
	const theme = Route.useLoaderData()?.theme;
	return (
		<html lang="en" data-theme={theme && theme !== "system" ? theme : undefined}>
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}
