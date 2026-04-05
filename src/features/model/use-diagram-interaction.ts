import { useCallback, useReducer, useState } from 'react'

import type { TableKey } from '@/features/model/model-types'

export type DiagramTool = 'select' | 'pan' | 'connect'

type SelectionState = {
  selectedKeys: TableKey[]
  primaryKey: TableKey | null
}

type SelectionAction =
  | { type: 'clear' }
  | { type: 'replace'; keys: TableKey[]; primaryKey: TableKey | null }
  | { type: 'setKeys'; keys: TableKey[] }
  | { type: 'updateKeys'; fn: (prev: TableKey[]) => TableKey[] }
  | { type: 'setPrimaryKey'; key: TableKey | null }
  | { type: 'clickTable'; key: TableKey; shiftKey: boolean }
  | { type: 'marquee'; keys: TableKey[]; shiftKey: boolean }

function selectionReducer(s: SelectionState, a: SelectionAction): SelectionState {
  switch (a.type) {
    case 'clear':
      return { selectedKeys: [], primaryKey: null }
    case 'replace':
      return { selectedKeys: a.keys, primaryKey: a.primaryKey }
    case 'setKeys': {
      const keys = a.keys
      const primary =
        s.primaryKey != null && keys.includes(s.primaryKey) ? s.primaryKey : keys[0] ?? null
      return { selectedKeys: keys, primaryKey: primary }
    }
    case 'updateKeys': {
      const keys = a.fn(s.selectedKeys)
      const primary =
        s.primaryKey != null && keys.includes(s.primaryKey) ? s.primaryKey : keys[0] ?? null
      return { selectedKeys: keys, primaryKey: primary }
    }
    case 'setPrimaryKey': {
      if (a.key == null) return { ...s, primaryKey: null }
      if (!s.selectedKeys.includes(a.key)) return s
      return { ...s, primaryKey: a.key }
    }
    case 'clickTable': {
      const { key, shiftKey } = a
      if (!shiftKey) {
        return { selectedKeys: [key], primaryKey: key }
      }
      const set = new Set(s.selectedKeys)
      if (set.has(key)) {
        set.delete(key)
        const next = [...set]
        const primary = s.primaryKey === key ? next[0] ?? null : s.primaryKey
        return { selectedKeys: next, primaryKey: primary }
      }
      set.add(key)
      return { selectedKeys: [...set], primaryKey: key }
    }
    case 'marquee': {
      if (a.shiftKey) {
        const merged = [...new Set([...s.selectedKeys, ...a.keys])]
        const primary =
          a.keys.length > 0 ? a.keys[a.keys.length - 1]! : s.primaryKey
        return { selectedKeys: merged, primaryKey: primary }
      }
      const keys = a.keys
      return { selectedKeys: keys, primaryKey: keys[0] ?? null }
    }
    default:
      return s
  }
}

export function useDiagramInteraction(initialTool: DiagramTool | (() => DiagramTool) = 'select') {
  const [tool, setTool] = useState<DiagramTool>(initialTool)
  const [selection, dispatchSelection] = useReducer(selectionReducer, {
    selectedKeys: [],
    primaryKey: null,
  })

  const clearSelection = useCallback(() => {
    dispatchSelection({ type: 'clear' })
  }, [])

  const selectTable = useCallback((key: TableKey, shiftKey: boolean) => {
    dispatchSelection({ type: 'clickTable', key, shiftKey })
  }, [])

  const applyMarquee = useCallback((keys: TableKey[], shiftKey: boolean) => {
    dispatchSelection({ type: 'marquee', keys, shiftKey })
  }, [])

  const selectSingleFromCatalog = useCallback((key: TableKey | null) => {
    if (key == null) {
      dispatchSelection({ type: 'clear' })
      return
    }
    dispatchSelection({ type: 'clickTable', key, shiftKey: false })
  }, [])

  const setSelectedKeys = useCallback((keys: TableKey[] | ((prev: TableKey[]) => TableKey[])) => {
    if (typeof keys === 'function') {
      dispatchSelection({ type: 'updateKeys', fn: keys })
    } else {
      dispatchSelection({ type: 'setKeys', keys })
    }
  }, [])

  const setPrimaryKey = useCallback((key: TableKey | null) => {
    dispatchSelection({ type: 'setPrimaryKey', key })
  }, [])

  const replaceSelection = useCallback((keys: TableKey[], primaryKey: TableKey | null) => {
    dispatchSelection({ type: 'replace', keys, primaryKey })
  }, [])

  return {
    tool,
    setTool,
    selectedKeys: selection.selectedKeys,
    setSelectedKeys,
    primaryKey: selection.primaryKey,
    setPrimaryKey,
    replaceSelection,
    selectTable,
    clearSelection,
    applyMarquee,
    selectSingleFromCatalog,
  }
}
