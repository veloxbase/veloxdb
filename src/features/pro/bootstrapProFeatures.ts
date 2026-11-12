import { isProBuild } from '@/lib/build-config'
import { registerBuiltInPlugins } from '@/features/plugins/bootstrap'

/** Call once at module load (see `App.tsx`). No-op in Community builds. */
export function bootstrapProFeatures(): void {
  if (!isProBuild) return
  registerBuiltInPlugins()
}
