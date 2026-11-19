import { createRouter } from "@tanstack/react-router";
import { getGlobalStartContext } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	// On the server, the page's nonce (src/start.ts) goes on every script the
	// router writes; in the browser the router reads it back from the page.
	const nonce = (getGlobalStartContext() as { nonce?: string } | undefined)?.nonce;
	return createRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		ssr: nonce ? { nonce } : undefined,
	});
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
