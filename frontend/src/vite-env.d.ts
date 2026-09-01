/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Base URL of the FastAPI backend. Unset means the relative "/api" path. */
  readonly VITE_API_URL?: string
  /** The release tag this bundle was built from — see frontend/Dockerfile.
   *  Unset outside the release workflow (npm run dev, a local docker build). */
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
