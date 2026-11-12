import { useId } from "react";

// The three bars from the Fold MD icon, in amber. Used in the island, at the
// end of every piece, and in the footer; each copy gets its own gradient id.
export function BrandMark({ className }: { className?: string }) {
	const id = useId();
	return (
		<svg className={className ? `brand-mark ${className}` : "brand-mark"} viewBox="0 0 22 18" aria-hidden="true">
			<defs>
				<linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
					<stop offset="0" stopColor="var(--brand-from)" />
					<stop offset="1" stopColor="var(--brand-to)" />
				</linearGradient>
			</defs>
			<g fill={`url(#${id})`}>
				<rect x="0" y="0" width="22" height="4" rx="2" />
				<rect x="0" y="7" width="16" height="4" rx="2" />
				<rect x="0" y="14" width="10" height="4" rx="2" />
			</g>
		</svg>
	);
}
