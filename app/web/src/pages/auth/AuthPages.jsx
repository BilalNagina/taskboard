import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { Field, Logo, PasswordInput } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queries.js';

function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth">
      <div className="auth-main">
        <div className="auth-top">
          <Logo />
        </div>
        <div className="auth-form-wrap">
          <h1>{title}</h1>
          {subtitle && <p className="muted auth-sub">{subtitle}</p>}
          {children}
          {footer && <p className="auth-footer muted">{footer}</p>}
        </div>
      </div>
      <aside className="auth-aside" aria-hidden="true">
        <div className="auth-aside-inner">
          <p className="auth-aside-quote">“Every task in its lane. Every team in sync.”</p>
          <ul>
            <li>
              <Icon name="board" size={18} /> Boards with drag-and-drop
            </li>
            <li>
              <Icon name="users" size={18} /> Workspaces, invites and roles
            </li>
            <li>
              <Icon name="calendar" size={18} /> Calendar, reminders and dashboards
            </li>
            <li>
              <Icon name="shield" size={18} /> Encrypted backups every night
            </li>
          </ul>
          <div className="auth-aside-card">
            <span className="mock-label tone-teal">Design</span>
            <p>Homepage hero design</p>
            <div className="auth-aside-progress">
              <span style={{ width: '66%' }} />
            </div>
            <small>2 of 3 checklist items</small>
          </div>
        </div>
      </aside>
    </div>
  );
}

// Signs in with the returned user and moves on to where they were going.
function useSignedIn() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (user) => {
    client.setQueryData(keys.me, user);
    const next = params.get('next');
    // Only follow local paths, so ?next= can't send people to another site.
    navigate(next?.startsWith('/') && !next.startsWith('//') ? next : '/app', { replace: true });
  };
}

function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const bind = (name) => ({ name, value: values[name], onChange: (e) => setValues({ ...values, [name]: e.target.value }) });
  async function submit(event, action) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await action(values);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return { values, bind, error, busy, submit };
}

export function Login() {
  const signedIn = useSignedIn();
  const form = useForm({ email: '', password: '' });
  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to your Tasklane workspace."
      footer={
        <>
          New to Tasklane? <Link to="/signup">Create an account</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={(e) => form.submit(e, async (v) => signedIn((await api.login(v)).user))}>
        <Field label="Email">
          {(props) => <input {...props} {...form.bind('email')} type="email" className="input" autoComplete="email" required autoFocus />}
        </Field>
        <Field label="Password" aside={<Link to="/forgot-password" className="small">Forgot password?</Link>}>
          {(props) => <PasswordInput {...props} {...form.bind('password')} autoComplete="current-password" required />}
        </Field>
        {form.error && <p className="alert alert-error" role="alert">{form.error}</p>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={form.busy}>
          {form.busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </AuthLayout>
  );
}

export function Signup() {
  const signedIn = useSignedIn();
  const [params] = useSearchParams();
  // Invite links pass the invited address, so the account matches the invite.
  const form = useForm({ name: '', email: params.get('email') ?? '', password: '' });
  return (
    <AuthLayout
      title="Create your account"
      subtitle="Free for up to 5 people. No credit card needed."
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={(e) => form.submit(e, async (v) => signedIn((await api.register(v)).user))}>
        <Field label="Full name">
          {(props) => <input {...props} {...form.bind('name')} className="input" autoComplete="name" maxLength={80} required autoFocus />}
        </Field>
        <Field label="Work email">
          {(props) => <input {...props} {...form.bind('email')} type="email" className="input" autoComplete="email" required />}
        </Field>
        <Field label="Password">
          {(props) => (
            <>
              <PasswordInput {...props} {...form.bind('password')} autoComplete="new-password" minLength={8} maxLength={128} required />
              <PasswordStrength password={form.values.password} />
            </>
          )}
        </Field>
        {form.error && <p className="alert alert-error" role="alert">{form.error}</p>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={form.busy}>
          {form.busy ? 'Creating your workspace…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const form = useForm({ email: '' });
  const [sent, setSent] = useState(false);
  return (
    <AuthLayout
      title={sent ? 'Check your email' : 'Reset your password'}
      subtitle={
        sent
          ? `If an account exists for ${form.values.email}, we've sent a link to reset the password. It works for 30 minutes.`
          : "Enter your account's email and we'll send you a link to choose a new password."
      }
      footer={
        <>
          Remembered it? <Link to="/login">Back to log in</Link>
        </>
      }
    >
      {sent ? (
        <div className="auth-form">
          <p className="alert alert-success">
            <Icon name="mail" size={16} style={{ display: 'inline', verticalAlign: '-3px', marginRight: 6 }} />
            Don&apos;t see it? Check your spam folder.
          </p>
          <button className="btn btn-secondary btn-block" onClick={() => setSent(false)}>
            Use a different email
          </button>
        </div>
      ) : (
        <form
          className="auth-form"
          onSubmit={(e) =>
            form.submit(e, async (v) => {
              await api.forgotPassword(v.email);
              setSent(true);
            })
          }
        >
          <Field label="Email">
            {(props) => <input {...props} {...form.bind('email')} type="email" className="input" autoComplete="email" required autoFocus />}
          </Field>
          {form.error && <p className="alert alert-error" role="alert">{form.error}</p>}
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={form.busy}>
            {form.busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const signedIn = useSignedIn();
  const form = useForm({ password: '', confirm: '' });
  const mismatch = form.values.confirm && form.values.password !== form.values.confirm;

  if (!token) {
    return (
      <AuthLayout title="This link is incomplete" subtitle="Open the link from your email again, or request a new one.">
        <Link to="/forgot-password" className="btn btn-primary btn-block">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="You'll be signed out on every other device.">
      <form
        className="auth-form"
        onSubmit={(e) => form.submit(e, async (v) => signedIn((await api.resetPassword(token, v.password)).user))}
      >
        <Field label="New password">
          {(props) => (
            <>
              <PasswordInput {...props} {...form.bind('password')} autoComplete="new-password" minLength={8} maxLength={128} required autoFocus />
              <PasswordStrength password={form.values.password} />
            </>
          )}
        </Field>
        <Field label="Confirm new password" error={mismatch ? "Passwords don't match" : ''}>
          {(props) => <PasswordInput {...props} {...form.bind('confirm')} autoComplete="new-password" required />}
        </Field>
        {form.error && (
          <p className="alert alert-error" role="alert">
            {form.error}. <Link to="/forgot-password">Request a new link</Link>
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={form.busy || mismatch}>
          {form.busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </AuthLayout>
  );
}

// A simple guide, not a gate: the server only requires 8+ characters.
export function PasswordStrength({ password }) {
  if (!password) return <span className="field-hint">At least 8 characters</span>;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score++;
  const level = password.length < 8 ? 0 : Math.min(score, 4);
  const labels = ['Too short', 'Weak', 'Okay', 'Good', 'Strong'];
  return (
    <div className={`strength strength-${level}`} aria-live="polite">
      <div className="strength-bars">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={n <= level ? 'on' : ''} />
        ))}
      </div>
      <span>{labels[level]}</span>
    </div>
  );
}
