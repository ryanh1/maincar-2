# maincar-2

A React + Vite client, an Express + Prisma API, Firebase Auth emulator, and a local
Postgres + MinIO stack in Docker.

```
vite/       React 19 + Vite + TypeScript + Tailwind + shadcn-ui
server/     Express + Prisma + TypeScript
firebase/   Firebase emulator config (auth, firestore, storage)
docker/     Local Postgres + MinIO (compose project `maincar2`)
```

## First run

```bash
npm run install:all
cp .env.example .env
npm run docker:up
npm run db:migrate
npm run dev
```

`npm run dev` starts everything in one terminal: Docker, the API, the Vite dev
server, and the Firebase emulators.

## Local ports

Every port here is unique to this project, so it can run at the same time as the
other stacks on this machine (loadwire, maincar, lita, bari).

| Service            | URL                     |
| ------------------ | ----------------------- |
| Vite (web)         | http://localhost:5183   |
| API                | http://localhost:3010   |
| Postgres           | `localhost:5440`        |
| MinIO API          | http://localhost:9010   |
| MinIO console      | http://localhost:9011   |
| Firebase Auth      | `127.0.0.1:9140`        |
| Firestore          | `127.0.0.1:8140`        |
| Firebase Storage   | `127.0.0.1:9240`        |
| Firebase UI        | http://localhost:4140   |

## Everyday commands

| Command                  | What it does                                              |
| ------------------------ | --------------------------------------------------------- |
| `npm run dev`            | Docker + API + web + Firebase emulators, one terminal      |
| `npm run dev:tunnel`     | The same, plus the public zrok tunnel for webhooks         |
| `npm test`               | Server and client test suites                              |
| `npm run test:watch`     | Both suites in watch mode                                  |
| `npm run typecheck`      | TypeScript across both packages                            |
| `npm run lint`           | ESLint across both packages                                |
| `npm run build`          | Production build of both packages                          |
| `npm run db:migrate`     | Create and apply a migration (dev)                         |
| `npm run db:deploy`      | Apply committed migrations (CI / production)               |
| `npm run db:studio`      | Prisma Studio                                              |
| `npm run docker:up`      | Start Postgres + MinIO                                     |
| `npm run docker:down`    | Stop them (data is kept — it lives in a named volume)      |
| `npm run firebase:export`| Save the emulator's accounts to `firebase/data`            |

## The public tunnel

Webhooks from outside need a public URL. Reserve the zrok share once:

```bash
zrok reserve public localhost:3010 --unique-name maincar2-api
```

Then `npm run tunnel` (or `npm run dev:tunnel`) serves it, and `PUBLIC_BASE_URL`
in `.env` is the address callback URLs are built from.

## Firebase emulator state

The emulators start with `--import data --export-on-exit data`, so the accounts
you sign in with today are still there tomorrow. A crash skips the export — run
`npm run firebase:export` to checkpoint without stopping anything.

## Conventions

[CLAUDE.md](CLAUDE.md) holds the project rules: config and env handling, UI
component rules, Prisma and migration rules, route patterns, and testing
requirements. Read it before writing code.
