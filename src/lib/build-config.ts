/** Single source of truth for Pro vs Community builds. See `bootstrapProFeatures()`. */
export const isProBuild = import.meta.env.VITE_VELOX_PRO === 'true'
