#!/usr/bin/env node
// Copyright 2026 The MathWorks, Inc.
//
// `dex` — the data-explorer CLI. Human-verification REPL + machine-readable one-shot
// commands for AI-agent workflows. Built entirely on the core API (createSession +
// loadFromPath/loadDirectory + toDTO) — no parsing logic of its own. Co-located with
// core so `npm run build && npm run dex -- <dir>` drives the whole stack in one repo.
//
// Dev-only: run via `npm run dex --`, not a `bin`. A `bin` field would force this file
// into the published tarball (npm ignores the `files` allowlist for bin targets),
// violating core's "ship dist/ only, no bin" posture. The command moves to a `bin` in
// a separate workspace package at publish time (see the design's packaging section).
//
//   npm run dex --                            REPL, empty session
//   npm run dex -- file.sldd                  REPL, load one file
//   npm run dex -- some_dir/                  REPL, load all supported files in the dir
//   npm run dex -- tree  <file> [--depth N] [--json]
//   npm run dex -- props <file> <node-path> [--json]
//   npm run dex -- get   <file> <node-path> <prop> [--json]

import { statSync } from 'node:fs';
import { createSession, loadFromPath, loadDirectory } from '../dist/node/index.js';
import { toDTO } from '../dist/index.js';
import { startRepl } from '../scripts/repl-core.mjs';

const argv = process.argv.slice(2);
const ONE_SHOT = new Set(['tree', 'props', 'get']);

const nameOf = (n) => n.displayName || n.name || n.id || '(unnamed)';
const kindOf = (n) => n.kind || (n.isContainer ? 'container' : 'node');

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Resolve a node-path (e.g. "/Design Data/Number", names or numeric indices) or a
// bare node id, against a single loaded source. Returns the node or null.
function resolvePath(session, src, spec) {
  if (!spec || spec === '/') return src;
  const byId = session.findNodeById(spec);
  if (byId) return byId;
  const parts = spec.replace(/^\//, '').split('/').filter(Boolean);
  let cur = src;
  for (const part of parts) {
    const kids = cur.children || [];
    const next = /^\d+$/.test(part)
      ? kids[Number(part)]
      : kids.find((c) => nameOf(c) === part) ??
        kids.find((c) => nameOf(c).toLowerCase() === part.toLowerCase());
    if (!next) return null;
    cur = next;
  }
  return cur;
}

function printTree(node, maxDepth) {
  const walk = (n, prefix, isLast, depth) => {
    const kids = n.children || [];
    const label = `${kindOf(n)} · ${nameOf(n)}${kids.length ? `  (${kids.length})` : ''}`;
    console.log(prefix === null ? label : `${prefix}${isLast ? '└─ ' : '├─ '}${label}`);
    if (depth >= maxDepth) return;
    const childPrefix = prefix === null ? '' : prefix + (isLast ? '   ' : '│  ');
    kids.forEach((c, i) => walk(c, childPrefix, i === kids.length - 1, depth + 1));
  };
  walk(node, null, true, 0);
}

function loadOne(cmd, file) {
  const session = createSession();
  let src;
  try {
    src = loadFromPath(session, file);
  } catch (e) {
    console.error(`dex ${cmd}: ${e.message}`);
    process.exit(1);
  }
  return { session, src };
}

function runOneShot() {
  const cmd = argv[0];
  const json = argv.includes('--json');
  const rest = argv.slice(1).filter((a) => a !== '--json');

  let depth = Infinity;
  const depthIdx = rest.indexOf('--depth');
  if (depthIdx >= 0) {
    depth = Number(rest[depthIdx + 1]);
    // Reject NaN/negative up front — otherwise the two tree paths diverge silently:
    // text expands fully (n >= NaN is false), --json nests nothing (NaN > 0 is false),
    // and the bad --json is the machine contract an agent parses.
    if (!Number.isFinite(depth) || depth < 0) {
      console.error(`dex ${cmd}: --depth requires a non-negative integer`);
      process.exit(1);
    }
    rest.splice(depthIdx, 2);
  }

  const [file, nodePath, prop] = rest;
  if (!file) {
    console.error(`dex ${cmd}: missing <file>`);
    process.exit(1);
  }

  const { session, src } = loadOne(cmd, file);

  if (cmd === 'tree') {
    if (json) {
      const dtoDepth = depth === Infinity ? 64 : depth;
      console.log(JSON.stringify(toDTO(src, { depth: dtoDepth }), null, 2));
    } else {
      printTree(src, depth);
    }
    return;
  }

  const target = resolvePath(session, src, nodePath);
  if (!target) {
    console.error(`dex ${cmd}: no node at "${nodePath ?? ''}"`);
    process.exit(1);
  }

  if (cmd === 'props') {
    const dto = toDTO(target);
    if (json) {
      console.log(JSON.stringify(dto.props, null, 2));
    } else if (!dto.props.length) {
      console.log('(no properties)');
    } else {
      console.log(
        dto.props
          .map((p) => `${p.key} = ${p.value}${p.editable ? '' : '  (read-only)'}`)
          .join('\n'),
      );
    }
    return;
  }

  if (cmd === 'get') {
    if (!prop) {
      console.error('dex get: missing <prop>');
      process.exit(1);
    }
    const dto = toDTO(target);
    const found = dto.props.find((p) => p.key === prop || p.displayName === prop);
    if (!found) {
      console.error(`dex get: no property "${prop}"`);
      process.exit(1);
    }
    console.log(json ? JSON.stringify(found, null, 2) : found.value);
    return;
  }
}

if (ONE_SHOT.has(argv[0])) {
  runOneShot();
} else {
  const arg = argv[0];
  const session = createSession();
  let sources = [];
  if (!arg) {
    // empty session
  } else if (isDir(arg)) {
    // loadDirectory no longer writes to stderr itself — a library has no business
    // doing that — so the CLI collects the skips and prints them. Without this a
    // folder with one corrupt file would just look smaller than it is.
    const skipped = [];
    sources = loadDirectory(session, arg, skipped);
    console.log(`Loaded ${sources.length} source(s) from ${arg}`);
    for (const w of skipped) {
      console.error(`dex: ${w.message}`);
    }
  } else {
    try {
      sources = [loadFromPath(session, arg)];
    } catch (e) {
      console.error(`dex: ${e.message}`);
      process.exit(1);
    }
  }
  startRepl(session, sources);
}
