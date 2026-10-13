-- Boards move from belonging to one user to belonging to a workspace that people join
-- with a role. Every existing user gets a personal workspace that keeps their boards.

CREATE TABLE workspaces (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team')),
  created_at timestamptz NOT NULL DEFAULT now(),
  seed_user_id integer -- migration helper, dropped below
);

CREATE TABLE workspace_members (
  workspace_id integer NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_id_idx ON workspace_members (user_id);

INSERT INTO workspaces (name, seed_user_id)
SELECT left(split_part(name, ' ', 1), 60) || '''s workspace', id FROM users;
INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT id, seed_user_id, 'owner' FROM workspaces;

ALTER TABLE boards ADD COLUMN workspace_id integer REFERENCES workspaces (id) ON DELETE CASCADE;
UPDATE boards b SET workspace_id = w.id FROM workspaces w WHERE w.seed_user_id = b.user_id;
ALTER TABLE boards ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE workspaces DROP COLUMN seed_user_id;

-- The board's creator is kept for the record; deleting that user no longer deletes the board.
ALTER TABLE boards RENAME COLUMN user_id TO created_by;
ALTER TABLE boards ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE boards DROP CONSTRAINT boards_user_id_fkey;
ALTER TABLE boards ADD CONSTRAINT boards_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;
DROP INDEX boards_user_id_idx;
CREATE INDEX boards_workspace_id_idx ON boards (workspace_id);

-- Who created each task: reminder emails go to them until tasks get assignees.
ALTER TABLE tasks ADD COLUMN created_by integer REFERENCES users (id) ON DELETE SET NULL;
UPDATE tasks t SET created_by = b.created_by FROM boards b WHERE b.id = t.board_id;

ALTER TABLE users ADD COLUMN theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark'));

-- Only a SHA-256 of each reset token is stored; the token itself exists only in the email.
CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_id_idx ON password_resets (user_id);
