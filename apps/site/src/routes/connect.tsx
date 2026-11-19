import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { SignInPrompt } from "../components/SignIn";
import { authClient } from "../lib/auth-client";
import { type ConnectState, decideConnect, getConnect } from "../server/connect.functions";

// Where Fold MD sends you to connect it to your account: it shows a short
// code, opens this page with the code filled in, and waits. You sign in
// (with Google or GitHub, on their own pages) if you aren't, check the code
// matches, and allow it. Fold MD notices within seconds.
export const Route = createFileRoute("/connect")({
	validateSearch: (search: Record<string, unknown>) => ({
		user_code: typeof search.user_code === "string" ? search.user_code.slice(0, 40) : undefined,
	}),
	loaderDeps: ({ search }) => ({ code: search.user_code }),
	loader: ({ deps }) => getConnect({ data: { code: deps.code } }),
	head: () => ({ meta: [{ title: "Connect Fold MD · Human Tokens" }, { name: "robots", content: "noindex" }] }),
	component: ConnectPage,
});

function ConnectPage() {
	const loaded = Route.useLoaderData();
	const [decided, setDecided] = useState<ConnectState | null>(null);
	// A new code (another visit) starts over.
	const state = decided && "code" in decided && "code" in loaded && decided.code === loaded.code ? decided : loaded;

	return (
		<main className="page-narrow auth-page connect-page">
			<img className="connect-icon" src="/fold-md.png" width={72} height={72} alt="" />
			<Body state={state} onDecided={setDecided} />
			<p className="auth-back">
				<Link to="/">Back to reading</Link>
			</p>
		</main>
	);
}

function Body({ state, onDecided }: { state: ConnectState; onDecided: (state: ConnectState) => void }) {
	switch (state.state) {
		case "enter":
			return <EnterCode />;
		case "unknown":
			return (
				<>
					<h1 className="empty-title">This code doesn't work</h1>
					<p className="auth-lede">
						<Code code={state.code} /> has expired, was already used, or was mistyped. In Fold MD, click Publish
						again for a new code.
					</p>
					<EnterCode again />
				</>
			);
		case "sign-in":
			return (
				<>
					<h1 className="empty-title">Connect Fold MD</h1>
					<p className="auth-lede">Fold MD on your Mac is asking to publish as you. Sign in first, then you can allow it.</p>
					<Code code={state.code} large />
					<SignInPrompt action="continue" />
				</>
			);
		case "other-account":
			return (
				<>
					<h1 className="empty-title">Signed in as someone else</h1>
					<p className="auth-lede">
						<Code code={state.code} /> was opened by another account. Sign out from your account at the top of the
						page, sign in as yourself, and open the link from Fold MD again.
					</p>
				</>
			);
		case "pending":
			return <Decide state={state} onDecided={onDecided} />;
		case "approved":
			return (
				<>
					<h1 className="empty-title">Fold MD is connected</h1>
					<p className="auth-lede">
						Go back to Fold MD: it will notice in a moment, and you can publish from it as {state.name}. You can
						close this tab.
					</p>
				</>
			);
		case "denied":
			return (
				<>
					<h1 className="empty-title">Not connected</h1>
					<p className="auth-lede">Fold MD can't publish as you. To connect it after all, click Publish in Fold MD again.</p>
				</>
			);
	}
}

function Decide({
	state,
	onDecided,
}: {
	state: Extract<ConnectState, { state: "pending" }>;
	onDecided: (state: ConnectState) => void;
}) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function decide(allow: boolean) {
		setBusy(true);
		setError(null);
		try {
			const result = await decideConnect({ data: { code: state.code, allow } });
			onDecided({ ...state, state: result.state });
		} catch (e) {
			setError(e instanceof Error ? e.message : "That didn't work. Try again.");
		} finally {
			setBusy(false);
		}
	}

	async function signOut() {
		setBusy(true);
		await authClient.signOut();
		await router.invalidate();
		setBusy(false);
	}

	return (
		<>
			<h1 className="empty-title">Let Fold MD publish as you?</h1>
			<p className="auth-lede">
				Check that this is the code Fold MD shows. Once you allow it, Fold MD on your Mac can publish, update and
				unpublish your posts as {state.name}.
			</p>
			<Code code={state.code} large />
			<div className="connect-actions">
				<button type="button" className="primary" disabled={busy} onClick={() => decide(true)}>
					Allow
				</button>
				<button type="button" className="connect-deny" disabled={busy} onClick={() => decide(false)}>
					Don't allow
				</button>
			</div>
			{error && (
				<p className="auth-error" role="alert">
					{error}
				</p>
			)}
			<p className="connect-who">
				Signed in as {state.name}.{" "}
				<button type="button" className="link-button" disabled={busy} onClick={signOut}>
					Not you?
				</button>
			</p>
		</>
	);
}

function EnterCode({ again }: { again?: boolean }) {
	const navigate = useNavigate();
	const [code, setCode] = useState("");

	function submit(event: FormEvent) {
		event.preventDefault();
		if (code.trim()) navigate({ to: "/connect", search: { user_code: code.trim() } });
	}

	return (
		<>
			{!again && (
				<>
					<h1 className="empty-title">Connect Fold MD</h1>
					<p className="auth-lede">
						In Fold MD, click Publish. It shows a code like KQ4M-7TXD and opens this page with it filled in; you
						can also type it here.
					</p>
				</>
			)}
			<form className="connect-enter" onSubmit={submit}>
				<input
					value={code}
					onChange={(e) => setCode(e.target.value)}
					placeholder="XXXX-XXXX"
					maxLength={12}
					autoCapitalize="characters"
					autoComplete="off"
					spellCheck={false}
					aria-label="The code from Fold MD"
				/>
				<button type="submit" className="primary">
					Continue
				</button>
			</form>
		</>
	);
}

function Code({ code, large }: { code: string; large?: boolean }) {
	return <code className={large ? "connect-code connect-code-large" : "connect-code"}>{code}</code>;
}
