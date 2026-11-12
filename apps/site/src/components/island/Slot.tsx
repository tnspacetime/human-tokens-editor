import type { ReactNode } from "react";

// A piece of the island that unfolds to its natural width, or folds away.
export function Slot({ open, children }: { open: boolean; children: ReactNode }) {
	return (
		<span className="island-slot" data-open={open || undefined} inert={!open}>
			<span className="island-slot-inner">{children}</span>
		</span>
	);
}
