#!/usr/bin/env node
// Copyright 2026 The MathWorks, Inc.
//
// Dev wrapper kept for `npm run repl`. Delegates to the shared loop in repl-core.mjs.
// Not shipped — excluded from the published tarball by the `files` allowlist.
//
// Usage:
//   npm run build
//   npm run repl -- path/to/file.sldd
//
// Supported files: .sldd (textual JSON or binary), .slx, .mat, .prj

import { createSession, loadFromPath } from '../dist/node/index.js';
import { startRepl } from './repl-core.mjs';

const file = process.argv[2];
if (!file || file === '-h' || file === '--help') {
  console.log('Usage: npm run repl -- <file>');
  process.exit(file ? 0 : 1);
}
const session = createSession();
startRepl(session, [loadFromPath(session, file)]);
