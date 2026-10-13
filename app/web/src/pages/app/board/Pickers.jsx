// Dropdown pickers used in the task panel.
import { useState } from 'react';
import Icon from '../../../components/Icon.jsx';
import { Avatar, Dropdown } from '../../../components/ui.jsx';
import { LABEL_COLORS, PRIORITIES, priorityInfo } from '../../../lib/format.js';
import { PriorityIcon } from './Card.jsx';

function Option({ selected, onClick, children }) {
  return (
    <button
      className="menu-item"
      role="menuitemcheckbox"
      aria-checked={selected}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
      <span style={{ marginLeft: 'auto', width: 16 }}>{selected && <Icon name="check" size={16} />}</span>
    </button>
  );
}

export function AssigneePicker({ members, value, onChange, disabled }) {
  const selected = members.filter((m) => value.includes(m.id));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <Dropdown
      trigger={({ toggle: open }) => (
        <button className="prop-value" onClick={open} disabled={disabled}>
          {selected.length === 0 ? (
            <span className="faint">Unassigned</span>
          ) : (
            selected.map((m) => (
              <span key={m.id} className="chip">
                <Avatar name={m.name} seed={m.email} size="sm" /> {m.name.split(' ')[0]}
              </span>
            ))
          )}
        </button>
      )}
    >
      <div className="menu-label">Assign to</div>
      {members.map((m) => (
        <Option key={m.id} selected={value.includes(m.id)} onClick={() => toggle(m.id)}>
          <Avatar name={m.name} seed={m.email} size="sm" /> {m.name}
        </Option>
      ))}
    </Dropdown>
  );
}

export function PriorityPicker({ value, onChange, disabled }) {
  const current = priorityInfo(value);
  return (
    <Dropdown
      trigger={({ toggle }) => (
        <button className="prop-value" onClick={toggle} disabled={disabled}>
          <span className={`prio prio-${value}`}>
            <PriorityIcon value={value} />
          </span>
          <span className={value === 'none' ? 'faint' : ''}>{current.label}</span>
        </button>
      )}
    >
      {PRIORITIES.map((p) => (
        <Option key={p.value} selected={value === p.value} onClick={() => onChange(p.value)}>
          <span className={`prio prio-${p.value}`}>
            <PriorityIcon value={p.value} />
          </span>
          {p.label}
        </Option>
      ))}
    </Dropdown>
  );
}

export function LabelPicker({ labels, value, onChange, onCreate, disabled }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const selected = labels.filter((l) => value.includes(l.id));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  async function create(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!name.trim()) return;
    const label = await onCreate({ name: name.trim(), color });
    if (label) {
      onChange([...value, label.id]);
      setName('');
    }
  }

  return (
    <Dropdown
      trigger={({ toggle: open }) => (
        <button className="prop-value" onClick={open} disabled={disabled}>
          {selected.length === 0 ? (
            <span className="faint">No labels</span>
          ) : (
            selected.map((l) => (
              <span key={l.id} className={`label tone-${l.color}`}>
                {l.name}
              </span>
            ))
          )}
        </button>
      )}
    >
      <div className="menu-label">Labels</div>
      {labels.map((l) => (
        <Option key={l.id} selected={value.includes(l.id)} onClick={() => toggle(l.id)}>
          <span className={`label tone-${l.color}`}>{l.name}</span>
        </Option>
      ))}
      <hr />
      <form className="label-create" onSubmit={create} onClick={(e) => e.stopPropagation()}>
        <input className="input input-sm" placeholder="New label" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        <div className="swatches">
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch tone-${c} ${color === c ? 'active' : ''}`}
              onClick={() => setColor(c)}
              aria-label={c}
              aria-pressed={color === c}
            />
          ))}
        </div>
        <button type="submit" className="btn btn-secondary btn-sm btn-block" disabled={!name.trim()}>
          Create label
        </button>
      </form>
    </Dropdown>
  );
}
