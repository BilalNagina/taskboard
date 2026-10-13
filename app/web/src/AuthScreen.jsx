import { useState } from 'react';
import { api } from './api.js';

export default function AuthScreen({ onSignedIn }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = isRegister
        ? await api.register(form.name, form.email, form.password)
        : await api.login(form.email, form.password);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const switchMode = () => {
    setMode(isRegister ? 'login' : 'register');
    setError('');
  };

  return (
    <main className="auth card">
      <div className="brand">
        <span className="logo" aria-hidden="true">✓</span>
        <h1>Taskboard</h1>
      </div>
      <p className="muted">
        {isRegister ? 'Create an account to start organising your work.' : 'Sign in to your boards.'}
      </p>

      <form onSubmit={submit} className="stack">
        {isRegister && (
          <label>
            Name
            <input value={form.name} onChange={update('name')} maxLength={80} autoComplete="name" required />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={update('email')} autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            minLength={isRegister ? 8 : undefined}
            maxLength={128}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
          />
          {isRegister && <span className="hint">At least 8 characters</span>}
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="muted switch">
        {isRegister ? 'Already have an account?' : 'New here?'}{' '}
        <button type="button" className="link" onClick={switchMode}>
          {isRegister ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </main>
  );
}
