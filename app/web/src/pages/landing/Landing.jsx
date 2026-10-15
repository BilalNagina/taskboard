import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { Logo } from '../../components/ui.jsx';
import { useMe } from '../../lib/queries.js';
import { BoardMock, CalendarMock, ChartMock, DetailsMock, SearchMock, TeamMock } from './Illustrations.jsx';

const FEATURES = [
  {
    title: 'Boards that flow',
    text: 'Drag cards between columns, reorder lanes, and see where every piece of work stands at a glance.',
    visual: <BoardColumnsMini />,
  },
  {
    title: 'The details that matter',
    text: 'Due dates, priorities, labels, checklists, files and comments with @mentions, all on the card.',
    visual: <DetailsMock />,
  },
  {
    title: 'Built for teams',
    text: 'Invite people to a workspace as owners, members or viewers. Everyone sees exactly what they should.',
    visual: <TeamMock />,
  },
  {
    title: 'Progress at a glance',
    text: 'A dashboard shows what got done, what is overdue and what is coming up, across every board.',
    visual: <ChartMock />,
  },
  {
    title: 'Never miss a date',
    text: 'A calendar of everything that is due, plus reminders by email and in the app before deadlines slip.',
    visual: <CalendarMock />,
  },
  {
    title: 'Find anything',
    text: 'Search every board at once and filter by person, label, priority or due date in a couple of keystrokes.',
    visual: <SearchMock />,
  },
];

const USE_CASES = [
  {
    id: 'product',
    label: 'Product teams',
    title: 'Ship releases without the spreadsheet',
    points: ['Sprint boards with priorities and owners', 'Checklists for QA and launch steps', 'Dashboard for stand-ups'],
    quote: 'We replaced a shared spreadsheet and two chat threads with one board per release.',
    who: 'Product lead, 12-person software startup',
  },
  {
    id: 'agency',
    label: 'Agencies',
    title: 'One workspace per client, zero confusion',
    points: ['Separate workspaces keep clients apart', 'Viewer access so clients can follow along', 'Time tracking for accurate invoices'],
    quote: 'Clients can see progress without us sending status emails every Friday.',
    who: 'Studio director, design agency',
  },
  {
    id: 'ops',
    label: 'Operations & HR',
    title: 'Repeatable processes, done the same way every time',
    points: ['Hiring pipeline and onboarding templates', 'Recurring tasks for monthly routines', 'Reminders before anything is due'],
    quote: 'Our monthly close checklist now recreates itself, so nothing gets forgotten.',
    who: 'Operations manager, retail business',
  },
];

const PLANS = [
  {
    name: 'Free',
    monthly: 0,
    yearly: 0,
    blurb: 'For individuals and small teams getting organised.',
    features: ['Up to 5 members', '3 boards per workspace', 'Due dates, labels, checklists', '100 MB of files'],
    cta: 'Start for free',
  },
  {
    name: 'Pro',
    monthly: 6,
    yearly: 5,
    blurb: 'For growing teams that run their work in Tasklane.',
    features: ['Up to 25 members', 'Unlimited boards', 'Dashboard, calendar, exports', 'Recurring tasks and time tracking', '5 GB of files'],
    cta: 'Try Pro',
    featured: true,
  },
  {
    name: 'Team',
    monthly: 12,
    yearly: 10,
    blurb: 'For companies that need control and visibility.',
    features: ['Unlimited members', 'Everything in Pro', 'Viewer roles for clients', '50 GB of files'],
    cta: 'Try Team',
  },
];

const FAQS = [
  ['Is Tasklane free to use?', 'Yes. The Free plan covers small teams with no time limit. Pro and Team add more boards, members and storage.'],
  [
    'Can I invite my team and clients?',
    'Yes. Invite people to a workspace by email as an owner, member or viewer. Viewers can follow progress but cannot change anything, which suits clients.',
  ],
  [
    'Where is my data stored?',
    'On AWS. The database is backed up every night, files are stored encrypted in Amazon S3, and every connection uses HTTPS.',
  ],
  ['Can I get my data out?', 'Any board can be exported to CSV or PDF at any time.'],
  ['Is there a mobile app?', 'Tasklane works in any modern browser and is fully responsive, so it works on phones and tablets without installing anything.'],
  [
    'Is this a real product?',
    'Tasklane is a demonstration product. Accounts and data are real and work end to end. Paid plans go through Paddle in test mode: checkout, trials, seats and invoices all work, but only test cards are accepted and no real money is charged.',
  ],
];

export default function Landing() {
  const { data: user } = useMe();
  const [yearly, setYearly] = useState(true);
  const [useCase, setUseCase] = useState(USE_CASES[0].id);
  useReveal();

  const activeCase = USE_CASES.find((c) => c.id === useCase);
  const primaryCta = user ? { to: '/app', label: 'Open Tasklane' } : { to: '/signup', label: 'Get started free' };

  return (
    <div className="landing">
      <header className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <Logo />
          <nav className="lp-links" aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="lp-nav-actions">
            {user ? (
              <Link to="/app" className="btn btn-primary btn-sm">
                Open app
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm">
                  Log in
                </Link>
                <Link to="/signup" className="btn btn-primary btn-sm">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-container">
            <div className="lp-hero-copy" data-reveal>
              <span className="lp-eyebrow">
                <Icon name="zap" size={14} /> Task management for small teams
              </span>
              <h1>
                Every task in its lane.
                <br />
                <span className="lp-gradient">Every team in sync.</span>
              </h1>
              <p className="lp-lead">
                Tasklane brings boards, due dates, checklists and team workspaces together in one calm, fast app, so work
                keeps moving without the status meetings.
              </p>
              <div className="lp-hero-actions">
                <Link to={primaryCta.to} className="btn btn-primary btn-lg">
                  {primaryCta.label} <Icon name="arrowRight" size={18} />
                </Link>
                {!user && (
                  <Link to="/login" className="btn btn-secondary btn-lg">
                    Log in
                  </Link>
                )}
              </div>
              <p className="lp-fineprint">Free for up to 5 people · No credit card needed</p>
            </div>
            <div className="lp-hero-visual" data-reveal>
              <BoardMock />
            </div>
          </div>
        </section>

        <section className="lp-strip" aria-label="Who it is for">
          <div className="lp-container lp-strip-inner" data-reveal>
            <span>Made for</span>
            <b>Startups</b>
            <b>Agencies</b>
            <b>Operations teams</b>
            <b>Freelancers</b>
            <b>Non-profits</b>
          </div>
        </section>

        <section id="features" className="lp-section">
          <div className="lp-container">
            <div className="lp-section-head" data-reveal>
              <span className="lp-kicker">Features</span>
              <h2>Everything a team needs to plan and deliver</h2>
              <p className="muted">One place for the work, the people doing it and the dates it is due.</p>
            </div>
            <div className="lp-features">
              {FEATURES.map((feature) => (
                <article key={feature.title} className="lp-feature" data-reveal>
                  {feature.visual}
                  <h3>{feature.title}</h3>
                  <p className="muted">{feature.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="lp-section lp-section-alt">
          <div className="lp-container">
            <div className="lp-section-head" data-reveal>
              <span className="lp-kicker">How it works</span>
              <h2>Up and running in three steps</h2>
            </div>
            <ol className="lp-steps">
              {[
                ['users', 'Create a workspace', 'Sign up, name your workspace and invite your team by email. A sample board shows you around.'],
                ['board', 'Plan on boards', 'Start from a template or a blank board. Add tasks, owners, due dates and checklists.'],
                ['chart', 'Track and deliver', 'Move cards as work progresses. The dashboard, calendar and reminders keep everyone on time.'],
              ].map(([icon, title, text], i) => (
                <li key={title} className="lp-step" data-reveal>
                  <span className="lp-step-num">{i + 1}</span>
                  <span className="lp-step-icon">
                    <Icon name={icon} size={22} />
                  </span>
                  <h3>{title}</h3>
                  <p className="muted">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-container">
            <div className="lp-section-head" data-reveal>
              <span className="lp-kicker">Use cases</span>
              <h2>Fits the way your team already works</h2>
            </div>
            <div className="lp-tabs" role="tablist" data-reveal>
              {USE_CASES.map((c) => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={c.id === useCase}
                  className={`lp-tab ${c.id === useCase ? 'active' : ''}`}
                  onClick={() => setUseCase(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="lp-usecase" key={activeCase.id} role="tabpanel">
              <div>
                <h3>{activeCase.title}</h3>
                <ul className="lp-checks">
                  {activeCase.points.map((point) => (
                    <li key={point}>
                      <Icon name="check" size={16} strokeWidth={2.4} /> {point}
                    </li>
                  ))}
                </ul>
              </div>
              <figure className="lp-quote">
                <span className="badge">Example story</span>
                <blockquote>“{activeCase.quote}”</blockquote>
                <figcaption className="muted">{activeCase.who}</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section id="pricing" className="lp-section lp-section-alt">
          <div className="lp-container">
            <div className="lp-section-head" data-reveal>
              <span className="lp-kicker">Pricing</span>
              <h2>Simple pricing that grows with you</h2>
              <div className="lp-billing" role="group" aria-label="Billing period">
                <button className={!yearly ? 'active' : ''} onClick={() => setYearly(false)}>
                  Monthly
                </button>
                <button className={yearly ? 'active' : ''} onClick={() => setYearly(true)}>
                  Yearly <span className="badge badge-success">Save 17%</span>
                </button>
              </div>
            </div>
            <div className="lp-plans">
              {PLANS.map((plan) => (
                <article key={plan.name} className={`lp-plan ${plan.featured ? 'featured' : ''}`} data-reveal>
                  {plan.featured && <span className="lp-plan-flag">Most popular</span>}
                  <h3>{plan.name}</h3>
                  <p className="muted small">{plan.blurb}</p>
                  <p className="lp-price">
                    <b>${yearly ? plan.yearly : plan.monthly}</b>
                    <span className="muted">{plan.monthly ? ' per user / month' : ' forever'}</span>
                  </p>
                  <Link to={user ? '/app' : '/signup'} className={`btn btn-block ${plan.featured ? 'btn-primary' : 'btn-secondary'}`}>
                    {plan.cta}
                  </Link>
                  <ul className="lp-checks">
                    {plan.features.map((f) => (
                      <li key={f}>
                        <Icon name="check" size={16} strokeWidth={2.4} /> {f}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <p className="lp-note muted small" data-reveal>
              Paid plans start with a 7-day free trial. Payments run in test mode through Paddle, so no real money is charged.
            </p>
          </div>
        </section>

        <section id="faq" className="lp-section">
          <div className="lp-container lp-faq-wrap">
            <div className="lp-section-head" data-reveal>
              <span className="lp-kicker">FAQ</span>
              <h2>Questions, answered</h2>
            </div>
            <div className="lp-faq">
              {FAQS.map(([q, a]) => (
                <details key={q} data-reveal>
                  <summary>
                    {q}
                    <Icon name="chevronDown" size={18} />
                  </summary>
                  <p className="muted">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-cta">
          <div className="lp-container" data-reveal>
            <h2>Bring your team&apos;s work into one calm place</h2>
            <p>Set up a workspace in under a minute. A sample board is ready when you arrive.</p>
            <Link to={primaryCta.to} className="btn btn-lg lp-cta-btn">
              {primaryCta.label} <Icon name="arrowRight" size={18} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div>
            <Logo />
            <p className="muted small">Task management for small teams.</p>
          </div>
          <nav aria-label="Product">
            <h4>Product</h4>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <nav aria-label="Account">
            <h4>Account</h4>
            <Link to="/login">Log in</Link>
            <Link to="/signup">Sign up</Link>
            <Link to="/forgot-password">Reset password</Link>
          </nav>
          <nav aria-label="Project">
            <h4>Project</h4>
            <a href="https://github.com/BilalNagina/taskboard" target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </nav>
        </div>
        <div className="lp-container lp-footer-base muted small">
          © {new Date().getFullYear()} Tasklane · A demonstration product by Bilal Nagina · Version{' '}
          {import.meta.env.VITE_APP_VERSION ?? 'dev'}
        </div>
      </footer>
    </div>
  );
}

function BoardColumnsMini() {
  return (
    <div className="feature-visual columns-mini" aria-hidden="true">
      {[3, 2, 2].map((count, col) => (
        <div key={col}>
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className={col === 1 && i === 0 ? 'lifted' : ''} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Fades sections in as they scroll into view. Does nothing for reduced-motion users.
function useReveal() {
  useEffect(() => {
    const elements = document.querySelectorAll('[data-reveal]');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      elements.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }),
      { rootMargin: '0px 0px -60px 0px' },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}
