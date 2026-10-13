import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from '../../../components/Icon.jsx';
import { Avatar } from '../../../components/ui.jsx';
import { dueInfo, priorityInfo } from '../../../lib/format.js';

// A card on the board. Draggable unless the user can only view.
export function SortableCard({ card, disabled, ...props }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `t:${card.id}`,
    data: { type: 'card', columnId: card.columnId },
    disabled,
  });
  // Enter opens the card; Space picks it up to move it with the arrow keys.
  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !isDragging) return props.onOpen?.(card.id);
    listeners?.onKeyDown?.(event);
  };
  return (
    <CardView
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'is-placeholder' : ''}
      card={card}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      {...props}
    />
  );
}

export function CardView({ ref, card, labels, members, onOpen, className = '', overlay, ...rest }) {
  const due = dueInfo(card.dueDate, card.done);
  const priority = priorityInfo(card.priority);
  const cardLabels = card.labelIds.map((id) => labels.get(id)).filter(Boolean);
  const assignees = card.assigneeIds.map((id) => members.get(id)).filter(Boolean);
  const hasFooter = due || card.priority !== 'none' || card.checklistTotal || card.commentCount || card.attachmentCount || card.hasDescription || assignees.length;

  return (
    <article
      ref={ref}
      className={`kcard ${card.done ? 'is-done' : ''} ${overlay ? 'is-overlay' : ''} ${className}`}
      onClick={() => onOpen?.(card.id)}
      aria-label={card.title}
      {...rest}
    >
      {cardLabels.length > 0 && (
        <div className="kcard-labels">
          {cardLabels.map((label) => (
            <span key={label.id} className={`label tone-${label.color}`}>
              {label.name}
            </span>
          ))}
        </div>
      )}
      <p className="kcard-title">{card.title}</p>
      {hasFooter && (
        <div className="kcard-meta">
          {card.priority !== 'none' && (
            <span className={`prio prio-${card.priority}`} title={`${priority.label} priority`}>
              <PriorityIcon value={card.priority} />
            </span>
          )}
          {due && (
            <span className={`badge ${due.tone}`}>
              <Icon name="calendar" size={11} /> {due.label}
            </span>
          )}
          {card.checklistTotal > 0 && (
            <span className={`kmeta ${card.checklistDone === card.checklistTotal ? 'complete' : ''}`} title="Checklist">
              <Icon name="check" size={12} strokeWidth={2.4} /> {card.checklistDone}/{card.checklistTotal}
            </span>
          )}
          {card.hasDescription && (
            <span className="kmeta" title="Has a description">
              <Icon name="list" size={12} />
            </span>
          )}
          {card.commentCount > 0 && (
            <span className="kmeta" title="Comments">
              <Icon name="mail" size={12} /> {card.commentCount}
            </span>
          )}
          {card.attachmentCount > 0 && (
            <span className="kmeta" title="Files">
              <Icon name="clip" size={12} /> {card.attachmentCount}
            </span>
          )}
          {assignees.length > 0 && (
            <span className="avatar-stack">
              {assignees.slice(0, 3).map((m) => (
                <Avatar key={m.id} name={m.name} seed={m.email} size="sm" />
              ))}
              {assignees.length > 3 && <span className="avatar avatar-sm avatar-more">+{assignees.length - 3}</span>}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

// Bars that fill up with priority, like a signal meter; urgent gets an alert mark.
export function PriorityIcon({ value, size = 14 }) {
  if (value === 'urgent') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <rect width="16" height="16" rx="4" fill="currentColor" />
        <rect x="7" y="3.5" width="2" height="6" rx="1" fill="var(--surface)" />
        <rect x="7" y="11" width="2" height="2" rx="1" fill="var(--surface)" />
      </svg>
    );
  }
  const level = { low: 1, medium: 2, high: 3 }[value] ?? 0;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2 + i * 4.5} y={10 - i * 3.5} width="3" height={4 + i * 3.5} rx="1" fill="currentColor" opacity={i < level ? 1 : 0.25} />
      ))}
    </svg>
  );
}
