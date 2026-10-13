import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { applyTheme } from './lib/theme.js';
import { useMe } from './lib/queries.js';
import Landing from './pages/landing/Landing.jsx';
import { ForgotPassword, Login, ResetPassword, Signup } from './pages/auth/AuthPages.jsx';
import AppLayout from './pages/app/AppLayout.jsx';
import AppHome from './pages/app/AppHome.jsx';
import WorkspaceHome from './pages/app/WorkspaceHome.jsx';
import BoardPage from './pages/app/board/BoardPage.jsx';
import Members from './pages/app/Members.jsx';
import Invite from './pages/Invite.jsx';
import Settings from './pages/app/Settings.jsx';
import NotFound from './pages/NotFound.jsx';

export default function App() {
  const { data: user } = useMe();

  // The account's theme wins over whatever this browser had saved.
  useEffect(() => {
    if (user?.theme) applyTheme(user.theme);
  }, [user?.theme]);

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/invite/:token" element={<Invite />} />
      <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<AppHome />} />
        <Route path="w/:workspaceId" element={<WorkspaceHome />} />
        <Route path="w/:workspaceId/members" element={<Members />} />
        <Route path="boards/:boardId" element={<BoardPage />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function Splash() {
  return (
    <div className="splash" aria-label="Loading">
      <span className="spinner" />
    </div>
  );
}

// Signed-out visitors go to the login page, which sends them back here afterwards.
function RequireAuth({ children }) {
  const { data: user, isPending } = useMe();
  const location = useLocation();
  if (isPending) return <Splash />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

// Already signed in: skip the form and go where the link was heading (an invite, say).
function GuestOnly({ children }) {
  const { data: user, isPending } = useMe();
  const next = new URLSearchParams(useLocation().search).get('next');
  if (isPending) return <Splash />;
  if (user) return <Navigate to={next?.startsWith('/') && !next.startsWith('//') ? next : '/app'} replace />;
  return children;
}
