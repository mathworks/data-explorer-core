// Copyright 2026 The MathWorks, Inc.
//
// Dev-only CLI for exploring a real Simulink file with data-explorer-core.
// Sniffs the extension, loads the file through a session, and prints a compact
// node tree (kind · name, with child counts). Not shipped — excluded from the
// published tarball by the `files` allowlist.
//
// Usage:
//   npm run build          # ensure dist/ is current
//   npm run explore -- path/to/file.sldd
//   npm run explore -- path/to/model.slx --depth 2
//
// Supported: .sldd (textual JSON or binary), .slx, .mat, .prj

import { basename } from 'node:path';
import { createSession, loadFromPath } from '../dist/node/index.js';

function parseArgs(argv) {
  const args = { file: null, depth: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--depth') {
      args.depth = Number(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (!args.file) {
      args.file = a;
    }
  }
  return args;
}

function usage() {
  console.log(
    [
      'Usage: npm run explore -- <file> [--depth N]',
      '',
      '  <file>      .sldd (textual or binary), .slx, .mat, or .prj',
      '  --depth N   limit tree depth (default: unlimited)',
    ].join('\n'),
  );
}

// Load the file into a session via the shared Node loader; derive a display format label.
function loadSource(session, path) {
  const node = loadFromPath(session, path);
  const dot = basename(path).lastIndexOf('.');
  const format = dot >= 0 ? basename(path).slice(dot) : '(unknown)';
  return { node, format };
}

// Print the tree rooted at `node`.
function printTree(node, maxDepth) {
  let count = 0;

  function label(n) {
    const kind = n.kind || (n.isContainer ? 'container' : 'node');
    const name = n.displayName || n.name || n.id || '(unnamed)';
    const kids = Array.isArray(n.children) ? n.children : [];
    const suffix = kids.length ? `  (${kids.length})` : '';
    return `${kind} · ${name}${suffix}`;
  }

  // Draw a child subtree. `prefix` is the accumulated indent for this line's
  // continuation; `isLast` picks the elbow vs tee connector.
  function walk(n, prefix, isLast, depth) {
    count++;
    console.log(`${prefix}${isLast ? '└─ ' : '├─ '}${label(n)}`);
    if (depth >= maxDepth) {
      return;
    }
    const kids = Array.isArray(n.children) ? n.children : [];
    const childPrefix = prefix + (isLast ? '   ' : '│  ');
    kids.forEach((child, i) => walk(child, childPrefix, i === kids.length - 1, depth + 1));
  }

  // Root prints bare (no connector); its children start the tree drawing.
  count++;
  console.log(label(node));
  if (maxDepth >= 1) {
    const kids = Array.isArray(node.children) ? node.children : [];
    kids.forEach((child, i) => walk(child, '', i === kids.length - 1, 1));
  }
  return count;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.file) {
  usage();
  process.exit(args.file ? 0 : 1);
}

const session = createSession();
let loaded;
try {
  loaded = loadSource(session, args.file);
} catch (err) {
  console.error(`explore: ${err.message}`);
  process.exit(1);
}

const total = loaded.node.flatten().length;
console.log(`file:    ${args.file}`);
console.log(`format:  ${loaded.format}`);
console.log(`nodes:   ${total} (excluding source root)`);
console.log('');
const printed = printTree(loaded.node, args.depth);
if (args.depth !== Infinity) {
  console.log(`\n(showing ${printed} nodes to depth ${args.depth})`);
}
