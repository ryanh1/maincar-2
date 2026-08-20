import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

export default defineConfig(({ mode }) => {
  // Env lives in the repo-root .env, shared with the server. Only VITE_-prefixed
  // vars are exposed to the browser bundle.
  const envDir = path.resolve(import.meta.dirname, '..')
  const env = loadEnv(mode, envDir)
  const apiTarget = env.VITE_API_URL || 'http://localhost:3010'

  // In local dev the client calls `connectAuthEmulator(auth, window.location.origin)`,
  // so the Firebase SDK issues its auth requests against THIS origin rather than
  // 127.0.0.1:9140. Going through the app's own origin is what keeps an HTTPS
  // tunnel mixed-content safe. It only works if these two paths are proxied — the
  // SDK talks to /identitytoolkit.googleapis.com and /securetoken.googleapis.com.
  const useFirebaseEmulators = (env.VITE_ENVIRONMENT || 'local') === 'local'
  const authEmulatorUrl = env.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9140'
  // Annotated, because a bare conditional spread makes each key optional and the
  // proxy record does not accept `undefined` values.
  const emulatorProxy: Record<string, ProxyOptions> = useFirebaseEmulators
    ? {
        '/identitytoolkit.googleapis.com': {
          target: authEmulatorUrl,
          changeOrigin: true,
          secure: false,
        },
        '/securetoken.googleapis.com': {
          target: authEmulatorUrl,
          changeOrigin: true,
          secure: false,
        },
      }
    : {}

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    server: {
      // strictPort: a taken 5183 must fail loudly rather than drift to 5184.
      // The server's CORS allows exactly WEB_ORIGIN, so a drifted port would
      // break every API call with an error that looks like an auth problem.
      port: 5183,
      strictPort: true,
      host: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        ...emulatorProxy,
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
  }
})
