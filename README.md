# UG CTMS — Tutorial & Claims API

A REST API for running university tutorials: enrolment, attendance, student
feedback and lecturer claims, with server-side role separation for
**administrators**, **lecturers** and **students**.

Built with **Node.js, Express and PostgreSQL**, using JWT sessions and bcrypt
password hashes.

This is the API half of a rewrite of my final-year thesis,
[**CTMS**](https://github.com/pkaycodes/college-tutorial-management-system-thesis).
The thesis is a server-rendered
Django application; this version splits the same domain model into a JSON API
and a React client.

> ### Frontend status
> The API is complete and covers the whole workflow. The React client in
> `frontend/` is still the stock Vite scaffold and is **not yet wired to the
> API** — it is a placeholder for the next stage, not a finished interface.
> Everything below can be driven with `curl` or any HTTP client.

## How the workflow fits together

The rules that make this system more than a CRUD app are enforced in the API,
not in the UI:

- **Attendance is recorded, not assumed.** A student joining a tutorial creates
  a `student_attendance` row; a lecturer starting one creates a
  `lecturer_attendance` row. Both are idempotent, so a double click cannot
  create duplicates.
- **Feedback is gated on attendance.** You cannot review a session you did not
  attend, and the unique constraint on `(tutorial_id, student_id)` allows one
  submission each.
- **Sentiment is computed on write.** A small keyword classifier tags each
  comment `positive`, `neutral` or `negative` alongside the numeric rating. The
  original comment is stored verbatim and never rewritten.
- **Claims are eligibility-checked in SQL.** A tutorial can be claimed only if
  the lecturer attended, at least one student attended, at least one feedback
  entry exists, the session was not cancelled, and it is not already part of a
  pending or approved claim.
- **Rejections must be justified.** The admin review endpoint returns `400` if
  a claim is rejected without a reason.

## API

All routes except login expect `Authorization: Bearer <token>`.

| Method | Endpoint | Role | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | public | Exchange email + password for a JWT |
| `GET` | `/api/student/tutorials` | student | Tutorials for enrolled courses, with attendance/feedback flags |
| `POST` | `/api/tutorials/:id/join` | student | Record attendance, return the meeting link |
| `POST` | `/api/tutorials/:id/feedback` | student | Submit rating + comment (attendance required) |
| `GET` | `/api/lecturer/tutorials` | lecturer | Own tutorials with attendance and feedback counts |
| `POST` | `/api/tutorials/:id/start` | lecturer | Record lecturer attendance |
| `GET` | `/api/lecturer/claims/eligible` | lecturer | Sessions that satisfy every claim rule |
| `POST` | `/api/lecturer/claims` | lecturer | Submit a claim for one or more tutorials |
| `GET` | `/api/admin/claims` | admin | All claims with lecturer and session counts |
| `POST` | `/api/admin/claims/:id/review` | admin | Approve, or reject with a mandatory reason |

## Running it

Requires Node.js 18+ and PostgreSQL 13+.

```bash
git clone https://github.com/pkaycodes/university-tutorial-claims-api.git
cd university-tutorial-claims-api

# 1. Database
createdb ctms_ug
psql -d ctms_ug -f backend/schema.sql
psql -d ctms_ug -f backend/seed.sql

# 2. API
cd backend
cp .env.example .env          # set DB_USER / DB_PASSWORD, and JWT_SECRET
npm install
npm start                     # http://localhost:5000
```

`seed.sql` gives you a working dataset in every tutorial state, including two
sessions that are already eligible for a claim and one pending claim waiting for
review. It resets the demo tables, so never point it at real data.

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@ug.edu.gh` | `admin123` |
| Lecturer | `john.doe@ug.edu.gh` | `lecturer123` |
| Lecturer | `jane.smith@ug.edu.gh` | `lecturer123` |
| Student | `student1@ug.edu.gh` … `student6@ug.edu.gh` | `student123` |

These are seeded development credentials. Change or remove them before
deploying anywhere public.

### Walking the workflow with curl

```bash
API=http://localhost:5000

# Log in as a student
TOKEN=$(curl -s $API/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"student1@ug.edu.gh","password":"student123"}' | jq -r .token)

# See the timetable, then join tutorial 1
curl -s $API/api/student/tutorials -H "Authorization: Bearer $TOKEN" | jq
curl -s -X POST $API/api/tutorials/1/join -H "Authorization: Bearer $TOKEN" | jq

# Leave feedback
curl -s -X POST $API/api/tutorials/1/feedback \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"rating":5,"comment":"Clear and well paced."}' | jq
```

Then log in as `john.doe@ug.edu.gh`, check `/api/lecturer/claims/eligible`,
submit a claim, and review it as `admin@ug.edu.gh`.

## Security notes

- No secret is committed. `JWT_SECRET` comes from the environment; if it is
  missing, the server generates an ephemeral key at startup and warns, so local
  development works while production must set it explicitly.
- Passwords are compared against bcrypt hashes only. There is no universal or
  "magic" password that satisfies any account.
- Role checks happen in the route handlers, not in the client. A student token
  cannot reach lecturer or admin endpoints.
- CORS is currently open (`cors()`) for local development. Restrict it to your
  frontend origin before deploying.

## Project layout

```
ug-ctms/
├── backend/
│   ├── server.js        # the whole API: auth, student, lecturer, admin
│   ├── schema.sql       # PostgreSQL DDL, safe to re-run
│   ├── seed.sql         # demo data covering every tutorial state
│   └── .env.example
└── frontend/            # React + Vite scaffold (not yet connected)
```

## Licence

MIT — see [LICENSE](LICENSE).
