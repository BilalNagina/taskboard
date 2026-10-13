import { Link } from 'react-router';
import { Logo } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <div className="notfound">
      <Logo />
      <p className="notfound-code">404</p>
      <h1>This page doesn&apos;t exist</h1>
      <p className="muted">The link may be broken, or the page may have moved.</p>
      <div className="notfound-actions">
        <Link to="/" className="btn btn-secondary">Home</Link>
        <Link to="/app" className="btn btn-primary">Open Tasklane</Link>
      </div>
    </div>
  );
}
