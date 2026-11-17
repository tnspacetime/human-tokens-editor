import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { auth, currentUser, requireUser } from "./auth.server";
import { db } from "./rows.server";

// The /connect page: you allow Fold MD on your Mac to publish as you, by
// the short code it shows. Better Auth does the work (auth.server.ts,
// deviceAuthorization); these read where a code stands and pass on your
// answer.

export type ConnectState =
	| { state: "enter" }
	| { state: "unknown"; code: string }
	| { state: "sign-in"; code: string }
	| { state: "other-account"; code: string }
	| Decision<"pending">
	| Decision<"approved">
	| Decision<"denied">;

type Decision<State extends string> = { state: State; code: string; name: string };

/** KQ4M7TXD, kq4m-7txd, "KQ4M 7TXD" → KQ4M7TXD. */
const normalize = (code: string) => code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
/** KQ4M7TXD → KQ4M-7TXD, as Fold MD shows it. */
const display = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

const readCode = (code: string) =>
	db()
		.prepare("SELECT user_id, status, expires_at FROM device_codes WHERE user_code = ?")
		.bind(code)
		.first<{ user_id: string | null; status: string; expires_at: string }>();

const codeInput = (input: unknown) => {
	const value = typeof input === "object" && input !== null ? (input as Record<string, unknown>).code : undefined;
	return typeof value === "string" && value.length <= 40 ? normalize(value) : "";
};

/**
 * Where a code stands for you. Signed in, looking at a code nobody has
 * looked at yet makes it yours to allow or not (only you can then).
 */
export const getConnect = createServerFn({ method: "GET" })
	.validator((input: unknown) => ({ code: codeInput(input) }))
	.handler(async ({ data }): Promise<ConnectState> => {
		const { code } = data;
		if (!code) return { state: "enter" };
		let row = /^[A-Z0-9]{8}$/.test(code) ? await readCode(code) : null;
		if (!row || new Date(row.expires_at) < new Date()) return { state: "unknown", code: display(code) };

		const user = await currentUser();
		if (!user) return { state: "sign-in", code: display(code) };
		if (!row.user_id && row.status === "pending") {
			await auth.api.deviceVerify({ query: { user_code: code }, headers: getRequest().headers });
			row = await readCode(code);
			if (!row) return { state: "unknown", code: display(code) };
		}
		if (row.user_id !== user.id) return { state: "other-account", code: display(code) };
		const status = row.status === "approved" || row.status === "denied" ? row.status : "pending";
		return { state: status, code: display(code), name: user.name };
	});

/** Allow Fold MD to publish as you, or don't. */
export const decideConnect = createServerFn({ method: "POST" })
	.validator((input: unknown) => ({
		code: codeInput(input),
		allow: typeof input === "object" && input !== null && (input as Record<string, unknown>).allow === true,
	}))
	.handler(async ({ data }) => {
		await requireUser("connect Fold MD");
		const request = { body: { userCode: data.code }, headers: getRequest().headers };
		try {
			if (data.allow) await auth.api.deviceApprove(request);
			else await auth.api.deviceDeny(request);
		} catch {
			throw new Error("This code has expired or was already used. Ask Fold MD for a new one.");
		}
		return { state: data.allow ? ("approved" as const) : ("denied" as const) };
	});
