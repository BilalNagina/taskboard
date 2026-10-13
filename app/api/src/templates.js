// Board templates: the columns, labels and example cards a new board starts with.
// In tasks, `column` is an index into `columns` (cards in a done column start completed),
// `due` is days from today, and `assign: true` assigns whoever creates the board.
// `starter` is the sample board every new account gets; the template picker skips it.

const DEFAULT_LABELS = [
  ['Bug', 'red'],
  ['Feature', 'blue'],
  ['Design', 'teal'],
  ['Research', 'violet'],
];
const BASIC_COLUMNS = [{ name: 'To do' }, { name: 'In progress' }, { name: 'Done', done: true }];

export const TEMPLATES = {
  blank: {
    name: 'Blank board',
    description: 'To do, In progress and Done. Shape it as you go.',
    columns: BASIC_COLUMNS,
    labels: DEFAULT_LABELS,
    tasks: [],
  },

  sprint: {
    name: 'Sprint planning',
    description: 'A two-week sprint from backlog to done, with a review step.',
    columns: [{ name: 'Backlog' }, { name: 'Ready' }, { name: 'In progress' }, { name: 'In review' }, { name: 'Done', done: true }],
    labels: [
      ['Story', 'blue'],
      ['Bug', 'red'],
      ['Chore', 'gray'],
      ['Spike', 'violet'],
    ],
    tasks: [
      { title: 'Export reports as CSV', column: 0, labels: ['Story'], priority: 'medium' },
      { title: 'Find out why search is slow on large boards', column: 0, labels: ['Spike'], description: 'Time-box to one day. Write down what you find.' },
      { title: 'Update dependencies', column: 0, labels: ['Chore'], priority: 'low' },
      { title: 'Password reset emails land in spam', column: 1, labels: ['Bug'], priority: 'high', due: 3 },
      {
        title: 'Add a first-run checklist',
        column: 1,
        labels: ['Story'],
        priority: 'medium',
        checklist: ['Agree the steps with design', 'Build it', 'Test on a phone'],
      },
      {
        title: 'Redesign the settings page',
        column: 2,
        labels: ['Story'],
        priority: 'high',
        due: 5,
        assign: true,
        checklist: [['Wireframes', true], 'Build the new layout', 'Accessibility check'],
      },
      { title: 'Date picker shows the wrong month in Safari', column: 3, labels: ['Bug'], priority: 'medium' },
      { title: 'Sprint review and demo', column: 1, due: 13, description: 'Show what shipped and collect feedback.' },
      { title: 'Retrospective', column: 1, due: 13, description: 'What went well, what to change next sprint.' },
      { title: 'Set up the sprint board', column: 4, labels: ['Chore'] },
    ],
  },

  content: {
    name: 'Content calendar',
    description: 'Plan, write, edit and publish posts on a schedule.',
    columns: [{ name: 'Ideas' }, { name: 'Writing' }, { name: 'Editing' }, { name: 'Scheduled' }, { name: 'Published', done: true }],
    labels: [
      ['Blog', 'blue'],
      ['Newsletter', 'teal'],
      ['Social', 'pink'],
      ['Video', 'amber'],
    ],
    tasks: [
      { title: 'Customer story: how a small team plans its week', column: 0, labels: ['Blog'] },
      { title: 'Behind-the-scenes video', column: 0, labels: ['Video'] },
      { title: 'Poll: what should we write about next?', column: 0, labels: ['Social'] },
      {
        title: 'Ten tips for shorter meetings',
        column: 1,
        labels: ['Blog'],
        due: 4,
        assign: true,
        checklist: [['Outline', true], 'First draft', 'Pick a cover image'],
      },
      { title: 'Monthly product update', column: 2, labels: ['Blog'], priority: 'high', due: 2 },
      {
        title: 'Weekly newsletter',
        column: 3,
        labels: ['Newsletter'],
        due: 5,
        repeat: 'weekly',
        description: 'Repeats every week: complete it and next week’s issue appears.',
      },
      { title: 'Share the meetings article on social', column: 3, labels: ['Social'], due: 6 },
      { title: 'Welcome post', column: 4, labels: ['Blog'] },
    ],
  },

  hiring: {
    name: 'Hiring pipeline',
    description: 'Move candidates from application to offer.',
    columns: [{ name: 'Applied' }, { name: 'Screening' }, { name: 'Interview' }, { name: 'Offer' }, { name: 'Hired', done: true }],
    labels: [
      ['Engineering', 'blue'],
      ['Design', 'teal'],
      ['Sales', 'amber'],
      ['Referral', 'green'],
    ],
    tasks: [
      { title: 'Priya Shah, product designer', column: 0, labels: ['Design', 'Referral'] },
      { title: 'Leo Martins, account executive', column: 0, labels: ['Sales'] },
      {
        title: 'Mia Chen, backend engineer',
        column: 1,
        labels: ['Engineering'],
        due: 2,
        checklist: [['Review CV', true], 'Phone screen', 'Send the take-home task'],
      },
      {
        title: 'Sam Carter, frontend engineer',
        column: 2,
        labels: ['Engineering'],
        priority: 'high',
        due: 3,
        assign: true,
        checklist: [['Technical interview', true], 'Team interview', 'Collect feedback'],
      },
      {
        title: 'Ana Lopez, sales lead',
        column: 3,
        labels: ['Sales'],
        priority: 'urgent',
        due: 2,
        checklist: [['References', true], 'Draft the offer', 'Send the offer'],
      },
      { title: 'Tom Reid, support specialist', column: 4 },
    ],
  },

  starter: {
    name: 'Getting started',
    hidden: true,
    columns: BASIC_COLUMNS,
    labels: DEFAULT_LABELS,
    tasks: [
      {
        title: 'Drag this card to In progress',
        column: 0,
        description: 'Cards move between columns by dragging. On a phone, press and hold a card first. Columns can be dragged too.',
      },
      {
        title: 'Open this card to see everything about a task',
        column: 0,
        priority: 'medium',
        assign: true,
        description: 'This panel holds the description, checklist, files, comments, time and history of a task. Try the checklist below.',
        checklist: ['Read the description', 'Tick off this item', 'Leave a comment (type @ to mention someone)'],
      },
      {
        title: 'Start a board from a template',
        column: 0,
        labels: ['Feature'],
        description: 'Press + next to Boards in the sidebar. Sprint planning, content calendar and hiring pipeline come with columns, labels and example cards.',
      },
      {
        title: 'Invite a teammate',
        column: 0,
        due: 3,
        description: 'Go to Members in the sidebar. Members can change tasks; viewers can look and comment.',
      },
      {
        title: 'Weekly review',
        column: 0,
        due: 6,
        repeat: 'weekly',
        description: 'This task repeats every week. Complete it and the next one appears with a new due date.',
      },
      {
        title: 'Track time on this task',
        column: 1,
        priority: 'high',
        assign: true,
        description: 'Press Start in the Time section below. The timer keeps running while you work elsewhere, and the Timesheet adds it up by day.',
      },
      { title: 'Create your Tasklane account', column: 2 },
    ],
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES).filter((key) => !TEMPLATES[key].hidden);

// What the template picker shows.
export const templateSummaries = () =>
  TEMPLATE_KEYS.map((key) => {
    const t = TEMPLATES[key];
    return {
      key,
      name: t.name,
      description: t.description,
      columns: t.columns.map((c) => c.name),
      labels: t.labels.map(([name, color]) => ({ name, color })),
      taskCount: t.tasks.length,
    };
  });
