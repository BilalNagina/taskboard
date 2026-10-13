import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { applyTheme } from './lib/theme.js';
import { useMe } from './lib/queries.js';
import Landing from './pages/landing/Landing.jsx';
import { ForgotPassword, Login, ResetPassword, Signup } from './pages/auth/AuthPages.jsx';
import Invite from './pages/Invite.jsx';
import NotFound from './pages/NotFound.jsx';

// The signed-in app loads on demand, so the landing and sign-in pages stay light.
const AppLayout = lazy(() => import('./pages/app/AppLayout.jsx'));
const AppHome = lazy(() => import('./pages/app/AppHome.jsx'));
const WorkspaceHome = lazy(() => import('./pages/app/WorkspaceHome.jsx'));
const BoardPage = lazy(() => import('./pages/app/board/BoardPage.jsx'));
const Members = lazy(() => import('./pages/app/Members.jsx'));
const Dashboard = lazy(() => import('./pages/app/Dashboard.jsx'));
const Calendar = lazy(() => import('./pages/app/Calendar.jsx'));
const Search = lazy(() => import('./pages/app/Search.jsx'));
const Timesheet = lazy(() => import('./pages/app/Timesheet.jsx'));
const Admin = lazy(() => import('./pages/app/Admin.jsx'));
const Settings = lazy(() => import('./pages/app/Settings.jsx'));

export default function App() {
  const { data: user } = useMe();

  // The account's theme wins over whatever this browser had saved.
  useEffect(() => {
    if (user?.theme) applyTheme(user.theme);
  }, [user?.theme]);

  return (
    <Suspense fallback={<Splash />}>
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
          <Route path="w/:workspaceId/dashboard" element={<Dashboard />} />
          <Route path="w/:workspaceId/calendar" element={<Calendar />} />
          <Route path="w/:workspaceId/search" element={<Search />} />
          <Route path="w/:workspaceId/timesheet" element={<Timesheet />} />
          <Route path="w/:workspaceId/admin" element={<Admin />} />
          <Route path="boards/:boardId" element={<BoardPage />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
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
