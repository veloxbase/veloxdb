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
import { useTranslation } from "react-i18next";

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

type OnboardingFlowProps = {
	onComplete: () => void;
};

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
	const { t } = useTranslation();
	const [step, setStep] = useState(0);

	useEffect(() => {
		document.documentElement.classList.toggle(
			"dark",
			window.matchMedia("(prefers-color-scheme: dark)").matches,
		);
	}, []);

	const STEPS: OnboardingStep[] = [
		{
			id: "welcome",
			kicker: t("onboarding.welcomeKicker"),
			title: t("onboarding.welcomeTitle"),
			body: t("onboarding.welcomeBody"),
			icon: DatabaseIcon,
		},
		{
			id: "engines",
			kicker: t("onboarding.enginesKicker"),
			title: t("onboarding.enginesTitle"),
			body: t("onboarding.enginesBody"),
			icon: PlugsConnectedIcon,
			pills: [
				{ label: "PostgreSQL", accent: true },
				{ label: "MySQL / MariaDB", accent: true },
				{ label: "SQLite", accent: true },
			],
			highlights: [
				t("onboarding.enginesHighlight1"),
				t("onboarding.enginesHighlight2"),
				t("onboarding.enginesHighlight3"),
			],
		},
		{
			id: "query",
			kicker: t("onboarding.queryKicker"),
			title: t("onboarding.queryTitle"),
			body: t("onboarding.queryBody"),
			icon: TerminalWindowIcon,
			highlights: [
				t("onboarding.queryHighlight1"),
				t("onboarding.queryHighlight2"),
				t("onboarding.queryHighlight3"),
			],
		},
		{
			id: "model",
			kicker: t("onboarding.modelKicker"),
			title: t("onboarding.modelTitle"),
			body: t("onboarding.modelBody"),
			icon: GraphIcon,
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
			pills: [{ label: "OpenRouter", accent: true }],
			highlights: [
				t("onboarding.veloxyHighlight1"),
				t("onboarding.veloxyHighlight2"),
				t("onboarding.veloxyHighlight3"),
			],
		},
		{
			id: "shortcuts",
			kicker: t("onboarding.shortcutsKicker"),
			title: t("onboarding.shortcutsTitle"),
			body: t("onboarding.shortcutsBody"),
			icon: KeyboardIcon,
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
							{t("onboarding.skip")}
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
								{t("onboarding.back")}
							</Button>
							{isLast ? (
								<Button type="button" size="sm" onClick={finish}>
									{t("onboarding.getStarted")}
								</Button>
							) : (
								<Button
									type="button"
									size="sm"
									onClick={() => setStep((s) => s + 1)}
								>
									{t("onboarding.next")}
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
