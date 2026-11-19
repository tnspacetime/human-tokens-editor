import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { disconnectFold, type FoldConnection, getFoldConnections } from "../../server/connections.functions";
import { formatDate } from "../PostCard";
import { Sheet } from "../Sheet";

// In the account panel, once Fold MD is connected anywhere: "Fold MD",
// opening a sheet with each Mac it's connected on and Disconnect for each.
// Disconnected, that Mac can't publish as you until you allow it again.
// The sheet goes on the page itself, not inside the island's panel (which
// folds away, and keeps its text on one line).
export function FoldConnections({ open }: { open: boolean }) {
	const [connections, setConnections] = useState<FoldConnection[] | null>(null);
	const [showing, setShowing] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Asked each time the panel opens, so it's never out of date.
	useEffect(() => {
		if (!open) return;
		let current = true;
		getFoldConnections()
			.then((found) => current && setConnections(found))
			.catch(() => current && setConnections([]));
		return () => {
			current = false;
		};
	}, [open]);

	async function disconnect(id: string) {
		setBusy(id);
		setError(null);
		try {
			await disconnectFold({ data: { id } });
			setConnections((now) => now?.filter((c) => c.id !== id) ?? null);
		} catch {
			setError("Couldn't disconnect it. Try again.");
		} finally {
			setBusy(null);
		}
	}

	if (!connections?.length && !showing) return null;
	return (
		<>
			<button type="button" onClick={() => setShowing(true)}>
				Fold MD
			</button>
			{createPortal(
				<Sheet
					open={showing}
					onClose={() => setShowing(false)}
					title="Where Fold MD is connected"
					footer={
						<div className="comment-form-actions">
							{error && <span className="delete-error">{error}</span>}
							<button type="button" className="primary" onClick={() => setShowing(false)}>
								Done
							</button>
						</div>
					}
				>
					<p className="sheet-lede">
						Fold MD publishes as you on these Macs. Disconnect one you don't use any more, or one you've lost: it
						can't publish until you allow it again.
					</p>
					{connections?.length ? (
						<ul className="connections">
							{connections.map((c) => (
								<li key={c.id}>
									<span className="connection-mac">{c.mac ?? "A Mac"}</span>
									<span className="connection-dates">
										Connected {formatDate(c.since)} · last used {formatDate(c.lastUsed)}
									</span>
									<button type="button" className="link-button" onClick={() => disconnect(c.id)} disabled={busy !== null}>
										{busy === c.id ? "Disconnecting…" : "Disconnect"}
									</button>
								</li>
							))}
						</ul>
					) : (
						<p className="comments-empty">Fold MD isn't connected anywhere now.</p>
					)}
				</Sheet>,
				document.body,
			)}
		</>
	);
}
