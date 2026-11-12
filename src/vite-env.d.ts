/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VELOX_PRO?: string
  readonly VITE_VELOX_CLOUD_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
