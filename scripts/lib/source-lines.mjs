/**
 * Comment-stripping for the gates.
 *
 * The first run of these gates failed on their own documentation: the push gate
 * flagged the comment explaining that push is banned, and the vocabulary gate
 * flagged the word "spreadsheet" in a sentence about a spreadsheet cell.
 *
 * A gate that fires on prose gets disabled, and then it is not a gate. So they
 * check CODE - string literals included, because `spec/00-overview.md` makes
 * the vocabulary binding on error messages and UI copy - and ignore comments.
 *
 * Line numbers are preserved: comment content is blanked in place rather than
 * removed, so a reported line number still points at the right line.
 */

/**
 * @param {string} contents
 * @returns {string[]} one entry per line, with comment content blanked
 */
export function codeLines(contents) {
  const out = [];
  let inBlock = false;

  for (const raw of contents.split('\n')) {
    let line = '';
    let index = 0;
    let inString = null;

    while (index < raw.length) {
      const two = raw.slice(index, index + 2);

      if (inBlock) {
        if (two === '*/') {
          inBlock = false;
          index += 2;
        } else {
          index += 1;
        }
        line += ' ';
        continue;
      }

      if (inString === null && two === '/*') {
        inBlock = true;
        index += 2;
        line += '  ';
        continue;
      }

      if (inString === null && two === '//') {
        line += ' '.repeat(raw.length - index);
        break;
      }

      const char = raw[index];

      if (inString === null && (char === "'" || char === '"' || char === '`')) {
        inString = char;
      } else if (inString !== null && char === inString && raw[index - 1] !== '\\') {
        inString = null;
      }

      line += char;
      index += 1;
    }

    out.push(line);
  }

  return out;
}

/** True for file types where comment syntax does not apply. */
export function isDataFile(path) {
  return /\.(json|ya?ml|sh|md)$/u.test(path);
}
