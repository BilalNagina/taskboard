-- The workspace audit log keeps entries about a board after the board is deleted, the
-- same way entries about a deleted task are kept.
ALTER TABLE activity DROP CONSTRAINT activity_board_id_fkey;
ALTER TABLE activity ADD CONSTRAINT activity_board_id_fkey
  FOREIGN KEY (board_id) REFERENCES boards (id) ON DELETE SET NULL;
