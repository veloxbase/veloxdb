import { Check, Palette } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	type AppTheme,
	THEME_ORDER,
	THEME_SWATCHES,
	switchThemeWithAnimation,
	themeLabels,
	useSettings,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

const THEME_TAGS: Record<AppTheme, string> = {
	dark: "NEUTRAL",
	ocean: "AZURE",
	slate: "STUDIO",
	forest: "SAGE",
	amber: "CRT 80s",
	sepia: "PAPER",
	rose: "MAUVE",
	light: "PURE",
	system: "AUTO",
};

const THEME_DESCRIPTIONS: Record<AppTheme, string> = {
	system: "Follow OS preference automatically",
	dark: "Deep neutral dark, balanced contrast",
	light: "Crisp white canvas, high-contrast dark lines",
	ocean: "Deep cool marine blue with vivid azure",
	slate: "High-contrast blue-gray, VSCode developer feel",
	forest: "Sage pine green, natural and easy on the eyes",
	amber: "CRT terminal amber on black, late-night low-blue",
	sepia: "Warm paper tones designed for long reading",
	rose: "Warm mauve twilight, cosy evening atmosphere",
};

export function ThemeSelector({ className }: { className?: string }) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [hoveredTheme, setHoveredTheme] = useState<AppTheme | null>(null);
	const activeTheme = useSettings((s) => s.theme);
	const activeSwatch = THEME_SWATCHES[activeTheme] ?? THEME_SWATCHES.dark;
	const inspectedTheme = hoveredTheme ?? activeTheme;
	const inspectedSwatch = THEME_SWATCHES[inspectedTheme] ?? THEME_SWATCHES.dark;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="icon-sm"
					className={cn("relative gap-1.5", className)}
					style={{
						boxShadow: `0 0 10px ${activeSwatch.accent}20`,
					}}
					title={`${t("settings.theme", "Theme")}: ${themeLabels[activeTheme]}`}
					aria-label={t("settings.theme", "Theme")}
				>
					<Palette className="size-3.5" />
					<span
						className="absolute bottom-1 right-1 size-1.5 rounded-full ring-1 ring-background"
						style={{ backgroundColor: activeSwatch.accent }}
						aria-hidden="true"
					/>
				</Button>
			</PopoverTrigger>

			<PopoverContent
				align="end"
				side="bottom"
				sideOffset={6}
				className="w-[330px] p-3 font-mono text-xs shadow-2xl border-border bg-popover/95 backdrop-blur-md"
			>
				{/* CAD Header */}
				<div className="mb-2.5 flex items-center justify-between border-b border-border/70 pb-2 text-[10px] uppercase tracking-wider">
					<div className="flex items-center gap-1.5 text-muted-foreground">
						<span
							className="size-1.5 rounded-full"
							style={{ backgroundColor: activeSwatch.accent }}
						/>
						<span className="font-semibold text-foreground">{t("settings.theme", "PALETTE MATRIX")}</span>
						<span className="text-muted-foreground/60">// 09_THEMES</span>
					</div>
					<span
						className="border px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-widest transition-colors"
						style={{
							borderColor: activeSwatch.accent,
							color: activeSwatch.accent,
							backgroundColor: `${activeSwatch.accent}15`,
						}}
					>
						ACTIVE: {themeLabels[activeTheme]}
					</span>
				</div>

				{/* 3x3 Visual Theme Matrix */}
				<div className="grid grid-cols-3 gap-2">
					{THEME_ORDER.map((theme) => {
						const isSelected = activeTheme === theme;
						const isHovered = hoveredTheme === theme;
						const swatch = THEME_SWATCHES[theme];
						const tag = THEME_TAGS[theme];
						const isLight = theme === "light" || theme === "sepia";

						return (
							<button
								key={theme}
								type="button"
								onClick={(e) => {
									switchThemeWithAnimation(theme, e);
									setOpen(false);
								}}
								onMouseEnter={() => setHoveredTheme(theme)}
								onMouseLeave={() => setHoveredTheme(null)}
								className={cn(
									"group relative flex flex-col justify-between p-2 rounded-sm border text-left cursor-pointer outline-none select-none",
									isSelected && "ring-1 ring-offset-1 ring-offset-background shadow-xs",
								)}
								style={{
									backgroundColor: swatch.bg,
									borderColor: isSelected || isHovered ? swatch.accent : swatch.border,
									color: isLight ? "#18181b" : "#f4f4f5",
								}}
							>
								{/* Top row: Accent pip + Tag */}
								<div className="flex w-full items-center justify-between gap-1 mb-2">
									<span
										className="size-1.5 shrink-0 rounded-full"
										style={{ backgroundColor: swatch.accent }}
									/>
									<span
										className="text-[8px] font-mono tracking-tight uppercase opacity-65"
										style={{ color: isLight ? "#3f3f46" : "#a1a1aa" }}
									>
										{tag}
									</span>
								</div>

								{/* Center: Label + Active check */}
								<div className="flex w-full items-center justify-between">
									<span className="font-semibold text-[11px] tracking-tight">
										{themeLabels[theme]}
									</span>
									{isSelected ? (
										<Check
											className="size-3 shrink-0"
											weight="bold"
											style={{ color: swatch.accent }}
										/>
									) : null}
								</div>

								{/* Bottom Accent Bar */}
								<div
									className="mt-2 h-0.5 w-full transition-opacity duration-150"
									style={{
										backgroundColor: swatch.accent,
										opacity: isSelected ? 1 : 0.35,
									}}
								/>
							</button>
						);
					})}
				</div>

				{/* Telemetry Bar */}
				<div className="mt-3 border-t border-border/70 pt-2 text-[10px]">
					<div className="flex items-center justify-between text-muted-foreground">
						<span className="truncate max-w-[210px] text-foreground font-medium">
							{THEME_DESCRIPTIONS[inspectedTheme]}
						</span>
						<span
							className="text-[9px] font-mono shrink-0 uppercase"
							style={{ color: inspectedSwatch.accent }}
						>
							{inspectedSwatch.accent}
						</span>
					</div>
					<div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground/60">
						<span>CANVAS: {inspectedSwatch.bg}</span>
						<span>GPU VIEW_TRANSITION</span>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
