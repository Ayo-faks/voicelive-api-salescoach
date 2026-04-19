/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
  readonly VITE_ENABLE_PREVIEW_EXPORT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
