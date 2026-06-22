import { useLayoutEffect, useRef } from "react";

export function ResultEditInput({
	defaultValue,
	onBlurCommit,
	onEscape,
}: {
	defaultValue: string;
	onBlurCommit: (raw: string) => void;
	onEscape: () => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const skipBlurCommitRef = useRef(false);

	useLayoutEffect(() => {
		const element = inputRef.current;
		if (!element) return;
		element.focus();
		element.select();
	}, []);

	return (
		<input
			ref={inputRef}
			className="h-6 w-full min-w-0 border border-border bg-background px-1 text-xs outline-none focus:border-ring"
			defaultValue={defaultValue}
			onBlur={(event) => {
				if (skipBlurCommitRef.current) {
					skipBlurCommitRef.current = false;
					return;
				}
				onBlurCommit(event.target.value);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
				if (event.key === "Escape") {
					skipBlurCommitRef.current = true;
					onEscape();
				}
			}}
		/>
	);
}

export function InsertRowInput({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (next: string) => void;
	placeholder: string;
}) {
	return (
		<input
			className="h-6 w-full min-w-0 border border-border bg-background px-1 text-xs outline-none focus:border-ring"
			value={value}
			onChange={(event) => onChange(event.target.value)}
			placeholder={placeholder}
			autoComplete="off"
		/>
	);
}
