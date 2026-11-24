import { createHighlighter } from "@tanstack/highlight/core";
import { diff } from "@tanstack/highlight/languages/diff";
import { json } from "@tanstack/highlight/languages/json";
import { plaintext } from "@tanstack/highlight/languages/plaintext";
import { shell } from "@tanstack/highlight/languages/shell";
import { sql } from "@tanstack/highlight/languages/sql";

export const veloxyHighlighter = createHighlighter({
	fallbackLanguage: "plaintext",
	languages: [sql, json, shell, plaintext, diff],
});
