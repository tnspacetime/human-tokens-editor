import type { ShapeBlock } from "@human-tokens/renderer";
import { type ReactElement, useId } from "react";

// A tile's cover when a piece has no picture: the piece drawn as its own
// page. Every paragraph is a short stack of bars as long as its lines,
// headings are amber, lists are dotted, quotes hang off a rule, code is a
// tinted block of indented lines, and an image is a small frame. Like the
// three bars of the Fold MD mark, grown into each piece's fingerprint.
// (Only for a piece with no opening words to show.)

const W = 320; // the drawing is 16:9, like every tile's cover
const H = 180;
const LEFT = 46;
const TOP = 32;
const WIDTH = W - LEFT * 2;
const HEIGHT = H - TOP * 2;
const WORDS_PER_LINE = 30;

type Row =
	| { kind: "text" | "list" | "quote"; lines: number[] }
	| { kind: "head"; width: number; level: number }
	| { kind: "code"; lines: number }
	| { kind: "img" }
	| { kind: "hr" };

// Each row's height and the space after it, in units of one bar's thickness.
function measure(row: Row): [height: number, after: number] {
	switch (row.kind) {
		case "text":
			return [row.lines.length + (row.lines.length - 1) * 0.55, 1.1];
		case "list":
		case "quote":
			return [row.lines.length + (row.lines.length - 1) * 0.55, 0.7];
		case "head":
			return [row.level <= 2 ? 1.55 : 1.3, 0.95];
		case "code":
			return [Math.min(row.lines, 7) * 0.95 + 1.1, 1.1];
		case "img":
			return [4.2, 1.1];
		case "hr":
			return [0.6, 1.1];
	}
}

// A paragraph's lines: full width, then what's left over.
function lines(words: number, perLine = WORDS_PER_LINE) {
	const count = Math.min(3, Math.max(1, Math.ceil(words / perLine)));
	const last = Math.max(0.18, (words - (count - 1) * perLine) / perLine);
	return Array.from({ length: count }, (_, i) => (i < count - 1 ? 1 : Math.min(1, last)));
}

const total = (sentences: number[]) => sentences.reduce((sum, n) => sum + n, 0);

function rowsOf(shape: ShapeBlock[]): Row[] {
	return shape.map((block): Row => {
		switch (block[0]) {
			case "h":
				return { kind: "head", level: block[1], width: Math.min(0.55, Math.max(0.16, block[2] / 9)) };
			case "p":
				return { kind: "text", lines: lines(total(block[1])) };
			case "li":
				return { kind: "list", lines: lines(total(block[1]), 24).map((w) => w * 0.82) };
			case "q":
				return { kind: "quote", lines: lines(total(block[1]), 26).map((w) => w * 0.86) };
			case "code":
				return { kind: "code", lines: Math.max(1, block[1]) };
			case "img":
				return { kind: "img" };
			case "hr":
				return { kind: "hr" };
		}
	});
}

// Steady, made-up line lengths for code, the same every time.
const CODE_WIDTHS = [0.62, 0.44, 0.7, 0.36, 0.55, 0.3, 0.66, 0.48];
const CODE_INDENTS = [0, 1, 1, 2, 1, 0, 1, 0];

export function ShapeCover({ shape }: { shape: ShapeBlock[] }) {
	const id = useId();
	const rows = rowsOf(shape);
	const units = rows.reduce((sum, row, i) => {
		const [height, after] = measure(row);
		return sum + height + (i < rows.length - 1 ? after : 0);
	}, 0);
	// One bar's thickness: as bold as fits, never so thin it turns to noise.
	// A long piece runs off the foot and fades out.
	const t = Math.max(2.6, Math.min(7, HEIGHT / Math.max(units, 1)));
	const overflows = units * t > HEIGHT + 0.5;
	const top = overflows ? TOP : TOP + (HEIGHT - units * t) / 2;

	const marks: ReactElement[] = [];
	let y = top;
	let n = 0;
	const bar = (x: number, yy: number, width: number, height: number, className: string, radius = height / 2) => {
		marks.push(
			<rect
				key={n}
				className={className}
				x={x}
				y={yy}
				width={Math.max(height, width)}
				height={height}
				rx={radius}
				style={{ ["--i" as string]: n }}
			/>,
		);
		n++;
	};

	for (const row of rows) {
		if (y > H) break;
		const [height, after] = measure(row);
		switch (row.kind) {
			case "text":
				row.lines.forEach((w, i) => bar(LEFT, y + i * t * 1.55, WIDTH * w, t, "shape-text"));
				break;
			case "list":
				row.lines.forEach((w, i) => {
					if (i === 0) bar(LEFT + t * 0.2, y, t, t, "shape-dot");
					bar(LEFT + t * 2.2, y + i * t * 1.55, (WIDTH - t * 2.2) * w, t, "shape-text");
				});
				break;
			case "quote":
				bar(LEFT, y - t * 0.15, t * 0.5, height * t + t * 0.3, "shape-rule");
				row.lines.forEach((w, i) => bar(LEFT + t * 2.2, y + i * t * 1.55, (WIDTH - t * 2.2) * w, t, "shape-text soft"));
				break;
			case "head":
				bar(LEFT, y, WIDTH * row.width, height * t, "shape-head");
				break;
			case "code": {
				const shown = Math.min(row.lines, 7);
				bar(LEFT - t * 0.2, y, WIDTH * 0.84, height * t, "shape-block", t * 1.1);
				for (let i = 0; i < shown; i++) {
					const indent = CODE_INDENTS[i % 8] * t * 1.6;
					bar(LEFT + t * 1.3 + indent, y + t * 0.75 + i * t * 0.95, WIDTH * 0.84 * CODE_WIDTHS[i % 8] - indent, t * 0.45, "shape-code");
				}
				break;
			}
			case "img":
				marks.push(
					<g key={`img${n}`} className="shape-image" style={{ ["--i" as string]: n }}>
						<rect x={LEFT} y={y} width={height * t * 1.5} height={height * t} rx={t * 0.9} />
						<circle cx={LEFT + height * t * 0.45} cy={y + height * t * 0.35} r={t * 0.45} />
						<path
							d={`M${LEFT + t * 0.6} ${y + height * t - t * 0.6} l${height * t * 0.42} ${-height * t * 0.42} l${height * t * 0.28} ${height * t * 0.28} l${height * t * 0.2} ${-height * t * 0.16} l${height * t * 0.42} ${height * t * 0.3}`}
						/>
					</g>,
				);
				n++;
				break;
			case "hr":
				for (let i = 0; i < 3; i++) bar(LEFT + i * t * 1.6, y, t * 0.6, t * 0.6, "shape-dot");
				break;
		}
		y += (height + after) * t;
	}

	return (
		<svg className="shape" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
			<defs>
				<linearGradient id={`${id}-head`} x1="0" x2="1" y1="0" y2="0">
					<stop offset="0" stopColor="var(--brand-from)" />
					<stop offset="1" stopColor="var(--brand-to)" />
				</linearGradient>
				{overflows && (
					<>
						<linearGradient id={`${id}-fade`} x1="0" x2="0" y1="0" y2="1">
							<stop offset="0.72" stopColor="white" />
							<stop offset="0.94" stopColor="white" stopOpacity="0" />
						</linearGradient>
						<mask id={`${id}-mask`}>
							<rect width={W} height={H} fill={`url(#${id}-fade)`} />
						</mask>
					</>
				)}
			</defs>
			<g
				className="marks"
				mask={overflows ? `url(#${id}-mask)` : undefined}
				style={{ ["--head" as string]: `url(#${id}-head)` }}
			>
				{marks}
			</g>
		</svg>
	);
}
