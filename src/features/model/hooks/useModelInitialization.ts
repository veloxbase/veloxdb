import { useEffect, useMemo, useRef } from 'react';
import type { TableInfo } from '@/data/types';
import { ensurePositions } from '@/features/model/model-layout-storage';
import { tableKey, type TableKey } from '@/features/model/model-types';
import { useForeignKeysQuery } from '@/features/model/queries';

interface UseModelInitializationParams {
	connectionId: string;
	tables: TableInfo[];
	onCanvas: TableKey[];
	hadStoredLayout: boolean;
	setOnCanvas: (updater: TableKey[] | ((prev: TableKey[]) => TableKey[])) => void;
	setPositions: (
		updater:
			| Record<TableKey, { x: number; y: number }>
			| ((prev: Record<TableKey, { x: number; y: number }>) => Record<TableKey, { x: number; y: number }>),
	) => void;
	selectSingleFromCatalog: (key: TableKey) => void;
	setInitialSeedReason: (reason: 'relationships' | 'sample' | null) => void;
	selectedTable: TableInfo | null;
	primaryKey: TableKey | null;
	setIdentityDraftByKey: (
		updater:
			| Record<TableKey, { schema: string; name: string }>
			| ((prev: Record<TableKey, { schema: string; name: string }>) => Record<TableKey, { schema: string; name: string }>),
	) => void;
}

export function useModelInitialization({
	connectionId,
	tables,
	onCanvas,
	hadStoredLayout,
	setOnCanvas,
	setPositions,
	selectSingleFromCatalog,
	setInitialSeedReason,
	selectedTable,
	primaryKey,
	setIdentityDraftByKey,
}: UseModelInitializationParams) {
	const foreignKeysQuery = useForeignKeysQuery(connectionId);

	const tablesByKey = useMemo(() => {
		const m = new Map<TableKey, TableInfo>();
		for (const t of tables) m.set(tableKey(t), t);
		return m;
	}, [tables]);

	const fkSeedDoneRef = useRef(false);
	const initialRecoveryDoneRef = useRef(false);

	// Reset guards when connection changes
	useEffect(() => {
		void connectionId;
		initialRecoveryDoneRef.current = false;
		fkSeedDoneRef.current = false;
		setInitialSeedReason(null);
	}, [connectionId, setInitialSeedReason]);

	// Initial canvas recovery: prune invalid keys, seed from FK or sample
	useEffect(() => {
		if (initialRecoveryDoneRef.current) return;
		if (!tables.length) return;

		const validOnCanvas = onCanvas.filter((k) => tablesByKey.has(k));
		if (validOnCanvas.length !== onCanvas.length) {
			setOnCanvas(validOnCanvas);
			setPositions((prev) => {
				const next: Record<TableKey, { x: number; y: number }> = {};
				for (const key of validOnCanvas) {
					if (prev[key]) next[key] = prev[key];
				}
				return next;
			});
		}

		if (validOnCanvas.length === 0) {
			const fkData = foreignKeysQuery.data ?? [];
			const fkSeed = new Set<TableKey>();
			for (const edge of fkData) {
				const from = `${edge.fromSchema}.${edge.fromTable}` as TableKey;
				const to = `${edge.toSchema}.${edge.toTable}` as TableKey;
				if (tablesByKey.has(from)) fkSeed.add(from);
				if (tablesByKey.has(to)) fkSeed.add(to);
			}
			const fallbackKeys = fkSeed.size > 0 ? [...fkSeed] : tables.slice(0, 12).map((t) => tableKey(t));
			if (fallbackKeys.length > 0) {
				setInitialSeedReason(fkSeed.size > 0 ? 'relationships' : 'sample');
				setOnCanvas(fallbackKeys);
				setPositions((prev) => ensurePositions(fallbackKeys, prev));
			}
		}

		initialRecoveryDoneRef.current = true;
	}, [foreignKeysQuery.data, onCanvas, tables, tablesByKey, setOnCanvas, setPositions, setInitialSeedReason]);

	// FK seed fallback when no stored layout exists
	useEffect(() => {
		if (hadStoredLayout) return;
		if (fkSeedDoneRef.current) return;
		const fkData = foreignKeysQuery.data;
		if (!fkData?.length || !tables.length) return;

		const keys = new Set<TableKey>();
		for (const e of fkData) {
			keys.add(`${e.fromSchema}.${e.fromTable}`);
			keys.add(`${e.toSchema}.${e.toTable}`);
		}
		const valid = [...keys].filter((k) => tables.some((t) => tableKey(t) === k));
		if (valid.length === 0) return;

		fkSeedDoneRef.current = true;
		queueMicrotask(() => {
			setOnCanvas(valid);
			setPositions((p) => ensurePositions(valid, p));
		});
	}, [hadStoredLayout, foreignKeysQuery.data, tables, setOnCanvas, setPositions]);

	// Selected table from outside → add to canvas
	useEffect(() => {
		if (!selectedTable) return;
		const k = tableKey(selectedTable);
		queueMicrotask(() => {
			selectSingleFromCatalog(k);
			setOnCanvas((prev) => (prev.includes(k) ? prev : [...prev, k]));
			setPositions((p) => ensurePositions([k], p));
		});
	}, [selectSingleFromCatalog, selectedTable, setOnCanvas, setPositions]);

	// Identity draft for inspector's primary table
	useEffect(() => {
		if (!primaryKey) return;
		const t = tablesByKey.get(primaryKey);
		if (!t) return;
		setIdentityDraftByKey((prev) =>
			prev[primaryKey] != null ? prev : { ...prev, [primaryKey]: { schema: t.schema, name: t.name } },
		);
	}, [primaryKey, tablesByKey, setIdentityDraftByKey]);

	return { tablesByKey, foreignKeysQuery };
}
