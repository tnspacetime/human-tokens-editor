import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../../lib/auth-client";
import { SignInLinks, type SignInOptions } from "../SignIn";
import { Slot } from "./Slot";

export type Viewer = {
	user: { name: string; image: string | null; author: { handle: string; name: string } | null } | null;
	signIn: SignInOptions;
};

// You. Signed out, the panel offers the ways in (Google, GitHub); signed
// in, it shows who you are (an author's name opens their page) and lets
// you sign out.
export function Account({ viewer, open, onToggle }: { viewer: Viewer; open: boolean; onToggle: () => void }) {
	const router = useRouter();
	const [leaving, setLeaving] = useState(false);
	const { user } = viewer;

	async function signOut() {
		setLeaving(true);
		try {
			await authClient.signOut();
			onToggle();
			await router.invalidate();
		} finally {
			setLeaving(false);
		}
	}

	return (
		<>
			<button
				type="button"
				className="island-glyph island-you"
				data-signed-in={user ? "" : undefined}
				aria-expanded={open}
				aria-controls="island-account"
				aria-label={user ? `You: ${user.name}` : "Sign in"}
				onClick={onToggle}
			>
				{user?.image ? (
					<img src={user.image} alt="" referrerPolicy="no-referrer" />
				) : user ? (
					<span className="island-initial" aria-hidden="true">
						{initial(user.name)}
					</span>
				) : (
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<circle cx="8" cy="5.6" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.25" />
						<path d="M2.9 13.6a5.2 5.2 0 0 1 10.2 0" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
					</svg>
				)}
			</button>
			<Slot open={open}>
				<div id="island-account" className="island-choices">
					{user ? (
						<>
							{/* An author's name opens their page. */}
							{user.author ? (
								<Link to="/@{$handle}" params={{ handle: user.author.handle }} className="island-who" onClick={onToggle}>
									{user.name}
								</Link>
							) : (
								<span className="island-who">{user.name}</span>
							)}
							<button type="button" onClick={signOut} disabled={leaving}>
								Sign out
							</button>
						</>
					) : (
						<>
							<span className="island-who">Sign in with</span>
							<SignInLinks options={viewer.signIn} className="island-sign-in" />
						</>
					)}
				</div>
			</Slot>
		</>
	);
}

function initial(name: string) {
	return [...name.trim()][0]?.toUpperCase() ?? "?";
}
