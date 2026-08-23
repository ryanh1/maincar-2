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

`npm run dev` starts everything in one terminal: Firebase first, then Docker,
the API, and the Vite dev server. It waits until Firebase Auth can answer a
request before starting the API and web processes, so a cold emulator cannot
turn startup into transient authentication failures.

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
| `npm run firebase:dev`   | Just the Firebase emulators                                |
| `npm run firebase:save`  | Checkpoint the emulator's accounts right now               |
| `npm run gh-to-mirror`   | Copy the newest GitHub `main` into the local bare mirror    |
| `npm run mirror-to-main` | Safely refresh the normal checkout, packages, and database |

## The public tunnel

Webhooks from outside need a public URL. Reserve the zrok share once:

```bash
zrok reserve public localhost:3010 --unique-name maincar-api
```

Then `npm run tunnel` (or `npm run dev:tunnel`) serves it, and `PUBLIC_BASE_URL`
in `.env` is the address callback URLs are built from.

## Firebase emulator state

The accounts you sign in with locally are meant to survive a restart, and
`--export-on-exit` alone does not manage it: it runs only on a clean shutdown.
Kill the terminal, or let the machine sleep, and every local account is gone.

So [`scripts/firebase-emulator.sh`](scripts/firebase-emulator.sh) wraps the
emulator and does three things the bare command does not:

- **Saves the accounts to `firebase/data` every 60 seconds** while it runs, and
  once more on the way out. A `kill -9` costs you at most the last minute.
  Override the interval with `FIREBASE_AUTOSAVE_SECONDS`.
- **Refuses to take over an occupied emulator port.** A port can belong to a
  different worktree, so the launcher prints the owning PID and leaves it alone
  instead of killing a process it did not start.
- **Skips `--import` when there is nothing to import**, so a fresh clone starts
  instead of failing with "Could not find import directory".

`npm run firebase:save` checkpoints on demand, without restarting anything.
Firebase snapshots are runtime state and are ignored by Git, so a normal save
does not make the runnable checkout look like it contains user changes.

Accounts are read from the emulator's REST API rather than through
`firebase emulators:export`, because that command follows a global hub locator
file and can write an empty export from a different project's emulator over your
good one. The save refuses to replace a non-empty file with an empty one.

## Conventions

[CLAUDE.md](CLAUDE.md) holds the project rules: config and env handling, UI
component rules, Prisma and migration rules, route patterns, and testing
requirements. Read it before writing code.
