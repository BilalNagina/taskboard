import { useEffect, useState } from 'react';
import { api } from './api.js';
import AuthScreen from './AuthScreen.jsx';
import Workspace from './Workspace.jsx';

// Set at build time by CI, so the page shows exactly which commit is deployed.
const VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

export default function App() {
  // undefined while checking the session, null when signed out.
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null));
  }, []);

  const signOut = async () => {
    await api.logout().catch(() => {});
    setUser(null);
  };

  return (
    <div className="shell">
      {user === undefined && <p className="muted center">Loading…</p>}
      {user === null && <AuthScreen onSignedIn={setUser} />}
      {user && <Workspace user={user} onSignOut={signOut} onSessionExpired={() => setUser(null)} />}
      <footer className="version muted">Version {VERSION}</footer>
    </div>
  );
}
