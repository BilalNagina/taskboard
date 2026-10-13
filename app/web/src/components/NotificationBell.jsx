// Bell with an unread count; opens a list of recent notifications.
import { useEffect, useRef, useState } from 'react';
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
  const { data: count } = useUnreadCount();
  const { data, isPending } = useNotifications(open);
  const client = useQueryClient();
  const navigate = useNavigate();
  const unread = count?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    client.invalidateQueries({ queryKey: keys.notifications });
    const onClick = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function markRead(ids) {
    const { unread: left } = await api.markRead(ids);
    client.setQueryData(keys.unread, { unread: left });
    client.invalidateQueries({ queryKey: keys.notifications });
  }

  async function openNotification(n) {
    setOpen(false);
    if (!n.read) markRead([n.id]);
    if (n.taskId && n.boardId) navigate(`/app/boards/${n.boardId}?task=${n.taskId}`);
  }

  return (
    <div className="bell" ref={ref}>
      <button className="icon-btn bell-button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="menu bell-menu" role="dialog" aria-label="Notifications">
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
        </div>
      )}
    </div>
  );
}
