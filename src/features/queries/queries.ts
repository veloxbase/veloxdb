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

export function useSaveResultEditsMutation() {
  return useMutation({
    mutationFn: async (request: SaveResultEditsRequest) => {
      const statements = buildUpdateStatements(request)

      if (statements.length === 0) {
        return
      }

      await veloxDbRepository.runQuery({
        connectionId: request.connectionId,
        sql: `BEGIN;\n${statements.join('\n')}\nCOMMIT;`,
      })
    },
  })
}

