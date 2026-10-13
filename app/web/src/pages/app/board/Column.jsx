import { useState } from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from '../../../components/Icon.jsx';
import { Dropdown } from '../../../components/ui.jsx';
import { SortableCard } from './Card.jsx';

export function SortableColumn({ column, cards, total, canEdit, dragDisabled, onAddCard, onRename, onToggleDone, onDelete, ...cardProps }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `c:${column.id}`,
    data: { type: 'column' },
    disabled: !canEdit || dragDisabled,
  });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);

  async function submitCard(event) {
    event?.preventDefault();
    const text = title.trim();
    if (!text) return setAdding(false);
    setTitle('');
    await onAddCard(column.id, text);
  }

  async function submitName() {
    setRenaming(false);
    if (name.trim() && name.trim() !== column.name) await onRename(column, name.trim());
    else setName(column.name);
  }

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`kcol ${isDragging ? 'is-placeholder' : ''}`}
      aria-label={column.name}
    >
      <header className="kcol-head" {...attributes} {...listeners}>
        {renaming ? (
          <input
            className="input input-sm"
            value={name}
            autoFocus
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onBlur={submitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitName();
              if (e.key === 'Escape') {
                setName(column.name);
                setRenaming(false);
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <h2 onDoubleClick={() => canEdit && setRenaming(true)}>
            {column.isDone && <Icon name="check" size={14} strokeWidth={2.4} className="kcol-done" />}
            {column.name}
            <span className="kcol-count">{total !== undefined && total !== cards.length ? `${cards.length} of ${total}` : cards.length}</span>
          </h2>
        )}
        {canEdit && (
          <Dropdown
            align="right"
            trigger={({ toggle, open }) => (
              <button className="icon-btn" onPointerDown={(e) => e.stopPropagation()} onClick={toggle} aria-expanded={open} aria-label={`${column.name} options`}>
                <Icon name="more" size={16} />
              </button>
            )}
          >
            <button className="menu-item" onClick={() => setRenaming(true)}>
              <Icon name="edit" size={16} /> Rename
            </button>
            <button className="menu-item" onClick={() => onToggleDone(column)}>
              <Icon name="check" size={16} /> {column.isDone ? 'Stop counting as done' : 'Cards here count as done'}
            </button>
            <hr />
            <button className="menu-item danger" onClick={() => onDelete(column)}>
              <Icon name="trash" size={16} /> Delete column
            </button>
          </Dropdown>
        )}
      </header>

      <SortableContext items={cards.map((c) => `t:${c.id}`)} strategy={verticalListSortingStrategy}>
        <div className="kcol-cards">
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} disabled={!canEdit || dragDisabled} {...cardProps} />
          ))}
          {cards.length === 0 && !adding && <div className="kcol-empty">{dragDisabled ? 'No matching cards' : canEdit ? 'Drop cards here' : 'No cards'}</div>}
        </div>
      </SortableContext>

      {canEdit &&
        (adding ? (
          <form className="kcol-add-form" onSubmit={submitCard}>
            <textarea
              className="input"
              rows={2}
              value={title}
              autoFocus
              maxLength={200}
              placeholder="What needs doing?"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) submitCard(e);
                if (e.key === 'Escape') setAdding(false);
              }}
            />
            <div className="kcol-add-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim()}>
                Add card
              </button>
              <button type="button" className="icon-btn" onClick={() => setAdding(false)} aria-label="Cancel">
                <Icon name="x" size={16} />
              </button>
            </div>
          </form>
        ) : (
          <button className="kcol-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Add a card
          </button>
        ))}
    </section>
  );
}
