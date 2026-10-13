-- Kanban columns, task details (priority, description, labels, assignees, checklists,
-- comments), workspace invites, and the activity log.

-- ---------------------------------------------------------------- columns

CREATE TABLE board_columns (
  id serial PRIMARY KEY,
  board_id integer NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  position integer NOT NULL,
  -- Cards in a "done" column count as completed.
  is_done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX board_columns_board_idx ON board_columns (board_id, position);

INSERT INTO board_columns (board_id, name, position, is_done)
SELECT b.id, c.name, c.position, c.is_done
  FROM boards b
 CROSS JOIN (VALUES ('To do', 0, false), ('In progress', 1, false), ('Done', 2, true)) AS c (name, position, is_done);

-- ---------------------------------------------------------------- task fields

-- No ON DELETE action on column_id: a column can only be deleted once its cards have
-- moved elsewhere (deleting a whole board still cascades through both tables).
ALTER TABLE tasks
  ADD COLUMN column_id integer REFERENCES board_columns (id),
  ADD COLUMN position integer NOT NULL DEFAULT 0,
  ADD COLUMN priority text NOT NULL DEFAULT 'none' CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')),
  ADD COLUMN description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  ADD COLUMN completed_at timestamptz;

UPDATE tasks t SET column_id = c.id
  FROM board_columns c
 WHERE c.board_id = t.board_id AND c.position = CASE WHEN t.done THEN 2 ELSE 0 END;
UPDATE tasks t SET position = s.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY column_id ORDER BY id) - 1 AS rn FROM tasks) s
 WHERE s.id = t.id;
UPDATE tasks SET completed_at = updated_at WHERE done;
ALTER TABLE tasks ALTER COLUMN column_id SET NOT NULL;
CREATE INDEX tasks_column_position_idx ON tasks (column_id, position);

-- ---------------------------------------------------------------- labels and assignees

CREATE TABLE labels (
  id serial PRIMARY KEY,
  board_id integer NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
  color text NOT NULL CHECK (color IN ('gray', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink')),
  UNIQUE (board_id, name)
);

INSERT INTO labels (board_id, name, color)
SELECT b.id, l.name, l.color
  FROM boards b
 CROSS JOIN (VALUES ('Bug', 'red'), ('Feature', 'blue'), ('Design', 'teal'), ('Research', 'violet')) AS l (name, color);

CREATE TABLE task_labels (
  task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  label_id integer NOT NULL REFERENCES labels (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE task_assignees (
  task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX task_assignees_user_idx ON task_assignees (user_id);

-- ---------------------------------------------------------------- checklists and comments

CREATE TABLE checklist_items (
  id serial PRIMARY KEY,
  task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  done boolean NOT NULL DEFAULT false,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checklist_items_task_idx ON checklist_items (task_id, position);

CREATE TABLE comments (
  id serial PRIMARY KEY,
  task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id integer REFERENCES users (id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  -- Users mentioned with @, resolved when the comment is posted.
  mentions integer[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_task_idx ON comments (task_id, id);

-- ---------------------------------------------------------------- invites

CREATE TABLE invites (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
  -- Only a SHA-256 of the invite token is stored; the token itself is in the link.
  token_hash text NOT NULL UNIQUE,
  invited_by integer REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz
);
CREATE UNIQUE INDEX invites_one_pending_idx ON invites (workspace_id, email) WHERE accepted_at IS NULL;

-- ---------------------------------------------------------------- activity

CREATE TABLE activity (
  id bigserial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  board_id integer REFERENCES boards (id) ON DELETE CASCADE,
  task_id integer REFERENCES tasks (id) ON DELETE SET NULL,
  actor_id integer REFERENCES users (id) ON DELETE SET NULL,
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_board_idx ON activity (board_id, id DESC);
CREATE INDEX activity_task_idx ON activity (task_id, id DESC);
CREATE INDEX activity_workspace_idx ON activity (workspace_id, id DESC);
