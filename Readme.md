# 🎓 IIIT Surat Modifications

Welcome to the official repository for the IIIT Surat MODs! This is an open-source, student-led platform designed to streamline timetables, course syllabi, and academic materials for our college community.

The architecture and database schema follow the official blueprints outlined in our project design documentation.

---

## 📁 Repository Structure

The project is split into two main sections:
- **`client/`** - The React.js frontend application (The Face).
- **`server/`** - The Node.js & Express.js backend API (The Engine).

---

## 🛠️ Tech Stack
- **Frontend:** React.js, React Router
- **Backend:** Node.js, Express.js
- **Database:** MongoDB (via Mongoose)

---

## 🚀 Getting Started Locally

To run this project on your machine, you will need to open **two separate terminal windows**—one to run the frontend interface and one to run the backend server.

### 1. Frontend Setup (React)
Open your first terminal window and run:
```bash
cd client
npm install
npm run dev
```

### 2. Backend Setup (Express)
Open your second terminal window and run:
```bash
cd server
npm install
npm run dev
```

### 3. Timetable Scheduler (FastAPI + OR-Tools)
The admin timetable generator needs the Python scheduling service running as well. In a third terminal:
```bash
cd server
python -m pip install -r scheduler/requirements.txt
uvicorn main:app --app-dir scheduler --reload --port 8000
```
The Express API forwards admin generation requests to `http://127.0.0.1:8000` by default; set `SCHEDULER_URL` in the server environment to use another address. The generator takes course requirements and classroom capacities entered by the admin, previews up to three CP-SAT alternatives, then replaces the saved timetable for that program, batch, and semester only after confirmation. Admins can opt to apply the entered course requirements across all existing batches in the selected semester; all batch assignments are solved together and saved transactionally. Lab enrollment is not filtered by seat capacity; labs are matched by room type.

### Timetable scopes and What-If scenarios
The timetable page loads its program, semester, batch, and lab-group options from active MongoDB schedule records. Student accounts are restricted server-side to their profile batch and semester; administrators can choose among existing schedule scopes. `GET /api/timetable/imported/options` returns permitted options and `GET /api/timetable/imported/selected` requires a semester and batch (and filters a selected `Group N` on the server).

Administrators can analyze and persist faculty-absence or room-maintenance scenarios through `GET/POST /api/admin/what-if`, then explicitly reject or apply a proposal through `/api/admin/what-if/:id/reject` and `/api/admin/what-if/:id/apply`. If no replacement is available, the admin can mark affected classes as breaks for that date and notify students; this stores dated exceptions and does not cancel the recurring weekly classes. Applying changes uses MongoDB transactions and optimistic `updatedAt` checks, so it requires a replica-set MongoDB deployment. Run `npm run test:timetable:integration` from `server/` to smoke-test the selected-scope and What-If workflows against the configured database.

The current schedule model contains weekly recurring rows and inline lab group labels; it does not store one-off dated overrides, faculty qualifications/availability records, student counts, room capacities, or equipment requirements. Accordingly, What-If analysis infers faculty qualification from existing assignments to the same course, treats the selected date as its weekday, requires explicit acknowledgement before editing the recurring weekly template, and will not mark room reassignment conflict-free without capacity/equipment data. It reports unresolved cases rather than applying an unverified change. A one-date reschedule and fully verified room reassignment require extending those source models first.

To verify the student-weighted CP-SAT objective, run `python -m unittest test_student_objective.py` from `server/scheduler/`.
---

