import { useMutation } from '@tanstack/react-query'

import { veloxDbRepository } from '@/data/repositories'
import type { QueryRequest, QueryResult } from '@/data/types'
import { buildUpdateStatements, type SaveResultEditsRequest } from '@/features/queries/result-edits'

type UseRunQueryMutationOptions = {
  onSuccess?: (result: QueryResult, variables: QueryRequest) => void
}

export function useRunQueryMutation(options: UseRunQueryMutationOptions = {}) {
  return useMutation({
    mutationFn: (request: QueryRequest) => veloxDbRepository.runQuery(request),
    onSuccess: (result, variables) => {
      options.onSuccess?.(result, variables)
    },
  })
}

type UseExplainPlanMutationOptions = {
  onSuccess?: (result: QueryResult, variables: { connectionId: string; sql: string }) => void
}

/** Runs EXPLAIN (ANALYZE, BUFFERS) unless the SQL already starts with EXPLAIN or PREPARE. */
export function useExplainPlanMutation(options: UseExplainPlanMutationOptions = {}) {
  return useMutation({
    mutationFn: ({ connectionId, sql }: { connectionId: string; sql: string }) => {
      const trimmed = sql.trim()
      const upper = trimmed.toUpperCase()
      const body =
        upper.startsWith('EXPLAIN') || upper.startsWith('PREPARE')
          ? trimmed
          : `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)\n${trimmed}`
      return veloxDbRepository.runQuery({ connectionId, sql: body })
    },
    onSuccess: (result, variables) => {
      options.onSuccess?.(result, variables)
    },
  })
}

export function useSaveResultEditsMutation() {
  return useMutation({
    mutationFn: async (request: SaveResultEditsRequest) => {
      const statements = buildUpdateStatements(request)

      if (statements.length === 0) {
        return
      }

      try {
        await veloxDbRepository.runQuery({
          connectionId: request.connectionId,
          sql: `BEGIN;\n${statements.join('\n')}\nCOMMIT;`,
        })
      } catch (error) {
        // Best-effort rollback in case the previous transaction failed mid-flight.
        try {
          await veloxDbRepository.runQuery({
            connectionId: request.connectionId,
            sql: 'ROLLBACK;',
          })
        } catch {
          // Ignore rollback failure; surface original save failure to the UI.
        }
        throw error
      }
    },
  })
}

