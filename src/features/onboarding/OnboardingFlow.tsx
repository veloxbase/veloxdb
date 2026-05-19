import {
	ArrowLeftIcon,
	ArrowRightIcon,
	DatabaseIcon,
	GraphIcon,
	KeyboardIcon,
	PlugsConnectedIcon,
	RobotIcon,
	TerminalWindowIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { writeOnboardingCompleted } from "@/features/onboarding/constants";
import { cn } from "@/lib/utils";

type OnboardingStep = {
	id: string;
	kicker: string;
	title: string;
	body: string;
	icon: typeof DatabaseIcon;
	pills?: { label: string; accent?: boolean }[];
	highlights?: string[];
};

const STEPS: OnboardingStep[] = [
	{
		id: "welcome",
		kicker: "Fast · Secure · Local-first",
		title: "SQL databases, unleashed on your desktop",
		body: "Built for builders who live in SQL. VeloxDB keeps you in flow—snappy queries, crisp results, a workspace that feels premium. Your data stays between you and your database: private by design, secure by default, no extra cloud hop just to run a SELECT.",
		icon: DatabaseIcon,
	},
	{
		id: "engines",
		kicker: "PostgreSQL · MySQL · SQLite",
		title: "One app, three engines",
		body: "Connect to the database you already run. PostgreSQL is the safest default for production workloads. MySQL and MariaDB work alongside it. SQLite is there for local files, prototypes, and edge cases—same editor, same sidebar, same shortcuts.",
		icon: PlugsConnectedIcon,
		pills: [
			{ label: "PostgreSQL", accent: true },
			{ label: "MySQL / MariaDB", accent: true },
			{ label: "SQLite", accent: true },
		],
		highlights: [
			"Saved connection profiles with SSL and SSH tunnels",
			"Switch databases from the sidebar without reconnecting rituals",
			"Engine-aware SQL linting and result grids",
		],
	},
	{
		id: "query",
		kicker: "Query workspace",
		title: "A real editor for serious SQL",
		body: "Multi-tab Monaco editing, schema-aware autocomplete, streaming results for heavy reads, and EXPLAIN when milliseconds matter. Export to CSV or JSON, edit rows inline, and keep history per connection.",
		icon: TerminalWindowIcon,
		highlights: [
			"Cmd/Ctrl+Enter to run · multi-tab editing",
			"Virtualized grids for large result sets",
			"Query history with favorites",
		],
	},
	{
		id: "model",
		kicker: "Visual · Interactive",
		title: "See your schema as a diagram",
		body: "Toggle to Model for a live ER canvas—tables, columns, and relationships laid out clearly. Drag objects, inspect indexes and triggers, preview DDL before you apply, and export the diagram when you need to share context.",
		icon: GraphIcon,
		highlights: [
			"Auto-layout and snap-to-grid",
			"Relationship creation between columns",
			"DDL migration preview before apply",
		],
	},
	{
		id: "veloxy",
		kicker: "Ask Veloxy",
		title: "Your schema-aware SQL copilot",
		body: "Veloxy reads your connected database—tables, columns, and foreign keys—and helps you explore, explain, and generate SQL in plain language. Chat to understand relationships, then generate and run read queries with guardrails when you are ready.",
		icon: RobotIcon,
		pills: [{ label: "OpenRouter", accent: true }],
		highlights: [
			"Natural-language chat grounded in your live schema",
			"Generate SQL from a reply, with confirmation for writes",
			"Configure your model in Settings → Veloxy",
		],
	},
	{
		id: "shortcuts",
		kicker: "Productivity",
		title: "Shortcuts that keep you in the zone",
		body: "Keyboard-driven workflow: Cmd/Ctrl+P for the palette, Cmd/Ctrl+Shift+C for connections, Cmd/Ctrl+Enter to run. Less mouse mileage, fewer tab dances—stay locked in on what matters.",
		icon: KeyboardIcon,
	},
];

type OnboardingFlowProps = {
	onComplete: () => void;
};

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
	const [step, setStep] = useState(0);

	useEffect(() => {
		document.documentElement.classList.toggle(
			"dark",
			window.matchMedia("(prefers-color-scheme: dark)").matches,
		);
	}, []);

	const finish = () => {
		writeOnboardingCompleted(true);
		onComplete();
	};

	const current = STEPS[step];
	const isLast = step === STEPS.length - 1;
	const StepIcon = current.icon;

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10">
				<div className="flex w-full max-w-lg flex-col gap-8">
					<div className="flex flex-col items-center gap-4 text-center">
						<div className="flex size-14 items-center justify-center border border-border bg-muted/30 text-primary">
							<StepIcon className="size-8" weight="duotone" aria-hidden />
						</div>
						<div className="space-y-3">
							<p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
								{current.kicker}
							</p>
							<h1 className="text-xl font-semibold leading-snug tracking-tight text-balance">
								{current.title}
							</h1>
							<p className="text-sm leading-relaxed text-muted-foreground">
								{current.body}
							</p>
						</div>

						{current.pills?.length ? (
							<div className="flex flex-wrap justify-center gap-2 pt-1">
								{current.pills.map((pill) => (
									<span
										key={pill.label}
										className={cn(
											"rounded-md border px-2.5 py-1 text-[11px] font-medium",
											pill.accent
												? "border-primary/35 bg-primary/10 text-primary"
												: "border-border bg-muted/30 text-muted-foreground",
										)}
									>
										{pill.label}
									</span>
								))}
							</div>
						) : null}

						{current.highlights?.length ? (
							<ul className="w-full max-w-md space-y-2 border-t border-border/70 pt-4 text-left text-[12px] leading-relaxed text-muted-foreground">
								{current.highlights.map((highlight) => (
									<li key={highlight} className="flex gap-2">
										<span
											className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/70"
											aria-hidden
										/>
										<span>{highlight}</span>
									</li>
								))}
							</ul>
						) : null}
					</div>

					<div
						className="flex justify-center gap-2"
						role="tablist"
						aria-label="Onboarding progress"
					>
						{STEPS.map((stepDef, index) => (
							<span
								key={stepDef.id}
								className={cn(
									"h-1.5 w-6 transition-colors sm:w-8",
									index === step ? "bg-primary" : "bg-muted-foreground/25",
								)}
								aria-current={index === step ? "step" : undefined}
							/>
						))}
					</div>

					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
						<Button type="button" variant="ghost" size="sm" onClick={finish}>
							Skip
						</Button>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={step === 0}
								onClick={() => setStep((s) => Math.max(0, s - 1))}
							>
								<ArrowLeftIcon aria-hidden />
								Back
							</Button>
							{isLast ? (
								<Button type="button" size="sm" onClick={finish}>
									Get started
								</Button>
							) : (
								<Button
									type="button"
									size="sm"
									onClick={() => setStep((s) => s + 1)}
								>
									Next
									<ArrowRightIcon aria-hidden />
								</Button>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
