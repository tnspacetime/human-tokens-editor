import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";

// Prototype stand-in for accounts: each browser is an anonymous reader with
// a random id in a cookie. "View as author" lets you try the author's tools
// on any post. Both go away when sign-in (Google, GitHub) arrives.
const READER_COOKIE = "ht_reader";
const AUTHOR_MODE_COOKIE = "ht_as_author";
const YEAR = 60 * 60 * 24 * 365;

export type Reader = { id: string; name: string; asAuthor: boolean };

// A first visit runs several loaders at once, all before the browser has the
// cookie; they must agree on one new reader rather than each making one.
const newThisRequest = new WeakMap<Request, string>();

export function currentReader(): Reader {
	let id = getCookie(READER_COOKIE);
	if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
		id = newThisRequest.get(getRequest()) ?? startNewReader();
	}
	return { id, name: readerName(id), asAuthor: getCookie(AUTHOR_MODE_COOKIE) === "1" };
}

export function startNewReader(): string {
	const id = crypto.randomUUID();
	newThisRequest.set(getRequest(), id);
	setCookie(READER_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: YEAR });
	return id;
}

export function setAuthorMode(on: boolean) {
	setCookie(AUTHOR_MODE_COOKIE, on ? "1" : "0", { httpOnly: true, sameSite: "lax", path: "/", maxAge: YEAR });
}

function readerName(id: string) {
	return `Reader ${id.slice(0, 4).toUpperCase()}`;
}
