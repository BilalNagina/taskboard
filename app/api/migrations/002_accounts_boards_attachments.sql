CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE boards (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX boards_user_id_idx ON boards (user_id);

-- Tasks created before accounts existed have no owner to move them to.
DELETE FROM tasks;

ALTER TABLE tasks
  ADD COLUMN board_id integer NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  ADD COLUMN due_date date,
  ADD COLUMN reminded_at timestamptz;
CREATE INDEX tasks_board_id_idx ON tasks (board_id);
-- The reminder worker scans this every few minutes; keep the scan to open, unreminded tasks.
CREATE INDEX tasks_reminder_due_idx ON tasks (due_date) WHERE NOT done AND reminded_at IS NULL;

CREATE TABLE attachments (
  id serial PRIMARY KEY,
  task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_task_id_idx ON attachments (task_id);
