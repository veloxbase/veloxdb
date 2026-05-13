import { toast } from "@/components/ui/use-toast";
import {
	normalizeError,
	toastTitleForCategory,
	toUserMessage,
	type NormalizeErrorOptions,
} from "@/lib/app-error";
import { useSettings } from "@/lib/settings";

const recent = new Map<string, number>();
const DEDUP_MS = 1200;

function dedupKey(title: string, description: string, code?: string) {
	return `${title}\u0000${description}\u0000${code ?? ""}`;
}

function pruneOldEntries(now: number) {
	if (recent.size <= 64) {
		return;
	}
	for (const [key, time] of recent) {
		if (now - time > 10_000) {
			recent.delete(key);
		}
	}
}

export type NotifyErrorOptions = NormalizeErrorOptions & {
	/** Override default title from category */
	title?: string;
	/** Skip deduplication (e.g. distinct operational steps) */
	force?: boolean;
};

/**
 * Show a destructive toast for failures, with short-term deduplication to avoid
 * spam from retries or repeated renders.
 */
export function notifyError(
	error: unknown,
	options: NotifyErrorOptions = {},
): void {
	if (!useSettings.getState().toastLevels.error) {
		return;
	}

	const normalized = normalizeError(error, options);
	const title =
		options.title ?? toastTitleForCategory(normalized.category);
	const description = toUserMessage(normalized);

	if (!options.force) {
		const key = dedupKey(title, description, normalized.code);
		const now = Date.now();
		const last = recent.get(key);
		if (last !== undefined && now - last < DEDUP_MS) {
			return;
		}
		recent.set(key, now);
		pruneOldEntries(now);
	}

	try {
		toast({
			variant: "destructive",
			title,
			description,
		});
	} catch {
		console.error(
			"[notifyError] toast dispatch failed — error:",
			normalized,
		);
	}
}

/**
 * Show a success toast for completed operations.
 */
export function notifySuccess(
	title: string,
	description?: string,
): void {
	if (!useSettings.getState().toastLevels.success) {
		return;
	}

	try {
		toast({
			variant: "success",
			title,
			description,
		});
	} catch {
		console.error(
			"[notifySuccess] toast dispatch failed — title:",
			title,
		);
	}
}
