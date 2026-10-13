import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { Avatar, Field, PasswordInput } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { keys, useMe } from '../../lib/queries.js';
import { applyTheme } from '../../lib/theme.js';
import { PasswordStrength } from '../auth/AuthPages.jsx';

const TABS = [
  ['profile', 'user', 'Profile'],
  ['security', 'lock', 'Password'],
  ['appearance', 'sun', 'Appearance'],
];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'profile';
  const { data: user } = useMe();
  if (!user) return null;

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted page-sub">Your profile, password and how Tasklane looks.</p>
        </div>
      </header>
      <div className="settings">
        <nav className="settings-tabs" aria-label="Settings sections">
          {TABS.map(([id, icon, label]) => (
            <button key={id} className={`nav-item ${tab === id ? 'active' : ''}`} onClick={() => setParams({ tab: id })}>
              <Icon name={icon} /> {label}
            </button>
          ))}
        </nav>
        <div className="settings-panel card" key={tab}>
          {tab === 'profile' && <ProfileForm user={user} />}
          {tab === 'security' && <PasswordForm />}
          {tab === 'appearance' && <AppearanceForm user={user} />}
        </div>
      </div>
    </div>
  );
}

function ProfileForm({ user }) {
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const toast = useToast();

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const { user: updated } = await api.updateProfile({ name });
      client.setQueryData(keys.me, updated);
      toast('Profile saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="settings-form">
      <h2>Profile</h2>
      <div className="profile-row">
        <Avatar name={name || user.name} seed={user.email} size="lg" />
        <div>
          <b>{name || user.name}</b>
          <p className="muted small">Member since {new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
        </div>
      </div>
      <Field label="Full name">
        {(props) => <input {...props} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />}
      </Field>
      <Field label="Email" hint="Your email is your login and can't be changed here.">
        {(props) => <input {...props} className="input" value={user.email} disabled />}
      </Field>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || name.trim() === user.name}>
          Save changes
        </button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const [values, setValues] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const mismatch = values.confirm && values.next !== values.confirm;
  const bind = (key) => ({ value: values[key], onChange: (e) => setValues({ ...values, [key]: e.target.value }) });

  async function save(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.changePassword(values.current, values.next);
      setValues({ current: '', next: '', confirm: '' });
      toast('Password changed. Other devices have been signed out.', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="settings-form">
      <h2>Change password</h2>
      <p className="muted small">Changing your password signs you out everywhere except this browser.</p>
      <Field label="Current password">
        {(props) => <PasswordInput {...props} {...bind('current')} autoComplete="current-password" required />}
      </Field>
      <Field label="New password">
        {(props) => (
          <>
            <PasswordInput {...props} {...bind('next')} autoComplete="new-password" minLength={8} maxLength={128} required />
            <PasswordStrength password={values.next} />
          </>
        )}
      </Field>
      <Field label="Confirm new password" error={mismatch ? "Passwords don't match" : ''}>
        {(props) => <PasswordInput {...props} {...bind('confirm')} autoComplete="new-password" required />}
      </Field>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || mismatch}>
          Update password
        </button>
      </div>
    </form>
  );
}

const THEME_OPTIONS = [
  ['system', 'monitor', 'System', 'Follows your device setting'],
  ['light', 'sun', 'Light', 'Bright and clear'],
  ['dark', 'moon', 'Dark', 'Easy on the eyes at night'],
];

function AppearanceForm({ user }) {
  const client = useQueryClient();
  const toast = useToast();

  async function choose(theme) {
    applyTheme(theme);
    client.setQueryData(keys.me, { ...user, theme });
    try {
      const { user: updated } = await api.updateProfile({ theme });
      client.setQueryData(keys.me, updated);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="settings-form">
      <h2>Appearance</h2>
      <p className="muted small">Saved to your account, so it follows you to other devices.</p>
      <div className="theme-cards" role="radiogroup" aria-label="Theme">
        {THEME_OPTIONS.map(([value, icon, label, hint]) => (
          <button key={value} role="radio" aria-checked={user.theme === value} className={`theme-card ${user.theme === value ? 'active' : ''}`} onClick={() => choose(value)}>
            <span className={`theme-preview preview-${value}`}>
              <span />
              <span />
              <span />
            </span>
            <span className="theme-card-label">
              <Icon name={icon} size={16} /> {label}
            </span>
            <span className="faint small">{hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
