import { useLoaderData } from "@tanstack/react-router";
import { useEffect, useSyncExternalStore } from "react";
import type { SignInOptions } from "../components/SignIn";
import { getYou } from "../server/site.functions";

// Who's here. Every page is the same for everyone (Cloudflare stores it), so
// the browser finds out after the page appears.
//
// Most readers are signed out, and asking the site would tell them nothing:
// so the browser asks only when this cookie says it has signed in. It's set
// just before signing in (SignIn.tsx, the dev sign-in), renewed each time the
// site says who you are (so it lasts as long as the sign-in, which renews
// itself too), and removed only when the site says nobody's signed in (signed
// out, or the sign-in didn't finish): a request that fails tells nothing, so
// it keeps the cookie and the next page asks again. It holds no secret; the
// site still checks the real sign-in on every request.

const SIGNED_IN = "ht_signed_in";
/** As long as a sign-in lasts (auth.server.ts: 30 days, renewed daily). */
const SIGNED_IN_SECONDS = 30 * 24 * 3600;

/** Secure only over https: the local site (http://localhost) would otherwise drop the cookie in some browsers. */
const secure = () => (location.protocol === "https:" ? "; Secure" : "");

export type User = { name: string; image: string | null; author: { handle: string; name: string } | null };
export type You = { user: User | null; signIn: SignInOptions };

/** Just before signing in: from now on, this browser asks who's here. */
export function markSigningIn() {
	document.cookie = `${SIGNED_IN}=1; Path=/; Max-Age=${SIGNED_IN_SECONDS}; SameSite=Lax${secure()}`;
}

function markSignedOut() {
	document.cookie = `${SIGNED_IN}=; Path=/; Max-Age=0; SameSite=Lax${secure()}`;
}

/** Has this browser signed in? (No: don't ask the site for anything of yours.) */
export const hasSignedIn = () => new RegExp(`(?:^|; )${SIGNED_IN}=1(?:;|$)`).test(document.cookie);

/** undefined: not known yet; null: nobody. */
let user: User | null | undefined;
let asking: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: User | null) {
	user = next;
	for (const listen of listeners) listen();
}

/** The site's answer: renews the cookie when someone's signed in, removes it when nobody is. */
function answered(next: User | null) {
	if (next) markSigningIn();
	else markSignedOut();
	set(next);
}

/** Find out who's here (again): from the cookie alone when signed out, otherwise by asking the site. */
export function refreshYou(): Promise<void> {
	if (!hasSignedIn()) {
		set(null);
		return Promise.resolve();
	}
	return learnYou(getYou());
}

/**
 * Who's here, from an answer already on its way: a post page asks for what's
 * yours on it, and who you are comes with it (lib/post-view.ts), so the page
 * makes one request, not two.
 */
export function learnYou(answer: Promise<User | null>): Promise<void> {
	const current = answer
		.then(answered)
		// Shown as signed out for now, but the cookie stays: the next page asks again.
		.catch(() => set(null))
		.finally(() => {
			if (asking === current) asking = null;
		});
	asking = current;
	return current;
}

const subscribe = (listen: () => void) => {
	listeners.add(listen);
	return () => listeners.delete(listen);
};

/** You, or null until it's known (always null while the page is made on the server). */
export function useYou(): You | null {
	const signIn = useLoaderData({ from: "__root__" });
	const known = useSyncExternalStore(
		subscribe,
		() => user,
		() => undefined,
	);
	useEffect(() => {
		// After the page's other effects: a post page may already be asking (learnYou).
		queueMicrotask(() => {
			if (user === undefined && !asking) void refreshYou();
		});
	}, []);
	return known === undefined ? null : { user: known, signIn };
}
