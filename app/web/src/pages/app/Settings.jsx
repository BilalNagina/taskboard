import { useRef, useState } from 'react';
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
  ['notifications', 'bell', 'Notifications'],
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
          {tab === 'notifications' && <NotificationsForm user={user} />}
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
      <AvatarPicker user={user} name={name} />
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

// Crops the picked image to a centred square and scales it to 256px in the browser, so
// uploads are small and every avatar has the same shape.
function resizeToSquare(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not read that image'))), 'image/jpeg', 0.88);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not an image this browser can read'));
    };
    img.src = url;
  });
}

function AvatarPicker({ user, name }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const toast = useToast();

  async function run(action, message) {
    setBusy(true);
    try {
      const { user: updated } = await action();
      client.setQueryData(keys.me, updated);
      client.invalidateQueries({ queryKey: ['members'] });
      toast(message, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function pick(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    await run(async () => api.uploadAvatar(await resizeToSquare(file)), 'Profile photo updated');
  }

  return (
    <div className="profile-row">
      <Avatar name={name || user.name} seed={user.email} url={user.avatarUrl} size="lg" />
      <div className="profile-row-text">
        <b>{name || user.name}</b>
        <p className="muted small">Member since {new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
        <div className="row-actions">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current.click()} disabled={busy}>
            {busy ? 'Saving…' : user.avatarUrl ? 'Change photo' : 'Upload photo'}
          </button>
          {user.avatarUrl && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => run(api.removeAvatar, 'Profile photo removed')} disabled={busy}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const NOTIFICATION_OPTIONS = [
  ['assigned', 'Assigned to me', 'Someone adds you to a task'],
  ['mentioned', 'Mentions', 'Someone @mentions you in a comment'],
  ['comment', 'Comments on my tasks', 'New comments on tasks you are assigned to'],
  ['due', 'Due dates', 'Your tasks are due today or tomorrow'],
];

const EMAIL_OPTIONS = [
  ['emailAssigned', 'Assigned to me', 'When someone gives you a task'],
  ['emailMentioned', 'Mentions', 'When someone @mentions you in a comment'],
  ['emailComment', 'Comments on my tasks', 'When someone comments on a task assigned to you'],
  ['emailReminders', 'Due date reminders', 'The day before a task assigned to you is due'],
];

function NotificationsForm({ user }) {
  const client = useQueryClient();
  const toast = useToast();
  const prefs = user.notificationPrefs ?? {};
  const isOn = (key) => prefs[key] !== false;

  async function toggle(key) {
    const notificationPrefs = { [key]: !isOn(key) };
    client.setQueryData(keys.me, { ...user, notificationPrefs: { ...prefs, ...notificationPrefs } });
    try {
      const { user: updated } = await api.updateProfile({ notificationPrefs });
      client.setQueryData(keys.me, updated);
    } catch (err) {
      client.setQueryData(keys.me, user);
      toast(err.message, 'error');
    }
  }

  return (
    <div className="settings-form">
      <h2>Notifications</h2>
      <p className="muted small">Choose what appears under the bell. Changes save straight away.</p>
      <ul className="switch-list">
        {NOTIFICATION_OPTIONS.map(([key, label, hint]) => (
          <li key={key}>
            <div>
              <b>{label}</b>
              <span className="faint small">{hint}</span>
            </div>
            <Switch checked={isOn(key)} onChange={() => toggle(key)} label={label} />
          </li>
        ))}
      </ul>
      <h2 style={{ marginTop: 8 }}>Email</h2>
      <p className="muted small">
        Sent a couple of minutes later and bundled together, and only for things you haven&apos;t already seen in the app. A type that&apos;s off
        under the bell isn&apos;t emailed either.
      </p>
      <ul className="switch-list">
        {EMAIL_OPTIONS.map(([key, label, hint]) => (
          <li key={key}>
            <div>
              <b>{label}</b>
              <span className="faint small">{hint}</span>
            </div>
            <Switch checked={isOn(key)} onChange={() => toggle(key)} label={label} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} onClick={onChange}>
      <span />
    </button>
  );
}
