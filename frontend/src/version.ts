/**
 * This build's release tag, baked in at build time — see frontend/Dockerfile.
 *
 * A static bundle has no runtime environment to read this from later, so it
 * has to be embedded when the JS is built, not when the container starts
 * (unlike the backend, which can read APP_VERSION from its process
 * environment on every request). "dev" is the value outside the release
 * workflow: `npm run dev`, a local `docker compose up -d --build`.
 */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev'
