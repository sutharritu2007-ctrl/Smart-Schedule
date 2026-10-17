# SmartSchedule

Timetable management and optimization for IIIT Surat.

> **Status: Phase 1, project foundation.** The application shell, the Express API with a health check, and the
> frontend-to-backend connection are in place. Timetable generation, academic data management, optimization,
> authentication and database connectivity are **not implemented yet**.

## Stack

| Layer    | Technology                                        |
| -------- | ------------------------------------------------- |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4       |
| Backend  | Node.js, Express 4, TypeScript, zod (env checks)  |
| Database | MongoDB with Mongoose (planned; not connected yet) |

## Prerequisites

- **Node.js 22.12 or newer** (`node -v`) and npm 10+
- Git (optional)
- MongoDB is **not required** for this phase

## Setup

```bash
# from the repository root
npm install          # installs both workspaces (client and server)
```

Environment files are optional in this phase because every variable has a default. To customize:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

On Windows PowerShell use `Copy-Item` instead of `cp`.

## Run

```bash
npm run dev          # starts API (http://localhost:4000) and web app (http://localhost:5173)
```

Or run them separately in two terminals:

```bash
npm run dev:server   # API only
npm run dev:client   # web app only
```

Open http://localhost:5173. The top bar shows whether the API is reachable. Stop the API and it switches to
"API unreachable" with a Retry button; start it again and the page reconnects automatically.

You can also check the API directly: http://localhost:4000/api/health

## Commands

| Command             | What it does                                                  |
| ------------------- | ------------------------------------------------------------- |
| `npm run dev`       | Start API and web app together with live reload               |
| `npm run build`     | Compile the API to `server/dist` and bundle the web app to `client/dist` |
| `npm run typecheck` | Type-check both projects without emitting files               |
| `npm test`          | Run API tests (Node's built-in test runner)                   |
| `npm run start -w server` | Run the compiled API (after `npm run build`)            |

## Environment variables

**`server/.env`**

| Variable        | Default                 | Notes                                                              |
| --------------- | ----------------------- | ------------------------------------------------------------------ |
| `NODE_ENV`      | `development`           | `development`, `test` or `production`                              |
| `PORT`          | `4000`                  | API port                                                           |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Origin allowed by CORS                                             |
| `MONGODB_URI`   | unset                   | Optional and unused. If set, only its format is checked at startup |

Invalid values stop the server at startup with a message naming the variable and how to fix it.

**`client/.env`**

| Variable            | Default                 | Notes                                                                 |
| ------------------- | ----------------------- | --------------------------------------------------------------------- |
| `API_PROXY_TARGET`  | `http://localhost:4000` | Dev proxy target; must match the API `PORT`. Not bundled into the app |
| `VITE_API_BASE_URL` | `/api`                  | Optional absolute API URL for production on a different origin        |

Real `.env` files are git-ignored. Never commit credentials; commit only the `.env.example` files.

## How the frontend reaches the backend

In development the browser only talks to the Vite server. Vite forwards every `/api/*` request to Express
(see `client/vite.config.ts`), so there is no CORS setup to manage locally. In production, serve the built client
and the API from the same origin, or set `VITE_API_BASE_URL`.

## Project structure

```
smartschedule/
├── package.json            npm workspaces + root scripts
├── client/                 React + Vite + TypeScript
│   ├── vite.config.ts      dev server, /api proxy, "@" alias
│   ├── components.json     shadcn/ui configuration for future components
│   └── src/
│       ├── components/     layout/, common/, dashboard/, ui/ (button, badge)
│       ├── config/         navigation.ts (single source for sidebar + routes)
│       ├── hooks/          backend-status.tsx (health polling)
│       ├── lib/            api.ts, health.ts, utils.ts
│       └── pages/          DashboardPage, PlaceholderPage, NotFoundPage
└── server/                 Express + TypeScript
    └── src/
        ├── config/         env.ts (validation), constants.ts
        ├── middleware/     notFound.ts, errorHandler.ts
        ├── routes/         index.ts, health.ts
        ├── app.ts          builds the Express app (no listening; testable)
        └── index.ts        loads env, starts the server
```

## Adding sections later

Add an entry to `client/src/config/navigation.ts`. Unbuilt sections (`implemented: false`) automatically get a
route, a sidebar item and an empty-state page. When a section is built, set `implemented: true` and register its
real page in `App.tsx`.

## Not implemented yet

Database connection (Mongoose is not installed yet), academic data CRUD, availability, timetable generation,
optimization, reports, authentication, AI features.

