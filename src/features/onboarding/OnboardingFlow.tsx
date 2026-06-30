import {
	ArrowLeftIcon,
	ArrowRightIcon,
	DatabaseIcon,
	GraphIcon,
	LightningIcon,
	PlugsConnectedIcon,
	RobotIcon,
	ShieldIcon,
	SparkleIcon,
	TerminalWindowIcon,
} from "@phosphor-icons/react";
import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { writeOnboardingCompleted } from "@/features/onboarding/constants";
import { DatabaseSphere } from "@/features/onboarding/DatabaseSphere";
import { cn } from "@/lib/utils";

type OnboardingStep = {
	id: string;
	kicker: string;
	title: string;
	body: string;
	icon: typeof DatabaseIcon;
	accentColor: string;
	highlights?: string[];
};

type OnboardingFlowProps = {
	onComplete: () => void;
};

function ParticleBackground() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let animId: number;
		const particles: { x: number; y: number; vx: number; vy: number; r: number }[] = [];
		const count = 40;

		const resize = () => {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
		};
		resize();
		window.addEventListener("resize", resize);

		for (let i = 0; i < count; i++) {
			particles.push({
				x: Math.random() * canvas.width,
				y: Math.random() * canvas.height,
				vx: (Math.random() - 0.5) * 0.3,
				vy: (Math.random() - 0.5) * 0.3,
				r: Math.random() * 1.5 + 0.5,
			});
		}

		const draw = () => {
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
			ctx.fillStyle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";

			for (const p of particles) {
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
				ctx.fill();

				p.x += p.vx;
				p.y += p.vy;
				if (p.x < 0) p.x = canvas.width;
				if (p.x > canvas.width) p.x = 0;
				if (p.y < 0) p.y = canvas.height;
				if (p.y > canvas.height) p.y = 0;

				// Draw connections
				for (const q of particles) {
					const dx = p.x - q.x;
					const dy = p.y - q.y;
					const dist = Math.sqrt(dx * dx + dy * dy);
					if (dist < 120) {
						ctx.beginPath();
						ctx.moveTo(p.x, p.y);
						ctx.lineTo(q.x, q.y);
						ctx.strokeStyle = isDark
							? `rgba(255,255,255,${0.02 * (1 - dist / 120)})`
							: `rgba(0,0,0,${0.03 * (1 - dist / 120)})`;
						ctx.stroke();
					}
				}
			}
			animId = requestAnimationFrame(draw);
		};
		draw();

		return () => {
			cancelAnimationFrame(animId);
			window.removeEventListener("resize", resize);
		};
	}, []);

	return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" aria-hidden />;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
	const { t } = useTranslation();
	const [step, setStep] = useState(0);
	const [animateOut, setAnimateOut] = useState(false);

	useEffect(() => {
		document.documentElement.classList.toggle(
			"dark",
			window.matchMedia("(prefers-color-scheme: dark)").matches,
		);
	}, []);

	const goNext = () => {
		setAnimateOut(true);
		setTimeout(() => {
			setStep((s) => s + 1);
			setAnimateOut(false);
		}, 200);
	};

	const goPrev = () => {
		setAnimateOut(true);
		setTimeout(() => {
			setStep((s) => Math.max(0, s - 1));
			setAnimateOut(false);
		}, 200);
	};

	const STEPS: OnboardingStep[] = [
		{
			id: "welcome",
			kicker: t("onboarding.welcomeKicker"),
			title: t("onboarding.welcomeTitle"),
			body: t("onboarding.welcomeBody"),
			icon: DatabaseIcon,
			accentColor: "#10b981",
		},
		{
			id: "query",
			kicker: t("onboarding.queryKicker"),
			title: t("onboarding.queryTitle"),
			body: t("onboarding.queryBody"),
			icon: TerminalWindowIcon,
			accentColor: "#3b82f6",
			highlights: [
				t("onboarding.queryHighlight1"),
				t("onboarding.queryHighlight2"),
				t("onboarding.queryHighlight3"),
			],
		},
		{
			id: "engines",
			kicker: "6 Database Engines",
			title: "One tool, every database",
			body: "PostgreSQL, MySQL, SQLite, MongoDB, DuckDB, Redis — plus every wire-compatible engine like Supabase, CockroachDB, MariaDB, and PlanetScale. Connect to what you already use.",
			icon: PlugsConnectedIcon,
			accentColor: "#8b5cf6",
		},
		{
			id: "model",
			kicker: t("onboarding.modelKicker"),
			title: t("onboarding.modelTitle"),
			body: t("onboarding.modelBody"),
			icon: GraphIcon,
			accentColor: "#f59e0b",
			highlights: [
				t("onboarding.modelHighlight1"),
				t("onboarding.modelHighlight2"),
				t("onboarding.modelHighlight3"),
			],
		},
		{
			id: "veloxy",
			kicker: t("onboarding.veloxyKicker"),
			title: t("onboarding.veloxyTitle"),
			body: t("onboarding.veloxyBody"),
			icon: RobotIcon,
			accentColor: "#ec4899",
			highlights: [
				t("onboarding.veloxyHighlight1"),
				t("onboarding.veloxyHighlight2"),
				t("onboarding.veloxyHighlight3"),
			],
		},
		{
			id: "privacy",
			kicker: "Local-first · Zero telemetry",
			title: "Your data never leaves your machine",
			body: "No cloud middleware. No analytics. No sign-up. VeloxDB connects directly from your desktop to your database. Credentials stay in your OS keychain. Queries run on your hardware. Privacy isn't a feature — it's the foundation.",
			icon: ShieldIcon,
			accentColor: "#14b8a6",
		},
		{
			id: "ready",
			kicker: "You're all set",
			title: "Let's build something",
			body: "Connect a database, write a query, and experience what it feels like to have a SQL client that stays out of your way. Cmd+Shift+C to connect. Cmd+P to open the palette. Cmd+Enter to run.",
			icon: SparkleIcon,
			accentColor: "#10b981",
		},
	];

	const finish = () => {
		writeOnboardingCompleted(true);
		onComplete();
	};

	const current = STEPS[step];
	const isLast = step === STEPS.length - 1;
	const StepIcon = current.icon;

	return (
		<div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
			<ParticleBackground />

			{/* Gradient accent */}
			<div
				className="pointer-events-none fixed inset-0 z-[1] opacity-[0.03]"
				style={{
					background: `radial-gradient(600px at 50% 40%, ${current.accentColor}, transparent)`,
				}}
				aria-hidden
			/>

			{/* Top bar */}
			<div className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-border/40 px-6">
				<div className="flex items-center gap-2">
					<div className="flex size-6 items-center justify-center rounded bg-primary/10">
						<DatabaseIcon className="size-3.5 text-primary" weight="fill" />
					</div>
					<span className="text-xs font-semibold tracking-wide text-foreground">VeloxDB</span>
				</div>
				<div className="flex items-center gap-1">
					{STEPS.map((s, i) => (
						<div
							key={s.id}
							className={cn(
								"h-1 rounded-full transition-all duration-500",
								i <= step ? "opacity-100" : "opacity-20",
							)}
							style={{
								width: i <= step ? "24px" : "8px",
								backgroundColor: i <= step ? current.accentColor : "currentColor",
							}}
						/>
					))}
				</div>
			</div>

			{/* Main content */}
			<div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-6">
				<div
					className={cn(
						"flex w-full max-w-2xl flex-col items-center gap-10 transition-all duration-200",
						animateOut ? "translate-y-4 opacity-0" : "translate-y-0 opacity-100",
					)}
				>
					{/* Icon or DatabaseSphere */}
					{current.id === "engines" ? (
						<DatabaseSphere />
					) : (
						<div
						className="flex size-20 items-center justify-center rounded-2xl shadow-2xl transition-colors duration-500"
						style={{
							background: `color-mix(in srgb, ${current.accentColor} 12%, transparent)`,
							borderColor: `color-mix(in srgb, ${current.accentColor} 30%, transparent)`,
							borderWidth: 1,
						}}
					>
						<StepIcon
							className="size-10 transition-colors duration-500"
							weight="duotone"
							style={{ color: current.accentColor }}
							aria-hidden
						/>
					</div>
					)}

					{/* Text */}
					<div className="flex flex-col items-center gap-5 text-center">
						<p
							className="text-xs font-semibold uppercase tracking-[0.25em] transition-colors duration-500"
							style={{ color: current.accentColor }}
						>
							{current.kicker}
						</p>
						<h1 className="max-w-lg text-3xl font-bold leading-tight tracking-tight text-balance">
							{current.title}
						</h1>
						<p className="max-w-lg text-[15px] leading-relaxed text-muted-foreground text-balance">
							{current.body}
						</p>
					</div>

					{/* Highlights */}
					{current.highlights?.length ? (
						<div className="grid w-full max-w-md gap-2">
							{current.highlights.map((h, i) => (
								<div
									key={h}
									className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/20 px-4 py-3 text-left text-sm text-foreground/80"
								>
									<div
										className="flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold"
										style={{
											background: `color-mix(in srgb, ${current.accentColor} 15%, transparent)`,
											color: current.accentColor,
										}}
									>
										{i + 1}
									</div>
									{h}
								</div>
							))}
						</div>
					) : null}
				</div>
			</div>

			{/* Bottom bar */}
			<div className="relative z-10 flex shrink-0 items-center justify-between border-t border-border/40 px-6 py-4">
				<Button type="button" variant="ghost" size="sm" onClick={finish} className="text-muted-foreground">
					{t("onboarding.skip")}
				</Button>

				<div className="flex items-center gap-2">
					{step > 0 && (
						<Button type="button" variant="outline" size="sm" onClick={goPrev}>
							<ArrowLeftIcon aria-hidden className="size-4" />
							{t("onboarding.back")}
						</Button>
					)}
					{isLast ? (
						<Button
							type="button"
							size="sm"
							onClick={finish}
							className="gap-2 px-6"
							style={{
								background: current.accentColor,
								borderColor: current.accentColor,
							}}
						>
							<LightningIcon className="size-4" weight="fill" />
							{t("onboarding.getStarted")}
						</Button>
					) : (
						<Button
							type="button"
							size="sm"
							onClick={goNext}
							className="gap-2"
							style={{
								background: current.accentColor,
								borderColor: current.accentColor,
							}}
						>
							{t("onboarding.next")}
							<ArrowRightIcon aria-hidden className="size-4" />
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
