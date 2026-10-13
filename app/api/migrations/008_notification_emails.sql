-- Email for notifications: each one is emailed at most once, and only if it's still
-- unread a couple of minutes after it arrives.
ALTER TABLE notifications ADD COLUMN emailed_at timestamptz;
-- Notifications from before this change aren't emailed.
UPDATE notifications SET emailed_at = now();
CREATE INDEX notifications_email_idx ON notifications (user_id) WHERE emailed_at IS NULL AND read_at IS NULL;
