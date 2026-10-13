// Small building blocks shared by every page.
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { colourFor, initials } from '../lib/format.js';
import Icon from './Icon.jsx';

export function Logo({ to = '/', compact = false }) {
  return (
    <Link to={to} className="logo" aria-label="Tasklane home">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <rect x="7" y="8" width="5" height="16" rx="2.5" fill="var(--on-accent)" opacity=".55" />
        <rect x="13.5" y="8" width="5" height="11" rx="2.5" fill="var(--on-accent)" opacity=".8" />
        <rect x="20" y="8" width="5" height="7" rx="2.5" fill="var(--on-accent)" />
      </svg>
      {!compact && <span>Tasklane</span>}
    </Link>
  );
}

// A profile picture when there is one, otherwise initials on a colour picked from the email.
export function Avatar({ name, seed, size, url }) {
  const [broken, setBroken] = useState(false);
  const className = `avatar ${size ? `avatar-${size}` : ''}`;
  if (url && !broken) {
    return <img className={`${className} avatar-img`} src={url} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  return (
    <span className={className} style={{ background: colourFor(seed ?? name) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Field({ label, hint, error, aside, children }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {aside}
      </label>
      {typeof children === 'function' ? children({ id, 'aria-invalid': Boolean(error) || undefined }) : children}
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function PasswordInput(props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-wrap">
      <input {...props} type={visible ? 'text' : 'password'} className="input" />
      <button
        type="button"
        className="icon-btn"
        onClick={() => setVisible(!visible)}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} size={16} />
      </button>
    </div>
  );
}

// A button that opens a dropdown menu; closes on outside click or Escape.
export function Dropdown({ trigger, children, align = 'left', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event) => !ref.current?.contains(event.target) && setOpen(false);
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`dropdown ${className}`} ref={ref}>
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open && (
        <div className={`menu menu-${align}`} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function Dialog({ title, description, onClose, wide = false, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {description && <p className="muted small">{description}</p>}
        {children}
      </div>
    </div>
  );
}

// A one-field dialog: "New board", "Rename workspace" and so on.
export function PromptDialog({ title, description, label, initial = '', submitLabel, maxLength = 80, onSubmit, onClose }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} description={description} onClose={onClose}>
      <form onSubmit={submit} style={{ marginTop: 16 }}>
        <Field label={label} error={error}>
          {(props) => (
            <input {...props} className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={maxLength} required />
          )}
        </Field>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({ title, description, confirmLabel, danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Dialog title={title} description={description} onClose={onClose}>
      {error && <p className="alert alert-error" style={{ marginTop: 12 }}>{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={confirm} disabled={busy}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function EmptyState({ icon, title, children, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}
