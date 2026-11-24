import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

export type LatticeStatus = "working" | "done" | "error";
export type LatticePatternName =
	| "arrow"
	| "dots"
	| "orbit"
	| "ripple"
	| "snake"
	| "spiral"
	| "sweep"
	| "spin"
	| "rain"
	| "pulse";
export type LatticeGrid = 3 | 4;

export type LatticePattern = {
	cells: Array<number | null>;
	loop?: number;
	scale?: number;
	lit?: 0.25 | 0.35 | 0.45 | 0.62;
};

export type LatticeLoaderProps = {
	label?: string;
	doneLabel?: string;
	errorLabel?: string;
	status?: LatticeStatus;
	pattern?: LatticePatternName | LatticePattern;
	grid?: LatticeGrid;
	shape?: "square" | "round";
	color?: string;
	doneColor?: string;
	errorColor?: string;
	cellSize?: number;
	gap?: number;
	fontSize?: number;
	step?: number;
	idleOpacity?: number;
	showTimer?: boolean;
	elapsed?: number;
	className?: string;
	style?: CSSProperties;
};

type ResolvedPattern = { cells: Array<number | null>; loop: number; scale: number; lit?: number };

const PATTERNS: Record<LatticePatternName, Partial<Record<LatticeGrid, ResolvedPattern>>> = {
	arrow: { 3: { cells: [1, 2, 3, 0, 1, 2, 1, 2, 3], loop: 7.2, scale: 1 } },
	dots: { 3: { cells: [0, 1, 2, 0, 1, 2, 0, 1, 2], loop: 3, scale: 2.4 } },
	ripple: { 3: { cells: [2, 1, 2, 1, 0, 1, 2, 1, 2], loop: 4.8, scale: 1.5 } },
	spiral: { 3: { cells: [0, 1, 2, 7, 8, 3, 6, 5, 4], loop: 9, scale: 1.2, lit: 0.35 } },
	orbit: {
		3: { cells: [0, 1, 2, 7, null, 3, 6, 5, 4], loop: 8, scale: 1.2 },
		4: { cells: [0, 1, 2, 3, 11, null, null, 4, 10, null, null, 5, 9, 8, 7, 6], loop: 6, scale: 1.2, lit: 0.45 },
	},
	snake: {
		3: { cells: [0, 1, 2, 5, 4, 3, 6, 7, 8], loop: 9, scale: 1, lit: 0.35 },
		4: { cells: [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12], loop: 16, scale: 1, lit: 0.25 },
	},
	sweep: { 4: { cells: [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6], loop: 5, scale: 1, lit: 0.45 } },
	spin: { 4: { cells: [0, 0, 1, 1, 0, 0, 1, 1, 3, 3, 2, 2, 3, 3, 2, 2], loop: 4, scale: 1.6, lit: 0.35 } },
	rain: { 4: { cells: [0, 2, 1, 3, 1, 3, 2, 4, 2, 4, 3, 5, 3, 5, 4, 6], loop: 4, scale: 1.2, lit: 0.35 } },
	pulse: { 4: { cells: [2, 1, 1, 2, 1, 0, 0, 1, 1, 0, 0, 1, 2, 1, 1, 2], loop: 2.4, scale: 2.5, lit: 0.45 } },
};

const DEFAULT_PATTERN: Record<LatticeGrid, LatticePatternName> = { 3: "orbit", 4: "sweep" };
const MARKS: Record<LatticeGrid, Record<"done" | "error", number[]>> = {
	3: { done: [2, 3, 5, 7], error: [0, 2, 4, 6, 8] },
	4: { done: [7, 8, 10, 13], error: [0, 3, 5, 6, 9, 10, 12, 15] },
};

const LIT: Record<number, string> = {
	62: "motion-safe:animate-[lattice-on_var(--ll-cycle)_infinite]",
	45: "motion-safe:animate-[lattice-on-45_var(--ll-cycle)_infinite]",
	35: "motion-safe:animate-[lattice-on-35_var(--ll-cycle)_infinite]",
	25: "motion-safe:animate-[lattice-on-25_var(--ll-cycle)_infinite]",
};

const CELL =
	"h-[var(--ll-cell)] w-[var(--ll-cell)] [border-radius:max(1px,calc(var(--ll-cell)*0.25))] [background:var(--ll-color)] group-data-[shape=round]:rounded-full";

function resolvePattern(pattern: LatticePatternName | LatticePattern, grid: LatticeGrid): ResolvedPattern {
	if (typeof pattern === "string") {
		const named = PATTERNS[pattern];
		return (named && named[grid]) || (PATTERNS[DEFAULT_PATTERN[grid]][grid] as ResolvedPattern);
	}
	const cells = Array.from({ length: grid * grid }, (_, i) => pattern.cells[i] ?? null);
	const max = Math.max(0, ...cells.filter((value): value is number => value != null));
	return { cells, loop: pattern.loop ?? max + 4.2, scale: pattern.scale ?? 1, lit: pattern.lit ?? 0.62 };
}

function formatDeciseconds(ds: number) {
	return ds < 600
		? `${(ds / 10).toFixed(1)}s`
		: `${Math.floor(ds / 600)}m ${((ds % 600) / 10).toFixed(1)}s`;
}

function spokenDeciseconds(ds: number) {
	return ds < 600
		? `${(ds / 10).toFixed(1)} seconds`
		: `${Math.floor(ds / 600)} minutes ${((ds % 600) / 10).toFixed(1)} seconds`;
}

export function LatticeLoader({
	label = "Thinking",
	doneLabel = "Done in",
	errorLabel = "Failed after",
	status = "working",
	pattern = "orbit",
	grid = 3,
	shape = "round",
	color = "currentColor",
	doneColor = "#22c55e",
	errorColor = "#ef4444",
	cellSize = 6,
	gap = 2,
	fontSize = 14,
	step = 90,
	idleOpacity = 0.15,
	showTimer = true,
	elapsed,
	className,
	style,
}: LatticeLoaderProps) {
	const n: LatticeGrid = grid === 4 ? 4 : 3;
	const pat = resolvePattern(pattern, n);
	const marks = MARKS[n];
	const delayStep = step * pat.scale;
	const cycle = Math.round(pat.loop * delayStep);
	const timerRef = useRef<HTMLSpanElement>(null);
	const dsRef = useRef(0);
	const markRef = useRef<"done" | "error">("done");
	const mark = status === "working" ? markRef.current : status;
	markRef.current = mark;
	const [announce, setAnnounce] = useState(`${label}, in progress`);

	const paint = (ds: number) => {
		dsRef.current = ds;
		if (timerRef.current) timerRef.current.textContent = formatDeciseconds(ds);
	};

	useLayoutEffect(() => {
		if (elapsed != null) {
			paint(Math.round(elapsed * 10));
			return undefined;
		}
		if (status !== "working") return undefined;
		const startedAt = performance.now();
		paint(0);
		const id = window.setInterval(() => paint(Math.floor((performance.now() - startedAt) / 100)), 100);
		return () => window.clearInterval(id);
	}, [elapsed, status]);

	useEffect(() => {
		if (status === "working") {
			setAnnounce(`${label}, in progress`);
			return;
		}
		setAnnounce(
			`${status === "done" ? doneLabel : errorLabel}${showTimer ? ` ${spokenDeciseconds(dsRef.current)}` : ""}`,
		);
	}, [doneLabel, errorLabel, label, showTimer, status]);

	return (
		<span
			role="status"
			data-status={status}
			data-shape={shape}
			className={cn(
				"ll-root group relative inline-flex items-center leading-none [font-family:inherit] [gap:calc(var(--ll-font)*0.625)] [font-size:var(--ll-font)]",
				className,
			)}
			style={
				{
					"--ll-n": n,
					"--ll-cell": `${cellSize}px`,
					"--ll-gap": `${gap}px`,
					"--ll-font": `${fontSize}px`,
					"--ll-color": color,
					"--ll-mark": status === "error" ? errorColor : doneColor,
					"--ll-idle": idleOpacity,
					"--ll-cycle": `${cycle}ms`,
					"--ll-peak": 1,
					"--ll-ease-out": "var(--motion-ease)",
					...style,
				} as CSSProperties
			}
		>
			<span className="grid shrink-0" aria-hidden>
				<span className="ll-run [grid-area:1/1] grid [grid-template-columns:repeat(var(--ll-n),var(--ll-cell))] [gap:var(--ll-gap)] motion-safe:transition-opacity motion-safe:duration-200 group-data-[status=done]:opacity-0 group-data-[status=error]:opacity-0 group-data-[status=done]:[&>span]:[animation-play-state:paused] group-data-[status=error]:[&>span]:[animation-play-state:paused]">
					{pat.cells.map((unit, i) => (
						<span
							key={i}
							className={
								unit == null
									? `${CELL} [opacity:calc(var(--ll-idle)*0.47)]`
									: cn(
											CELL,
											"[opacity:var(--ll-idle)]",
											LIT[Math.round((pat.lit ?? 0.62) * 100)] ?? LIT[62],
										)
							}
							style={unit == null ? undefined : { animationDelay: `${Math.round(unit * delayStep)}ms` }}
						/>
					))}
				</span>
				<span className="ll-mark [grid-area:1/1] grid origin-center [grid-template-columns:repeat(var(--ll-n),var(--ll-cell))] [gap:var(--ll-gap)] opacity-0 motion-safe:scale-90 motion-safe:transition-[opacity,transform] motion-safe:duration-160 motion-safe:ease-[var(--motion-ease)] group-data-[status=done]:opacity-100 group-data-[status=done]:scale-100 group-data-[status=error]:opacity-100 group-data-[status=error]:scale-100">
					{pat.cells.map((_, i) => (
						<span
							key={i}
							className={cn(
								CELL,
								"[opacity:var(--ll-idle)] motion-safe:transition-opacity motion-safe:duration-200 data-[on]:[background:var(--ll-mark)] data-[on]:[opacity:var(--ll-peak)]",
							)}
							data-on={marks[mark].includes(i) ? "" : undefined}
						/>
					))}
				</span>
			</span>
			<span className="relative inline-block font-medium" aria-hidden>
				<span
					className="ll-text absolute top-0 left-0 whitespace-nowrap opacity-0 motion-safe:transition-opacity motion-safe:duration-200 data-[active]:static data-[active]:opacity-100"
					data-active={status === "working" ? "" : undefined}
				>
					{label}
				</span>
				<span
					className="ll-text absolute top-0 left-0 whitespace-nowrap opacity-0 motion-safe:transition-opacity motion-safe:duration-200 data-[active]:static data-[active]:opacity-100"
					data-active={status === "done" ? "" : undefined}
				>
					{doneLabel}
				</span>
				<span
					className="ll-text absolute top-0 left-0 whitespace-nowrap opacity-0 motion-safe:transition-opacity motion-safe:duration-200 data-[active]:static data-[active]:opacity-100"
					data-active={status === "error" ? "" : undefined}
				>
					{errorLabel}
				</span>
			</span>
			{showTimer ? (
				<span
					ref={timerRef}
					className="font-mono tabular-nums opacity-60 [font-size:calc(var(--ll-font)*0.875)]"
					aria-hidden
				>
					0.0s
				</span>
			) : null}
			<span className="sr-only">{announce}</span>
		</span>
	);
}
