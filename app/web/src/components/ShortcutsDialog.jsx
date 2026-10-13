// "?" shows every keyboard shortcut.
import { modKey } from '../lib/format.js';
import { Dialog } from './ui.jsx';

export const SHORTCUTS = [
  {
    title: 'Anywhere',
    keys: [
      [[modKey, 'K'], 'Open the command palette'],
      [['/'], 'Search tasks, boards and commands'],
      [['?'], 'Show these shortcuts'],
      [['Esc'], 'Close a panel, menu or dialog'],
    ],
  },
  {
    title: 'Go to',
    keys: [
      [['G', 'B'], 'Boards'],
      [['G', 'D'], 'Dashboard'],
      [['G', 'C'], 'Calendar'],
      [['G', 'S'], 'Search'],
      [['G', 'T'], 'Timesheet'],
      [['G', 'M'], 'Members'],
      [['G', 'A'], 'Admin (owners)'],
    ],
  },
  {
    title: 'On a board',
    keys: [
      [['C'], 'New task'],
      [['F'], 'Filter cards'],
      [['Enter'], 'Open the focused card'],
      [['Space'], 'Pick up a card, move it with the arrow keys, Space to drop'],
    ],
  },
  {
    title: 'In a task',
    keys: [[[modKey, 'Enter'], 'Send a comment']],
  },
];

export default function ShortcutsDialog({ onClose }) {
  return (
    <Dialog title="Keyboard shortcuts" description="Press G, then a letter, to jump between pages." onClose={onClose} wide>
      <div className="shortcut-groups">
        {SHORTCUTS.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.keys.map(([combo, what]) => (
                <div key={what} className="shortcut-row">
                  <dt>
                    {combo.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="shortcut-then">{combo[0] === 'G' ? 'then' : '+'}</span>}
                        <kbd>{k}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="dialog-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
