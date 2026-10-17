# SmartSchedule

**Smart College Timetable Management & Optimization System**

SmartSchedule is a college timetable management and optimization system designed for IIIT Surat. Its long-term goal is to help generate conflict-free academic schedules by accounting for faculty availability, classroom capacity, student batches, and course requirements, while reducing idle time and improving resource utilization.

> **Current Status: Phase 1 | Project Foundation**
>
> The initial application shell, Express API health check, and frontend-to-backend communication are implemented. Academic data management, timetable generation, optimization, authentication, and database connectivity are planned for future phases.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Problem Statement](#problem-statement)
- [Planned Features](#planned-features)
- [Technology Stack](#technology-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Available Commands](#available-commands)
- [Environment Configuration](#environment-configuration)
- [Frontend and Backend Communication](#frontend-and-backend-communication)
- [Project Structure](#project-structure)
- [Development Roadmap](#development-roadmap)
- [Current Limitations](#current-limitations)
- [Contributing](#contributing)
- [License](#license)

---

## Project Overview

Creating an effective college timetable involves coordinating multiple interconnected constraints:

- Faculty availability and teaching workload
- Classroom and laboratory capacity
- Student batches, branches, and semesters
- Course requirements and session durations
- Conflicts between faculty, rooms, and student groups
- Efficient use of available time slots and academic resources

SmartSchedule aims to bring these constraints into a single system, making academic scheduling more systematic, transparent, and efficient.

The project is being developed incrementally, starting with the application foundation before introducing academic data management, scheduling constraints, and timetable optimization.

## Problem Statement

Develop an intelligent system that generates conflict-free college timetables by considering faculty availability, classroom capacity, student batches, and course requirements.

The system should optimize schedules to minimize idle time, balance workloads, and maximize resource utilization.

## Planned Features

The following capabilities represent the intended project direction. They are not all implemented yet.

### 1. Academic Data Management
- Manage branches, academic years, semesters, and student batches.
- Maintain course and subject information.
- Manage faculty profiles and teaching assignments.
- Maintain classroom and laboratory details.

### 2. Scheduling Constraints
- Define working days, time slots, breaks, and holidays.
- Configure faculty availability and workload limits.
- Account for room capacity and facility requirements.
- Prevent faculty, classroom, and student-batch conflicts.

### 3. Intelligent Timetable Generation
- Generate schedules that satisfy mandatory constraints.
- Assign courses to suitable time slots and rooms.
- Identify infeasible scheduling requirements.
- Validate generated schedules independently.

### 4. Timetable Optimization
- Reduce unnecessary gaps in student schedules.
- Balance faculty teaching workloads.
- Improve classroom and laboratory utilization.
- Compare alternative schedules using transparent quality metrics.

### 5. Timetable Management
- View schedules by batch, faculty, or classroom.
- Support controlled manual edits.
- Validate changes against scheduling constraints.
- Maintain draft and published timetable versions.

### 6. Advanced Scheduling Assistance
- Explain scheduling conflicts and infeasible requirements.
- Explore hypothetical changes without modifying the original schedule.
- Repair schedules while minimizing unnecessary changes.
- Support academic data import, timetable export, and analytics.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 |
| Development Server and Bundler | Vite |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Backend | Node.js |
| API Framework | Express 4 |
| Environment Validation | Zod |
| Planned Database | MongoDB |
| Planned ODM | Mongoose |
| Testing | Node.js built-in test runner |

**Note:** MongoDB and Mongoose are planned for a later phase. Database connectivity is not implemented in the current foundation.

---

## Prerequisites

Install the following before running the project:

- **Node.js:** Version 22.12 or newer
- **npm:** Version 10 or newer
- **Git:** Optional, for version control

Verify your installations:

```bash
node -v
npm -v
git --version
```

MongoDB is not required for the current phase.

---

## Getting Started

### 1. Clone the repository

If you are setting up the project from GitHub:

```bash
git clone <your-repository-url>
cd SmartSchedule
```

Replace `<your-repository-url>` with your actual GitHub repository URL.

If you already have the project locally, open a terminal in the repository root instead.

### 2. Install dependencies

Run this command from the root directory:

```bash
npm install
```

The project uses npm workspaces to manage the frontend and backend dependencies.

### 3. Configure environment variables (optional)

Environment files are optional during Phase 1 because the application has default configuration values.

To create local environment files:

**macOS / Linux**

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

**Windows PowerShell**

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
```

Review the environment variables before changing their values.

### 4. Start the application

From the repository root:

```bash
npm run dev
```

This starts both the backend API and the frontend development server.

Open the application at:

**Frontend:** http://localhost:5173

**Backend health check:** http://localhost:4000/api/health

The dashboard includes an API status indicator. If the backend becomes unavailable, the interface displays an unreachable status and provides a retry option. Once the API becomes available again, the frontend can reconnect.

### 5. Run the applications separately (optional)

To start the backend in one terminal:

```bash
npm run dev:server
```

To start the frontend in another terminal:

```bash
npm run dev:client
```

Keep both processes running while developing the application.

---

## Available Commands

Run these commands from the repository root.

| Command | Description |
|---|---|
| `npm install` | Install dependencies for the workspaces |
| `npm run dev` | Start frontend and backend together |
| `npm run dev:client` | Start the frontend development server |
| `npm run dev:server` | Start the backend development server |
| `npm run build` | Build the frontend and backend |
| `npm run typecheck` | Type-check both projects |
| `npm test` | Run the configured API tests |
| `npm run start -w server` | Start the compiled backend after building |

---

## Environment Configuration

### Backend: `server/.env`

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment: development, test, or production |
| `PORT` | `4000` | Port used by the Express API |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Frontend origin allowed by the CORS configuration |
| `MONGODB_URI` | Unset | Optional in Phase 1; its format is validated if provided, but the database is not connected |

Invalid environment values cause the server to report a configuration error at startup.

### Frontend: `client/.env`

| Variable | Default | Description |
|---|---|---|
| `API_PROXY_TARGET` | `http://localhost:4000` | Backend target for the Vite development proxy |
| `VITE_API_BASE_URL` | `/api` | API base URL used by the frontend |

The development proxy target should match the port on which the backend is running.

**Security:** Never commit real credentials, API keys, or secrets. Commit the example environment files instead of your personal `.env` files.

---

## Frontend and Backend Communication

During local development, the frontend sends API requests to the Vite development server. Requests beginning with `/api` are forwarded to the Express backend through the proxy configured in `client/vite.config.ts`.

This provides a straightforward local development setup without requiring the browser to communicate directly with a separate backend origin.

The backend exposes a health-check endpoint:

```http
GET /api/health
```

You can test it by opening:

http://localhost:4000/api/health

The frontend uses the health-check endpoint to determine whether the backend is reachable.

For production deployment, configure the frontend and backend to use the same origin or provide an appropriate API base URL and server configuration.

---

## Project Structure

```text
SmartSchedule/
├── package.json
│   └── Root npm workspaces and shared scripts
│
├── client/
│   ├── vite.config.ts
│   │   └── Vite configuration, API proxy, and path alias
│   ├── components.json
│   │   └── shadcn/ui configuration
│   └── src/
│       ├── components/
│       │   ├── layout/
│       │   ├── common/
│       │   ├── dashboard/
│       │   └── ui/
│       ├── config/
│       │   └── navigation.ts
│       ├── hooks/
│       │   └── backend-status.tsx
│       ├── lib/
│       │   ├── api.ts
│       │   ├── health.ts
│       │   └── utils.ts
│       └── pages/
│           ├── DashboardPage
│           ├── PlaceholderPage
│           └── NotFoundPage
│
└── server/
    └── src/
        ├── config/
        │   ├── env.ts
        │   └── constants.ts
        ├── middleware/
        │   ├── notFound.ts
        │   └── errorHandler.ts
        ├── routes/
        │   ├── index.ts
        │   └── health.ts
        ├── app.ts
        │   └── Express application configuration
        └── index.ts
            └── Server startup
```

*The tree highlights the main application files. Some filenames may have extensions such as `.tsx` or `.ts`, and additional configuration files may exist in the repository.*

### Architecture Notes

- **`client/src/config/navigation.ts`:** Central configuration for sidebar navigation and application routes.
- **`client/src/hooks/backend-status.tsx`:** Tracks the backend health status for the frontend.
- **`client/src/lib/api.ts`:** Shared API communication utilities.
- **`server/src/config/env.ts`:** Validates environment configuration.
- **`server/src/routes/health.ts`:** Defines the backend health-check endpoint.
- **`server/src/app.ts`:** Configures the Express application separately from server startup, making it easier to test.
- **`server/src/index.ts`:** Loads configuration and starts the server.

---

## Development Roadmap

SmartSchedule is being developed in phases to keep the architecture understandable, testable, and maintainable.

| Phase | Focus | Status |
|---|---|---|
| Phase 1 | Project setup, application shell, API health check, and frontend-backend communication | In progress / foundation implemented |
| Phase 2 | Academic data management and CRUD operations | Planned |
| Phase 3 | Calendar configuration, availability, and scheduling constraints | Planned |
| Phase 4 | Initial conflict-free timetable generation | Planned |
| Phase 5 | Timetable optimization and candidate comparison | Planned |
| Phase 6 | Timetable editing, publishing, and version management | Planned |
| Phase 7 | Conflict explanations, what-if simulations, and schedule repair | Planned |
| Phase 8 | Data import/export and analytics | Planned |
| Phase 9 | Authentication, testing, security, and production readiness | Planned |

The roadmap may evolve as requirements are validated and the system develops.

---

## Current Limitations

The current version focuses exclusively on the project foundation.

The following capabilities are not implemented yet:

- MongoDB connection and persistent academic records
- Academic data CRUD operations
- Faculty availability and workload scheduling
- Classroom and laboratory allocation
- Timetable generation and constraint solving
- Timetable optimization and quality scoring
- Manual schedule editing and publishing
- Reports, analytics, and data import/export
- Authentication and role-based access control
- AI-assisted scheduling features

The application should not yet be considered a functional timetable generator.

---

## Contributing

SmartSchedule is being developed incrementally. Contributions should preserve the existing architecture and focus on the currently active development phase.

Before submitting changes:

1. Understand the existing implementation.
2. Keep changes focused and avoid unnecessary refactoring.
3. Run the relevant type checks, builds, and tests.
4. Update documentation when behavior or configuration changes.
5. Never commit credentials or other sensitive configuration.

For new modules, prefer reusable components, clear API boundaries, server-side validation, and explicit error handling.

---

## License

No license has been specified yet.

Until a license is added to the repository, permissions for reuse, modification, and redistribution should not be assumed. Add an appropriate `LICENSE` file when the project is ready to establish its licensing terms.

