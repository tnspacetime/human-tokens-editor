import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandMark } from "../components/BrandMark";
import { Island } from "../components/island/Island";
import { SHARED_META, SITE } from "../lib/share";
import { getViewer } from "../server/site.functions";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	loader: () => getViewer(),
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: SITE.name },
			{ name: "description", content: SITE.description },
			{ name: "color-scheme", content: "light dark" },
			...SHARED_META,
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/favicon.ico", sizes: "32x32" },
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
			{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
			{ rel: "manifest", href: "/site.webmanifest" },
		],
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
				<Link to="/archive" className="site-footer-link">
					Every piece
				</Link>
				<Link to="/rules" className="site-footer-link">
					The rules
				</Link>
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
				{/* Here, not in head(): the router keeps one meta tag per name, and there are two. */}
				<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f5f7" />
				<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000" />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}
