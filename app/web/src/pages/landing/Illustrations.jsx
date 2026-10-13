// Product illustrations for the landing page, drawn with HTML/CSS so they follow the theme.
import Icon from '../../components/Icon.jsx';

const people = { AK: '#4f46e5', MR: '#059669', JS: '#d97706', LT: '#db2777' };

function MiniAvatar({ who }) {
  return (
    <span className="mock-avatar" style={{ background: people[who] }}>
      {who}
    </span>
  );
}

function MockCard({ title, label, tone, due, dueTone, who, checklist, done }) {
  return (
    <div className={`mock-card ${done ? 'is-done' : ''}`}>
      {label && <span className={`mock-label tone-${tone}`}>{label}</span>}
      <p>{title}</p>
      <div className="mock-meta">
        {due && <span className={`mock-due ${dueTone ?? ''}`}>{due}</span>}
        {checklist && (
          <span className="mock-check">
            <Icon name="check" size={11} strokeWidth={2.4} /> {checklist}
          </span>
        )}
        {who && <MiniAvatar who={who} />}
      </div>
    </div>
  );
}

export function BoardMock() {
  return (
    <div className="board-mock" aria-hidden="true">
      <div className="mock-chrome">
        <span />
        <span />
        <span />
        <div className="mock-url">tasklane.app/website-launch</div>
      </div>
      <div className="mock-body">
        <div className="mock-sidebar">
          <div className="mock-ws">Acme Studio</div>
          <div className="mock-nav active">Website launch</div>
          <div className="mock-nav">Content calendar</div>
          <div className="mock-nav">Hiring</div>
        </div>
        <div className="mock-columns">
          <div className="mock-col">
            <div className="mock-col-head">
              To do <em>3</em>
            </div>
            <MockCard title="Write launch announcement" label="Content" tone="violet" due="Fri" who="JS" />
            <MockCard title="Pricing page copy review" label="Marketing" tone="amber" checklist="1/4" who="LT" />
            <MockCard title="Set up status page" due="Next week" />
          </div>
          <div className="mock-col">
            <div className="mock-col-head">
              In progress <em>2</em>
            </div>
            <MockCard title="Checkout flow QA" label="Bug" tone="red" due="Today" dueTone="warn" checklist="5/8" who="MR" />
            <MockCard title="Homepage hero design" label="Design" tone="teal" due="Tomorrow" dueTone="warn" who="AK" />
          </div>
          <div className="mock-col">
            <div className="mock-col-head">
              Done <em>4</em>
            </div>
            <MockCard title="Domain and HTTPS" label="Ops" tone="blue" checklist="3/3" done who="MR" />
            <MockCard title="Brand colour palette" done who="AK" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function DetailsMock() {
  return (
    <div className="feature-visual details-mock" aria-hidden="true">
      <div className="dm-head">
        <span className="mock-label tone-red">High</span>
        <span className="mock-label tone-teal">Design</span>
      </div>
      <p className="dm-title">Homepage hero design</p>
      <div className="dm-row">
        <Icon name="calendar" size={13} /> Due tomorrow
      </div>
      <div className="dm-checklist">
        <div className="done">
          <Icon name="check" size={11} strokeWidth={2.6} /> Wireframe
        </div>
        <div className="done">
          <Icon name="check" size={11} strokeWidth={2.6} /> Copy
        </div>
        <div>
          <span className="box" /> Final visuals
        </div>
      </div>
      <div className="dm-comment">
        <MiniAvatar who="AK" />
        <span>
          <b>@Maya</b> can you check the mobile crop?
        </span>
      </div>
    </div>
  );
}

export function ChartMock() {
  const bars = [40, 62, 48, 80, 66, 92, 74];
  return (
    <div className="feature-visual chart-mock" aria-hidden="true">
      <div className="cm-stats">
        <div>
          <b>24</b>
          <span>Done this week</span>
        </div>
        <div>
          <b className="warn">3</b>
          <span>Overdue</span>
        </div>
      </div>
      <div className="cm-bars">
        {bars.map((h, i) => (
          <span key={i} style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

export function TeamMock() {
  const rows = [
    ['AK', 'Aisha K.', 'Owner'],
    ['MR', 'Mateo R.', 'Member'],
    ['LT', 'Lena T.', 'Viewer'],
  ];
  return (
    <div className="feature-visual team-mock" aria-hidden="true">
      {rows.map(([who, name, role]) => (
        <div key={who} className="tm-row">
          <MiniAvatar who={who} />
          <span>{name}</span>
          <em>{role}</em>
        </div>
      ))}
      <div className="tm-invite">
        <Icon name="mail" size={13} /> Invite by email
      </div>
    </div>
  );
}

export function CalendarMock() {
  const marked = { 3: 'a', 9: 'b', 10: 'a', 16: 'c', 22: 'b', 24: 'a' };
  return (
    <div className="feature-visual calendar-mock" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => (
        <span key={i} className={i === 10 ? 'today' : ''}>
          {i + 1}
          {marked[i] && <i className={`dot dot-${marked[i]}`} />}
        </span>
      ))}
    </div>
  );
}

export function SearchMock() {
  return (
    <div className="feature-visual search-mock" aria-hidden="true">
      <div className="sm-input">
        <Icon name="search" size={13} /> invoice
      </div>
      <div className="sm-result">
        <b>Send invoice</b> to client · <em>Operations</em>
      </div>
      <div className="sm-result">
        <b>Invoice</b> template update · <em>Finance</em>
      </div>
      <div className="sm-filters">
        <span>Assigned to me</span>
        <span>Due this week</span>
        <span>High priority</span>
      </div>
    </div>
  );
}
