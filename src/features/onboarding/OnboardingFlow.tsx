import { DatabaseIcon, LightningIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	writeOnboardingCompleted,
	writeOpenConnectOnLaunch,
} from "@/features/onboarding/constants";

type OnboardingFlowProps = {
	onComplete: () => void;
};

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
	const { t } = useTranslation();

	useEffect(() => {
		document.documentElement.classList.toggle(
			"dark",
			window.matchMedia("(prefers-color-scheme: dark)").matches,
		);
	}, []);

	const finish = (openConnect: boolean) => {
		writeOnboardingCompleted(true);
		if (openConnect) writeOpenConnectOnLaunch();
		onComplete();
	};

	return (
		<div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
			<div
				className="pointer-events-none fixed inset-0 z-[1] opacity-[0.03]"
				style={{
					background: "radial-gradient(600px at 50% 40%, #10b981, transparent)",
				}}
				aria-hidden
			/>

			<div className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-border/40 px-6">
				<div className="flex items-center gap-2">
					<div className="flex size-6 items-center justify-center rounded bg-primary/10">
						<DatabaseIcon className="size-3.5 text-primary" weight="fill" />
					</div>
					<span className="text-xs font-semibold tracking-wide text-foreground">VeloxDB</span>
				</div>
			</div>

			<div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-6">
				<div className="flex w-full max-w-2xl flex-col items-center gap-10">
					<div
						className="flex size-20 items-center justify-center rounded-2xl border shadow-2xl"
						style={{
							background: "color-mix(in srgb, #10b981 12%, transparent)",
							borderColor: "color-mix(in srgb, #10b981 30%, transparent)",
						}}
					>
						<DatabaseIcon className="size-10 text-emerald-500" weight="duotone" aria-hidden />
					</div>

					<div className="flex flex-col items-center gap-5 text-center">
						<p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-500">
							{t("onboarding.welcomeKicker")}
						</p>
						<h1 className="max-w-lg text-3xl font-bold leading-tight tracking-tight text-balance">
							{t("onboarding.welcomeTitle")}
						</h1>
						<p className="max-w-lg text-[15px] leading-relaxed text-muted-foreground text-balance">
							{t("onboarding.welcomeBody")}
						</p>
						<p className="max-w-lg text-sm leading-relaxed text-muted-foreground/80 text-balance">
							{t("onboarding.welcomePrivacy")}
						</p>
					</div>
				</div>
			</div>

			<div className="relative z-10 flex shrink-0 items-center justify-between border-t border-border/40 px-6 py-4">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => finish(false)}
					className="text-muted-foreground"
				>
					{t("onboarding.skip")}
				</Button>

				<Button
					type="button"
					size="sm"
					onClick={() => finish(true)}
					className="gap-2 px-6"
				>
					<LightningIcon className="size-4" weight="fill" />
					{t("onboarding.connectADatabase")}
				</Button>
			</div>
		</div>
	);
}
