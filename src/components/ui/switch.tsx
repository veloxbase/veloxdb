import type * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Compact on/off switch. Uses `--control-accent` for the "on" track so the
 * state reads clearly in every theme (the old `bg-primary` track was nearly
 * white in dark themes, which made on and off look alike).
 */
function Switch({
	className,
	...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"peer inline-flex h-[1.125rem] w-8 shrink-0 cursor-pointer items-center rounded-full p-0.5 shadow-inner outline-none transition-colors duration-200",
				"data-[state=unchecked]:bg-muted-foreground/35 data-[state=checked]:bg-[var(--control-accent)]",
				"hover:data-[state=unchecked]:bg-muted-foreground/45",
				"focus-visible:ring-2 focus-visible:ring-[var(--control-accent)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
				"disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="pointer-events-none block size-3.5 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.3)] transition-transform duration-200 ease-out data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
