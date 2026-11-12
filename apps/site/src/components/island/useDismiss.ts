import { type RefObject, useEffect } from "react";

/** While `active`, a click outside `inside` or Escape calls `dismiss`. */
export function useDismiss(active: boolean, inside: RefObject<HTMLElement | null>, dismiss: () => void) {
	useEffect(() => {
		if (!active) return;
		const away = (event: PointerEvent) => {
			if (!inside.current?.contains(event.target as Node)) dismiss();
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key === "Escape") dismiss();
		};
		document.addEventListener("pointerdown", away);
		document.addEventListener("keydown", escape);
		return () => {
			document.removeEventListener("pointerdown", away);
			document.removeEventListener("keydown", escape);
		};
	}, [active, inside, dismiss]);
}
