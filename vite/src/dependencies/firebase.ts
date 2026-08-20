// A one-line shim over the real wrapper in `vite/dependencies/`. App code imports
// `@/dependencies/firebase`, which keeps `vi.mock("@/dependencies/firebase")`
// working in tests without reaching outside `src/`.
export { getFirebaseApp, getFirebaseAuth } from '../../dependencies/firebase'
