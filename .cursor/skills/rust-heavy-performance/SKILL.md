---
name: rust-heavy-performance
description: >-
  Enforces a Rust-first approach for heavy work in VeloxDB so expensive compute
  stays in Tauri/Rust instead of JavaScript. Focuses on memory efficiency, fast
  execution, bounded IPC payloads, and simple implementation patterns. Use when
  adding or changing heavy queries, transformations, diffing, parsing, exports,
  aggregations, or any path where performance is critical.
---

# Rust-Heavy Performance

Use this skill when a feature can become slow or memory-heavy. Prefer implementing heavy paths in `src-tauri/` and keep the frontend thin.

## Core rule

- If work is CPU-heavy, row-heavy, or repeatedly recomputed, do it in Rust.
- JavaScript/React should orchestrate UI state and rendering, not run bulk processing loops.

## Rust-first implementation pattern

1. Add or extend an async command in `src-tauri/src/commands.rs`.
2. Keep query execution and pooling logic in `src-tauri/src/db.rs` and related Rust modules.
3. Return a compact DTO to the frontend (already shaped for display).
4. Call it from `src/data/repositories/` using existing `invoke` patterns.
5. Render in feature UI with virtualization for large result sets.

## Memory efficiency guardrails

- Use bounded reads (`LIMIT`, pagination, or chunked iteration), never unbounded materialization.
- Avoid cloning large vectors/strings when references or incremental building is enough.
- Prefer streaming/chunked processing over collecting everything at once.
- Keep structs narrow for IPC responses; do not ship unused fields.
- Reuse pooled database connections; avoid ad hoc new clients per action.

## Speed guardrails

- Push filtering, sorting, grouping, and aggregation down to SQL/Rust.
- Minimize Rust<->webview payload size; serialize only what UI needs now.
- Cache or memoize expensive Rust-side intermediate results only when reuse is likely and bounded.
- Use async command handlers; avoid blocking I/O in command paths.

## Easy-to-implement defaults

- Start from existing command and repository patterns instead of inventing new data paths.
- Keep each command focused: one clear job, typed input, typed output.
- Introduce feature flags/options only after proving a real need.
- Keep frontend changes small: trigger command, handle loading/error, display bounded data.

## Anti-patterns to avoid

- Doing large data transforms in React `useMemo` or `useEffect`.
- Returning huge raw row sets to the UI and shaping them in JavaScript.
- Recomputing heavy derived data on every render or keystroke.
- Mixing unrelated concerns into a single Rust command handler.

## Review checklist

- Is the heavy work in Rust instead of JavaScript?
- Are reads and payloads explicitly bounded?
- Is memory growth controlled for worst-case input size?
- Is command/repository wiring following existing VeloxDB patterns?
- Does the UI virtualize large lists/tables and avoid unnecessary recomputation?
