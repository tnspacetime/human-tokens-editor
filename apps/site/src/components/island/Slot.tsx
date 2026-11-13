import type { ReactNode } from "react";

// A piece of the island that unfolds to its natural width, or folds away.
export function Slot({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
	return (
		<span className={className ? `island-slot ${className}` : "island-slot"} data-open={open || undefined} inert={!open}>
			<span className="island-slot-inner">{children}</span>
		</span>
	);
}
