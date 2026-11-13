import { type ReactNode, useEffect, useId, useRef } from "react";

// A sheet over the page, on the native <dialog> (focus stays inside, Esc
// closes it, the page behind can't be reached). On a computer it rises as a
// card in the middle of the window; on a phone it comes up from the bottom
// edge. Clicking the dimmed page around it closes it too.
export function Sheet({
	open,
	onClose,
	title,
	children,
	footer,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	footer?: ReactNode;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();

	useEffect(() => {
		const element = dialog.current;
		if (!element) return;
		if (open && !element.open) element.showModal();
		else if (!open && element.open) element.close();
	}, [open]);

	return (
		<dialog
			ref={dialog}
			className="sheet"
			aria-labelledby={titleId}
			onClose={onClose}
			// The dialog itself is only hit outside its content: on the dimmed page.
			onClick={(event) => {
				if (event.target === dialog.current) onClose();
			}}
		>
			<div className="sheet-inner">
				<span className="sheet-grabber" aria-hidden="true" />
				<header className="sheet-head">
					<h2 id={titleId}>{title}</h2>
					<button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M4 4l8 8M12 4l-8 8" />
						</svg>
					</button>
				</header>
				<div className="sheet-body">{children}</div>
				{footer && <div className="sheet-foot">{footer}</div>}
			</div>
		</dialog>
	);
}
