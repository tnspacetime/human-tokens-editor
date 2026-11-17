import { env } from "cloudflare:workers";
import { getRequest } from "@tanstack/react-start/server";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { devSignIn, devSignInAllowed } from "./dev-sign-in.server";
import { db } from "./rows.server";

// Who's here, through Better Auth. Signed out, you can read everything;
// signed in (Google, GitHub, or on localhost the dev sign-in) you can say
// how a piece read and comment, and if you write as an author, you get the
// author's tools on your own pieces.
//
// Better Auth serves /api/auth/* (routes/api.auth.$.ts): the OAuth
// redirects and callbacks, sessions, sign-out. Its tables are in
// migrations/0004_accounts.sql, under our names.
//
// Fold MD connects with a short code (device authorization, RFC 8628): it
// asks for a code, you allow it at /connect while signed in, and it gets a
// session token that it sends as `Authorization: Bearer …` to the
// publishing API (routes/api.fold.*). Device codes are in
// migrations/0005_publishing.sql.

/** The one client allowed to ask for a code. */
export const FOLD_MD_CLIENT = "fold-md";

const DAY = 60 * 60 * 24;

const google =
	env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
		? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
		: undefined;
const github =
	env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
		? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
		: undefined;

export const auth = betterAuth({
	appName: "Human Tokens",
	baseURL: env.BETTER_AUTH_URL,
	secret: env.BETTER_AUTH_SECRET,
	database: env.DB,
	socialProviders: { ...(google && { google }), ...(github && { github }) },
	user: {
		modelName: "users",
		fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
	},
	session: {
		modelName: "sessions",
		fields: {
			userId: "user_id",
			expiresAt: "expires_at",
			ipAddress: "ip_address",
			userAgent: "user_agent",
			createdAt: "created_at",
			updatedAt: "updated_at",
		},
		expiresIn: 30 * DAY,
		updateAge: DAY,
	},
	account: {
		modelName: "accounts",
		fields: {
			userId: "user_id",
			accountId: "account_id",
			providerId: "provider_id",
			accessToken: "access_token",
			refreshToken: "refresh_token",
			idToken: "id_token",
			accessTokenExpiresAt: "access_token_expires_at",
			refreshTokenExpiresAt: "refresh_token_expires_at",
			createdAt: "created_at",
			updatedAt: "updated_at",
		},
		// Signing in with the other provider under the same verified email
		// finds the same person.
		accountLinking: { enabled: true, trustedProviders: ["google", "github"] },
		encryptOAuthTokens: true,
	},
	verification: {
		modelName: "verifications",
		fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
	},
	advanced: { cookiePrefix: "ht" },
	// The dev sign-in isn't in a production build at all; tanstackStartCookies
	// must come last.
	plugins: [
		...(import.meta.env.DEV ? [devSignIn()] : []),
		deviceAuthorization({
			verificationUri: "/connect",
			expiresIn: "10m",
			interval: "2s",
			validateClient: (clientId) => clientId === FOLD_MD_CLIENT,
			schema: {
				deviceCode: {
					modelName: "device_codes",
					fields: {
						deviceCode: "device_code",
						userCode: "user_code",
						userId: "user_id",
						expiresAt: "expires_at",
						lastPolledAt: "last_polled_at",
						pollingInterval: "polling_interval",
						clientId: "client_id",
					},
				},
			},
		}),
		bearer(),
		tanstackStartCookies(),
	],
});

export type User = {
	id: string;
	name: string;
	image: string | null;
	/** The author this user writes as, if any. */
	author: { id: string; handle: string; name: string } | null;
};

// Several loaders run for one page; they share one lookup.
const usersThisRequest = new WeakMap<Request, Promise<User | null>>();

/** The signed-in user, or null. */
export function currentUser(): Promise<User | null> {
	const request = getRequest();
	let user = usersThisRequest.get(request);
	if (!user) {
		user = lookUp(request.headers);
		usersThisRequest.set(request, user);
	}
	return user;
}

async function lookUp(headers: Headers): Promise<User | null> {
	const session = await auth.api.getSession({ headers });
	if (!session) return null;
	const author = await db()
		.prepare("SELECT id, handle, name FROM authors WHERE user_id = ?")
		.bind(session.user.id)
		.first<{ id: string; handle: string; name: string }>();
	return { id: session.user.id, name: session.user.name, image: session.user.image ?? null, author };
}

/** The signed-in user, or an error for a signed-out visitor. */
export async function requireUser(action: string): Promise<User> {
	const user = await currentUser();
	if (!user) throw new Error(`Sign in to ${action}`);
	return user;
}

/** Which ways in this site offers right now. */
export function signInOptions(request: Request) {
	return { google: Boolean(google), github: Boolean(github), dev: devSignInAllowed(request) };
}
