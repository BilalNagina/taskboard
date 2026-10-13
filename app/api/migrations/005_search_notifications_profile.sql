-- Full-text search over task titles and descriptions, in-app notifications, and profile
-- extras (avatar, notification preferences).

-- 'simple' rather than 'english': no stemming, so names, codes and non-English words
-- match exactly as typed.
ALTER TABLE tasks
  ADD COLUMN search tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || description)) STORED;
CREATE INDEX tasks_search_idx ON tasks USING gin (search);
CREATE INDEX tasks_due_date_idx ON tasks (due_date) WHERE due_date IS NOT NULL;
CREATE INDEX tasks_completed_at_idx ON tasks (completed_at) WHERE completed_at IS NOT NULL;

CREATE TABLE notifications (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- assigned | mentioned | comment | due
  type text NOT NULL,
  actor_id integer REFERENCES users (id) ON DELETE SET NULL,
  workspace_id integer NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  board_id integer REFERENCES boards (id) ON DELETE CASCADE,
  task_id integer REFERENCES tasks (id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE users
  ADD COLUMN avatar_key text,
  ADD COLUMN avatar_updated_at timestamptz,
  -- Missing keys count as "on", so new notification types default to enabled.
  ADD COLUMN notification_prefs jsonb NOT NULL DEFAULT '{}';
