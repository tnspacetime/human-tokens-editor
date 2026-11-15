import { useLoaderData, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth-client";

export type SignInOptions = { google: boolean; github: boolean; dev: boolean };

// The ways in. Google and GitHub leave the page for the provider and come
// back to where you were. The dev sign-in shows only on localhost while
// developing, and says so.
export function SignInLinks({ options, className }: { options: SignInOptions; className?: string }) {
	const back = useLocation({ select: (l) => l.href });
	const [going, setGoing] = useState(false);
	const none = !options.google && !options.github && !options.dev;

	async function go(provider: "google" | "github") {
		setGoing(true);
		const { error } = await authClient.signIn.social({ provider, callbackURL: back, errorCallbackURL: "/auth/error" });
		if (error) setGoing(false);
	}

	return (
		<span className={className}>
			{options.google && (
				<button type="button" disabled={going} onClick={() => go("google")}>
					Google
				</button>
			)}
			{options.github && (
				<button type="button" disabled={going} onClick={() => go("github")}>
					GitHub
				</button>
			)}
			{options.dev && (
				<a
					href={`/auth/dev?return=${encodeURIComponent(back)}`}
					className="sign-in-dev"
					title="Development sign-in, only on localhost"
				>
					Dev
				</a>
			)}
			{none && <span className="sign-in-none">Sign-in isn't set up yet</span>}
		</span>
	);
}

/** In place of what a signed-out visitor can't do yet: the ways in. */
export function SignInPrompt({ action }: { action: string }) {
	const { signIn } = useLoaderData({ from: "__root__" });
	return (
		<div className="sign-in-prompt">
			<p>Sign in to {action}.</p>
			<SignInLinks options={signIn} className="sign-in-prompt-links" />
		</div>
	);
}
