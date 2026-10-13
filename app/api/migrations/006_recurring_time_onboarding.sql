-- Recurring tasks, time tracking, and first-run onboarding.

-- A repeating task makes its next occurrence when it's completed (the setting moves to
-- the new task, so reopening and completing the old one again doesn't make another).
ALTER TABLE tasks ADD COLUMN repeat text CHECK (repeat IN ('daily', 'weekdays', 'weekly', 'monthly'));

-- Set when someone finishes or skips the welcome tour. Existing accounts skip it.
ALTER TABLE users ADD COLUMN onboarded_at timestamptz;
UPDATE users SET onboarded_at = now();

CREATE TABLE time_entries (
  id serial PRIMARY KEY,
  task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The person's own calendar day the time counts towards.
  day date NOT NULL,
  -- Null while the timer is still running.
  minutes integer CHECK (minutes BETWEEN 1 AND 1440),
  -- Set for timers; null for time entered by hand.
  started_at timestamptz,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minutes IS NOT NULL OR started_at IS NOT NULL)
);
CREATE INDEX time_entries_task_idx ON time_entries (task_id);
CREATE INDEX time_entries_day_idx ON time_entries (day);
-- One running timer per person.
CREATE UNIQUE INDEX time_entries_running_idx ON time_entries (user_id) WHERE minutes IS NULL;
