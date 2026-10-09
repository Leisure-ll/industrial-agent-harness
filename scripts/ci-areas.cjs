// Area classifier shared with the CI gating job (.github/workflows/ci.yml).
// Kept pure and dependency-free so the portable suite can unit-test the
// exact rules the workflow applies. Runtime resources (any file under a
// skills/ directory, e.g. packages/domain-skills/skills/*/SKILL.md) are not
// documentation: edits there must gate the layers that load them.

const docs = file =>
  !/(^|\/)skills\//.test(file) &&
  (/\.md$/i.test(file) || file === 'LICENSE' || file.startsWith('doc/'));

const withinDesktop = file => docs(file) || file.startsWith('apps/desktop/');

function classify(entries) {
  const files = [];
  for (const entry of entries) {
    if (typeof entry?.filename !== 'string')
      throw Error('classify expects { filename, previous_filename? } entries.');
    files.push(entry.filename);
    // Renames and copies carry the pre-move path; a source file moved into
    // doc/ must still gate the layers its old location affects.
    if (typeof entry.previous_filename === 'string' && entry.previous_filename)
      files.push(entry.previous_filename);
  }
  const docsOnly = files.length > 0 && files.every(withinDesktop) && files.every(docs);
  const sharedChanged = files.length === 0 || files.some(file => !withinDesktop(file));
  return { docsOnly, sharedChanged };
}

module.exports = { classify, docs, withinDesktop };
