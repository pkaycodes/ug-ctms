-- UG CTMS - demo data
--
-- Apply after schema.sql:
--   psql -d ctms_ug -f backend/seed.sql
--
-- This file RESETS the demo tables. Never run it against real data.
--
-- Every account below uses a real bcrypt hash of the password shown in the
-- README - there is no "magic password" shortcut in the API.

TRUNCATE claim_items, claims, feedback, lecturer_attendance, student_attendance,
         tutorials, course_enrollments, courses, lecturers, students, users
  RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------
-- Users  (password hashes: admin123 / lecturer123 / student123)
-- ---------------------------------------------------------------

INSERT INTO users (name, email, password, role) VALUES
  ('System Administrator', 'admin@ug.edu.gh',
   '$2b$10$75TC4J/xedkEBk/T1gbkeeYLG4wc/5TPLgtqfwZ87eEywIhS2YRlO', 'admin'),
  ('Dr. John Doe', 'john.doe@ug.edu.gh',
   '$2b$10$UWnHZo0JnO54VpU.iOOdKuC6Z5hlIu3QmoKvoUs1WZ6i9rc3xXAxa', 'lecturer'),
  ('Dr. Jane Smith', 'jane.smith@ug.edu.gh',
   '$2b$10$UWnHZo0JnO54VpU.iOOdKuC6Z5hlIu3QmoKvoUs1WZ6i9rc3xXAxa', 'lecturer'),
  ('Ama Mensah', 'student1@ug.edu.gh',
   '$2b$10$cD0pJ7dEwG9FxqKnsYRUu..qP.g/IwRFsly3JkppUmEJ996Kqg2JO', 'student'),
  ('Kofi Boateng', 'student2@ug.edu.gh',
   '$2b$10$cD0pJ7dEwG9FxqKnsYRUu..qP.g/IwRFsly3JkppUmEJ996Kqg2JO', 'student'),
  ('Yaa Asantewaa', 'student3@ug.edu.gh',
   '$2b$10$cD0pJ7dEwG9FxqKnsYRUu..qP.g/IwRFsly3JkppUmEJ996Kqg2JO', 'student'),
  ('Kwame Nkrumah', 'student4@ug.edu.gh',
   '$2b$10$cD0pJ7dEwG9FxqKnsYRUu..qP.g/IwRFsly3JkppUmEJ996Kqg2JO', 'student'),
  ('Akosua Adjei', 'student5@ug.edu.gh',
   '$2b$10$cD0pJ7dEwG9FxqKnsYRUu..qP.g/IwRFsly3JkppUmEJ996Kqg2JO', 'student'),
  ('Kojo Antwi', 'student6@ug.edu.gh',
   '$2b$10$cD0pJ7dEwG9FxqKnsYRUu..qP.g/IwRFsly3JkppUmEJ996Kqg2JO', 'student');

-- ---------------------------------------------------------------
-- Role profiles
-- ---------------------------------------------------------------

INSERT INTO students (user_id, student_id, programme, level) VALUES
  (4, '11112468', 'BSc Computer Science', 300),
  (5, '11112469', 'BSc Computer Science', 300),
  (6, '11112470', 'BSc Computer Science', 300),
  (7, '11112471', 'BSc Information Technology', 200),
  (8, '11112472', 'BSc Information Technology', 200),
  (9, '11112473', 'BSc Computer Science', 400);

INSERT INTO lecturers (user_id, lecturer_id, department) VALUES
  (2, 'LEC001', 'Computer Science'),
  (3, 'LEC002', 'Computer Science');

-- ---------------------------------------------------------------
-- Courses and enrolment
-- ---------------------------------------------------------------

INSERT INTO courses (course_code, course_name) VALUES
  ('DCIT 205', 'Multimedia and Web Design'),
  ('DCIT 308', 'Data Structures and Algorithms'),
  ('DCIT 318', 'Object-Oriented Programming');

INSERT INTO course_enrollments (student_id, course_id)
SELECT s.id, c.id
FROM students s CROSS JOIN courses c;

-- ---------------------------------------------------------------
-- Tutorials: one of every status, spread around today
-- ---------------------------------------------------------------

INSERT INTO tutorials (course_id, lecturer_id, date, start_time, end_time, teams_link, status) VALUES
  (1, 1, CURRENT_DATE - 7, '10:00', '11:00', 'https://teams.microsoft.com/l/meetup-join/demo-1', 'Completed'),
  (2, 1, CURRENT_DATE - 3, '14:00', '15:00', 'https://teams.microsoft.com/l/meetup-join/demo-2', 'Completed'),
  (2, 1, CURRENT_DATE,     '09:00', '10:00', 'https://teams.microsoft.com/l/meetup-join/demo-3', 'Active'),
  (1, 1, CURRENT_DATE + 2, '11:00', '12:00', 'https://teams.microsoft.com/l/meetup-join/demo-4', 'Upcoming'),
  (1, 1, CURRENT_DATE + 7, '13:00', '14:00', 'https://teams.microsoft.com/l/meetup-join/demo-5', 'Cancelled'),
  (3, 2, CURRENT_DATE - 2, '15:00', '16:00', 'https://teams.microsoft.com/l/meetup-join/demo-6', 'Completed');

-- ---------------------------------------------------------------
-- Attendance and feedback
--
-- Tutorial 1 and 2 are deliberately claim-ready: the lecturer attended,
-- students attended, and feedback exists. Tutorial 3 is still Active and
-- tutorial 6 already sits in a pending claim.
-- ---------------------------------------------------------------

INSERT INTO lecturer_attendance (tutorial_id, lecturer_id) VALUES
  (1, 1), (2, 1), (3, 1), (6, 2);

INSERT INTO student_attendance (tutorial_id, student_id) VALUES
  (1, 1), (1, 2), (1, 3),
  (2, 1), (2, 2), (2, 3), (2, 4),
  (3, 1), (3, 2),
  (6, 1), (6, 2), (6, 5), (6, 6);

INSERT INTO feedback (tutorial_id, student_id, rating, comment, sentiment) VALUES
  (1, 1, 5, 'Great session, the examples were very clear.',        'positive'),
  (1, 2, 4, 'Good tutorial, helpful walkthrough.',                 'positive'),
  (1, 3, 2, 'The audio kept cutting out and it was confusing.',    'negative'),
  (2, 1, 4, 'Well structured and easy to follow.',                 'positive'),
  (2, 2, 3, 'Fine overall, neither especially good nor bad.',      'neutral'),
  (2, 4, 1, 'Terrible connection, difficult to hear anything.',    'negative'),
  (6, 1, 5, 'Excellent explanation of interfaces.',                'positive'),
  (6, 2, 4, 'Best session so far.',                                'positive');

-- ---------------------------------------------------------------
-- One pending claim, ready for an administrator to review
-- ---------------------------------------------------------------

INSERT INTO claims (lecturer_id, status) VALUES (2, 'Pending');

INSERT INTO claim_items (claim_id, tutorial_id) VALUES (1, 6);

-- Keep the sequences in step with the explicit IDs above.
SELECT setval('users_id_seq',     (SELECT MAX(id) FROM users));
SELECT setval('students_id_seq',  (SELECT MAX(id) FROM students));
SELECT setval('lecturers_id_seq', (SELECT MAX(id) FROM lecturers));
SELECT setval('courses_id_seq',   (SELECT MAX(id) FROM courses));
SELECT setval('tutorials_id_seq', (SELECT MAX(id) FROM tutorials));
SELECT setval('claims_id_seq',    (SELECT MAX(id) FROM claims));
SELECT setval('claim_items_id_seq', (SELECT MAX(id) FROM claim_items));
