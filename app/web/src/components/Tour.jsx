// The welcome tour: a few steps that point at parts of the app, shown once to new
// accounts and on request from the user menu. Targets are marked with data-tour; when a
// target isn't on screen (the sidebar is folded away on phones) the step is centred.
import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const STEPS = [
  {
    title: 'Welcome to Tasklane',
    body: (name) => `Hi ${name}. Here's a one-minute look around. We made you a Getting started board with cards to practise on.`,
  },
  {
    target: 'workspace',
    title: 'Your workspace',
    body: 'Boards and the people who work on them live in a workspace. Switch between workspaces, or make one for another team, here.',
  },
  {
    target: 'boards',
    title: 'Boards',
    body: 'Each board is a set of columns and cards. Press + to start one from a template: sprint planning, content calendar or hiring pipeline.',
  },
  {
    target: 'views',
    title: 'Everything at a glance',
    body: 'The dashboard, calendar and search look across every board in the workspace.',
  },
  {
    target: 'timesheet',
    title: 'Time tracking',
    body: 'Start a timer on any task, or log time by hand. The timesheet adds it up by day and person.',
  },
  {
    target: 'members',
    title: 'Invite your team',
    body: 'Add members who can change tasks, or viewers who can look and comment.',
  },
  {
    target: 'bell',
    title: 'Notifications',
    body: 'Assignments, mentions, comments and due dates show up here.',
  },
  {
    title: 'You’re all set',
    body: 'Open the Getting started board and work through its cards. You can replay this tour from the menu under your name.',
  },
];

const CARD_WIDTH = 340;
const MARGIN = 16;
const PAD = 6;

// The first element with this data-tour name that is actually visible.
function findTarget(name) {
  return [...document.querySelectorAll(`[data-tour="${name}"]`)].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
  });
}

function measure(name) {
  const el = name && findTarget(name);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD };
}

// Beside the target if there's room on the right (the sidebar), otherwise below it.
function placeCard(spot) {
  const width = Math.min(CARD_WIDTH, window.innerWidth - 2 * MARGIN);
  if (spot.left + spot.width + MARGIN + width <= window.innerWidth - MARGIN) {
    const top = Math.max(MARGIN, Math.min(spot.top, window.innerHeight - 280));
    return { top, left: spot.left + spot.width + MARGIN, width };
  }
  const left = Math.max(MARGIN, Math.min(spot.left, window.innerWidth - width - MARGIN));
  return { top: Math.min(spot.top + spot.height + 12, window.innerHeight - 280), left, width };
}

export default function Tour({ name, onDone }) {
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState(null);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  useLayoutEffect(() => {
    findTarget(step.target ?? '')?.scrollIntoView({ block: 'nearest' });
    const update = () => setSpot(measure(step.target));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step.target]);

  const next = () => (last ? onDone() : setIndex(index + 1));
  const back = () => setIndex(Math.max(0, index - 1));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onDone();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // With nothing to point at, the spotlight shrinks to the centre and just dims the page.
  const hole = spot ?? { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 };
  const card = spot ? placeCard(spot) : null;

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className={`tour-spot ${spot ? 'has-target' : ''}`} style={hole} />
      <div key={index} className={`tour-card ${card ? '' : 'is-centred'}`} style={card ?? undefined}>
        <p className="tour-count">
          {index + 1} of {STEPS.length}
        </p>
        <h2 id="tour-title">{step.title}</h2>
        <p className="tour-body">{typeof step.body === 'function' ? step.body(name) : step.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.title} className={i === index ? 'is-active' : i < index ? 'is-done' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          {!last && (
            <button className="btn btn-ghost btn-sm" onClick={onDone}>
              Skip tour
            </button>
          )}
          <span className="tour-spacer" />
          {index > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={back}>
              Back
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={next} autoFocus>
            {last ? 'Finish' : index === 0 ? 'Show me around' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
