// Bell with an unread count; opens a list of recent notifications.
// The list is rendered at the end of <body>, positioned next to the bell, because the
// sidebar scrolls (overflow) and would otherwise crop anything wider than itself.

const MENU_WIDTH = 380;
const GAP = 8;

// Below the bell, starting at its left edge, nudged back inside the window if needed.
function placeMenu(button) {
  const rect = button.getBoundingClientRect();
  const width = Math.min(MENU_WIDTH, window.innerWidth - 2 * GAP);
  const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - width - GAP));
  const top = rect.bottom + 6;
  return { left, top, width, maxHeight: window.innerHeight - top - GAP };
}
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';
import { keys, useNotifications, useUnreadCount } from '../lib/queries.js';
import Icon from './Icon.jsx';
import { Avatar } from './ui.jsx';

function sentence(n) {
  const task = `“${n.taskTitle ?? 'a task'}”`;
  const who = n.actor?.name ?? 'Someone';
  switch (n.type) {
    case 'assigned':
      return <><b>{who}</b> assigned you to {task}</>;
    case 'mentioned':
      return <><b>{who}</b> mentioned you on {task}</>;
    case 'comment':
      return <><b>{who}</b> commented on {task}</>;
    case 'due':
      return <>{task} is {n.data?.when ?? 'due soon'}</>;
    default:
      return <>{who} updated {task}</>;
  }
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [position, setPosition] = useState(null);
  const { data: count } = useUnreadCount();
  const { data, isPending } = useNotifications(open);
  const client = useQueryClient();
  const navigate = useNavigate();
  const unread = count?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    client.invalidateQueries({ queryKey: keys.notifications });
    const onClick = (e) => !ref.current?.contains(e.target) && !menuRef.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Re-place the menu when it opens and whenever the window changes size or scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => setPosition(placeMenu(buttonRef.current));
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Read state is a nicety: if saving it fails, the list simply refreshes as it was.
  async function markRead(ids) {
    try {
      const { unread: left } = await api.markRead(ids);
      client.setQueryData(keys.unread, { unread: left });
    } catch {
      // Ignored on purpose; the next poll shows the true count.
    }
    client.invalidateQueries({ queryKey: keys.notifications });
  }

  async function openNotification(n) {
    setOpen(false);
    if (!n.read) markRead([n.id]);
    if (n.taskId && n.boardId) navigate(`/app/boards/${n.boardId}?task=${n.taskId}`);
  }

  return (
    <div className="bell" ref={ref}>
      <button ref={buttonRef} className="icon-btn bell-button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          className="menu bell-menu"
          role="dialog"
          aria-label="Notifications"
          style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
        >
          <div className="bell-head">
            <b>Notifications</b>
            {unread > 0 && (
              <button className="link-inline small" onClick={() => markRead()}>
                Mark all as read
              </button>
            )}
          </div>
          <div className="bell-list">
            {isPending && <div className="page-loading" style={{ minHeight: 80 }}><span className="spinner" /></div>}
            {data?.items.length === 0 && (
              <div className="bell-empty">
                <Icon name="bell" size={22} />
                <p>You&apos;re all caught up.</p>
                <span className="faint small">Assignments, mentions, comments on your tasks and due dates show up here.</span>
              </div>
            )}
            {data?.items.map((n) => (
              <button key={n.id} className={`bell-item ${n.read ? '' : 'is-unread'}`} onClick={() => openNotification(n)}>
                {n.actor ? (
                  <Avatar name={n.actor.name} seed={n.actor.email} url={n.actor.avatarUrl} size="sm" />
                ) : (
                  <span className="avatar avatar-sm bell-due"><Icon name="clock" size={12} /></span>
                )}
                <span className="bell-text">
                  <span>{sentence(n)}</span>
                  {n.data?.excerpt && <span className="bell-excerpt">{n.data.excerpt}</span>}
                  <span className="faint small">
                    {n.boardName ? `${n.boardName} · ` : ''}
                    {timeAgo(n.createdAt)}
                  </span>
                </span>
                {!n.read && <span className="bell-dot" aria-label="Unread" />}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
