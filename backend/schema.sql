-- UG CTMS - database schema (PostgreSQL)
--
-- Apply with:
--   createdb ctms_ug
--   psql -d ctms_ug -f backend/schema.sql
--
-- Safe to re-run: every statement is guarded with IF NOT EXISTS.

-- ---------------------------------------------------------------
-- People
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  name       TEXT        NOT NULL,
  email      TEXT        NOT NULL UNIQUE,
  password   TEXT        NOT NULL,          -- bcrypt hash, never plaintext
  role       TEXT        NOT NULL CHECK (role IN ('admin', 'lecturer', 'student')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS students (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  student_id TEXT    NOT NULL UNIQUE,
  programme  TEXT,
  level      INTEGER
);

CREATE TABLE IF NOT EXISTS lecturers (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  lecturer_id TEXT    NOT NULL UNIQUE,
  department  TEXT
);

-- ---------------------------------------------------------------
-- Teaching
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS courses (
  id          SERIAL PRIMARY KEY,
  course_code TEXT NOT NULL UNIQUE,
  course_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_enrollments (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
  PRIMARY KEY (student_id, course_id)
);

CREATE TABLE IF NOT EXISTS tutorials (
  id         SERIAL PRIMARY KEY,
  course_id  INTEGER NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,
  lecturer_id INTEGER NOT NULL REFERENCES lecturers(id) ON DELETE CASCADE,
  date       DATE    NOT NULL,
  start_time TIME    NOT NULL,
  end_time   TIME    NOT NULL,
  teams_link TEXT,
  status     TEXT    NOT NULL DEFAULT 'Upcoming'
             CHECK (status IN ('Upcoming', 'Active', 'Completed', 'Cancelled'))
);

-- ---------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS student_attendance (
  id          SERIAL PRIMARY KEY,
  tutorial_id INTEGER NOT NULL REFERENCES tutorials(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tutorial_id, student_id)
);

CREATE TABLE IF NOT EXISTS lecturer_attendance (
  id          SERIAL PRIMARY KEY,
  tutorial_id INTEGER NOT NULL REFERENCES tutorials(id)  ON DELETE CASCADE,
  lecturer_id INTEGER NOT NULL REFERENCES lecturers(id)  ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tutorial_id, lecturer_id)
);

-- ---------------------------------------------------------------
-- Feedback
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feedback (
  id          SERIAL PRIMARY KEY,
  tutorial_id INTEGER NOT NULL REFERENCES tutorials(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  sentiment   TEXT NOT NULL DEFAULT 'neutral'
              CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One submission per student per tutorial; the API relies on this
  -- constraint to return a friendly 400 instead of a duplicate row.
  UNIQUE (tutorial_id, student_id)
);

-- ---------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS claims (
  id               SERIAL PRIMARY KEY,
  lecturer_id      INTEGER NOT NULL REFERENCES lecturers(id) ON DELETE CASCADE,
  status           TEXT    NOT NULL DEFAULT 'Pending'
                   CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  rejection_reason TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at      TIMESTAMPTZ,
  reviewed_by      INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS claim_items (
  id          SERIAL PRIMARY KEY,
  claim_id    INTEGER NOT NULL REFERENCES claims(id)    ON DELETE CASCADE,
  tutorial_id INTEGER NOT NULL REFERENCES tutorials(id) ON DELETE CASCADE,
  UNIQUE (claim_id, tutorial_id)
);

-- ---------------------------------------------------------------
-- Indexes for the queries the API actually runs
-- ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_tutorials_lecturer   ON tutorials (lecturer_id);
CREATE INDEX IF NOT EXISTS idx_tutorials_course     ON tutorials (course_id);
CREATE INDEX IF NOT EXISTS idx_tutorials_date       ON tutorials (date);
CREATE INDEX IF NOT EXISTS idx_feedback_tutorial    ON feedback (tutorial_id);
CREATE INDEX IF NOT EXISTS idx_stu_att_tutorial     ON student_attendance (tutorial_id);
CREATE INDEX IF NOT EXISTS idx_claims_lecturer      ON claims (lecturer_id);
CREATE INDEX IF NOT EXISTS idx_claim_items_tutorial ON claim_items (tutorial_id);
