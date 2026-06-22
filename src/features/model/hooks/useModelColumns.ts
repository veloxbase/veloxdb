import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { queryKeys } from '@/data/query-keys';
import { veloxDbRepository } from '@/data/repositories';
import type { ColumnInfo, ForeignKeyEdge, TableInfo } from '@/data/types';
import { tableKey, type ColumnDetailLevel, type TableKey } from '@/features/model/model-types';

interface UseModelColumnsParams {
	connectionId: string;
	tables: TableInfo[];
	onCanvas: TableKey[];
	columnDetail: ColumnDetailLevel;
	foreignKeys: ForeignKeyEdge[];
	pendingForeignKeys: { fromKey: TableKey; toKey: TableKey; fromColumn: string; toColumn: string }[];
	columnIdentityOverridesByKey: Record<TableKey, Record<string, { nextColumnName: string; nextDataType: string }>>;
	pendingAddColumnsByKey: Record<TableKey, { columnName: string; dataType: string; nullable: boolean }[]>;
}

function tableKeyToParts(key: TableKey): { schema: string; name: string } {
	const [schema = '', name = ''] = key.split('.');
	return { schema, name };
}

export function useModelColumns({
	connectionId,
	tables,
	onCanvas,
	columnDetail,
	foreignKeys,
	pendingForeignKeys,
	columnIdentityOverridesByKey,
	pendingAddColumnsByKey,
}: UseModelColumnsParams) {
	const tablesByKey = useMemo(() => {
		const m = new Map<TableKey, TableInfo>();
		for (const t of tables) m.set(tableKey(t), t);
		return m;
	}, [tables]);

	const [columnRequestKeys, setColumnRequestKeys] = useState<TableKey[]>([]);

	const requestColumns = (key: TableKey) => {
		setColumnRequestKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
	};

	const sortedRequestKeys = useMemo(() => [...columnRequestKeys].sort(), [columnRequestKeys]);

	const columnQueries = useQueries({
		queries: sortedRequestKeys.map((key) => {
			const table = tablesByKey.get(key);
			return {
				queryKey: queryKeys.schema(connectionId, table ?? null),
				queryFn: () => {
					if (!table) throw new Error('Table not found for schema request.');
					return veloxDbRepository.getSchema(connectionId, table);
				},
				enabled: Boolean(connectionId && table),
				staleTime: 5 * 60 * 1000,
			};
		}),
	});

	const columnsByKey = useMemo(() => {
		const out: Record<TableKey, ColumnInfo[] | null> = {};
		sortedRequestKeys.forEach((key, i) => {
			const q = columnQueries[i];
			if (!q) { out[key] = null; return; }
			if (q.isPending && !q.data) out[key] = null;
			else if (q.data) out[key] = q.data;
			else out[key] = null;
		});
		return out;
	}, [columnQueries, sortedRequestKeys]);

	const effectiveColumnsByKey = useMemo(() => {
		const out: Record<TableKey, ColumnInfo[] | null> = {};
		for (const [key, cols] of Object.entries(columnsByKey) as Array<[TableKey, ColumnInfo[] | null]>) {
			if (!cols) { out[key] = null; continue; }
			const identityOverrides = columnIdentityOverridesByKey[key] ?? {};
			const rows = cols.map((col) => {
				const patch = identityOverrides[col.columnName];
				if (!patch) return col;
				const nextName = patch.nextColumnName.trim();
				const nextType = patch.nextDataType.trim();
				return { ...col, columnName: nextName || col.columnName, dataType: nextType || col.dataType };
			});
			const pending = pendingAddColumnsByKey[key] ?? [];
			const pendingRows: ColumnInfo[] = pending.map((col) => ({
				tableSchema: tableKeyToParts(key).schema,
				tableName: tableKeyToParts(key).name,
				columnName: col.columnName.trim(),
				dataType: col.dataType.trim(),
				isNullable: col.nullable,
			}));
			out[key] = [...rows, ...pendingRows];
		}
		return out;
	}, [columnIdentityOverridesByKey, columnsByKey, pendingAddColumnsByKey]);

	const onCanvasSet = useMemo(() => new Set(onCanvas), [onCanvas]);

	const fkColumnNamesByKey = useMemo(() => {
		const m = new Map<TableKey, Set<string>>();
		const add = (tab: TableKey, col: string) => {
			if (!onCanvasSet.has(tab)) return;
			const existing = m.get(tab);
			if (existing) { existing.add(col); return; }
			m.set(tab, new Set([col]));
		};
		for (const fk of foreignKeys) {
			add(`${fk.fromSchema}.${fk.fromTable}` as TableKey, fk.fromColumn);
			add(`${fk.toSchema}.${fk.toTable}` as TableKey, fk.toColumn);
		}
		for (const p of pendingForeignKeys) {
			add(p.fromKey, p.fromColumn);
			add(p.toKey, p.toColumn);
		}
		return m;
	}, [foreignKeys, onCanvasSet, pendingForeignKeys]);

	const diagramDisplayColumnsByKey = useMemo(
		(): Record<TableKey, ColumnInfo[] | null> => {
			const out: Record<TableKey, ColumnInfo[] | null> = {};
			for (const k of onCanvas) {
				const cols = effectiveColumnsByKey[k] ?? null;
				if (columnDetail === 'header') { out[k] = []; continue; }
				if (columnDetail === 'keys' && cols?.length) {
					const set = fkColumnNamesByKey.get(k);
					const filtered = set?.size ? cols.filter((c) => set.has(c.columnName)) : cols.slice(0, 4);
					out[k] = filtered.length > 0 ? filtered : cols.slice(0, 4);
					continue;
				}
				out[k] = cols;
			}
			return out;
		},
		[columnDetail, effectiveColumnsByKey, fkColumnNamesByKey, onCanvas],
	);

	// Auto-request columns for FK-related tables
	// eslint-disable-next-line react-hooks/set-state-in-effect
	useEffect(() => {
		const keys = new Set<TableKey>();
		for (const fk of foreignKeys) {
			const fromK = `${fk.fromSchema}.${fk.fromTable}` as TableKey;
			const toK = `${fk.toSchema}.${fk.toTable}` as TableKey;
			if (onCanvasSet.has(fromK)) keys.add(fromK);
			if (onCanvasSet.has(toK)) keys.add(toK);
		}
		for (const p of pendingForeignKeys) {
			keys.add(p.fromKey);
			keys.add(p.toKey);
		}
		if (keys.size === 0) return;
		setColumnRequestKeys((prev) => {
			let next = prev;
			for (const k of keys) {
				if (!next.includes(k)) next = [...next, k];
			}
			return next;
		});
	}, [foreignKeys, onCanvasSet, pendingForeignKeys]);

	return {
		columnsByKey,
		effectiveColumnsByKey,
		diagramDisplayColumnsByKey,
		fkColumnNamesByKey,
		columnRequestKeys,
		setColumnRequestKeys,
		requestColumns,
	};
}
