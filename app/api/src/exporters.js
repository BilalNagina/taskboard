// Board exports: CSV for spreadsheets, PDF for sharing and printing.
import PDFDocument from 'pdfkit';

const PRIORITY = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: '' };
const date = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');

// RFC 4180 quoting. Cells starting with = + - @ get a leading apostrophe so a spreadsheet
// never runs them as formulas (CSV injection).
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function boardCsv(rows) {
  const header = ['Title', 'Column', 'Status', 'Priority', 'Due date', 'Assignees', 'Labels', 'Checklist', 'Description', 'Created', 'Completed'];
  const lines = rows.map((r) => [
    r.title,
    r.column,
    r.done ? 'Done' : 'Open',
    PRIORITY[r.priority],
    r.dueDate ?? '',
    r.assignees,
    r.labels,
    r.checklistTotal ? `${r.checklistDone}/${r.checklistTotal}` : '',
    r.description,
    date(r.createdAt),
    date(r.completedAt),
  ]);
  // A byte-order mark makes Excel read the file as UTF-8, so accents and non-Latin names survive.
  return '﻿' + [header, ...lines].map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// One row per time entry, with hours alongside minutes for spreadsheet sums.
export function timesheetCsv(rows) {
  const header = ['Date', 'Person', 'Board', 'Task', 'Minutes', 'Hours', 'Note'];
  const lines = rows.map((r) => [r.day, r.person, r.board, r.task, r.minutes, (r.minutes / 60).toFixed(2), r.note]);
  return '\uFEFF' + [header, ...lines].map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// The built-in PDF fonts only cover Western European characters. Anything else becomes
// "?" rather than garbled output; embedding a Unicode font would add several MB.
const WIN_ANSI_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export const pdfSafe = (text) =>
  String(text ?? '').replace(/[^\n\t\x20-\x7e\xa0-\xff]/gu, (ch) => (WIN_ANSI_EXTRAS.includes(ch) ? ch : '?'));

export function writeBoardPdf(stream, { board, workspaceName, rows, generatedBy }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: pdfSafe(board.name), Author: 'Tasklane' } });
  doc.pipe(stream);
  const accent = '#4f46e5';
  const muted = '#64748b';

  doc.fillColor(accent).font('Helvetica-Bold').fontSize(10).text('TASKLANE');
  doc.moveDown(0.3);
  doc.fillColor('#0f172a').fontSize(22).text(pdfSafe(board.name));
  const open = rows.filter((r) => !r.done).length;
  doc
    .fillColor(muted)
    .font('Helvetica')
    .fontSize(10)
    .text(pdfSafe(`${workspaceName} · ${rows.length} tasks · ${open} open · ${rows.length - open} done · exported ${date(new Date())} by ${generatedBy}`));
  doc.moveDown(1);

  const columns = [...new Map(rows.map((r) => [r.column, r.columnPosition])).entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  if (!rows.length) doc.fillColor(muted).fontSize(12).text('This board has no tasks yet.');

  for (const column of columns) {
    const tasks = rows.filter((r) => r.column === column);
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.5).fillColor(accent).font('Helvetica-Bold').fontSize(13).text(pdfSafe(`${column}  (${tasks.length})`));
    doc
      .moveTo(doc.page.margins.left, doc.y + 3)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y + 3)
      .strokeColor('#e2e8f0')
      .stroke();
    doc.moveDown(0.6);

    for (const task of tasks) {
      if (doc.y > doc.page.height - 100) doc.addPage();
      doc.fillColor(task.done ? muted : '#0f172a').font('Helvetica-Bold').fontSize(11).text(pdfSafe(`${task.done ? '[x]' : '[ ]'}  ${task.title}`));
      const meta = [
        PRIORITY[task.priority] && `Priority: ${PRIORITY[task.priority]}`,
        task.dueDate && `Due: ${task.dueDate}`,
        task.assignees && `Assigned: ${task.assignees}`,
        task.labels && `Labels: ${task.labels}`,
        task.checklistTotal && `Checklist: ${task.checklistDone}/${task.checklistTotal}`,
      ].filter(Boolean);
      if (meta.length) doc.fillColor(muted).font('Helvetica').fontSize(9).text(pdfSafe(meta.join('   ·   ')), { indent: 22 });
      if (task.description) {
        const text = task.description.length > 600 ? `${task.description.slice(0, 599)}…` : task.description;
        doc.fillColor('#334155').font('Helvetica').fontSize(9.5).text(pdfSafe(text), { indent: 22 });
      }
      doc.moveDown(0.6);
    }
  }
  doc.end();
}
