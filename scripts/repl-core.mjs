// Copyright 2026 The MathWorks, Inc.
//
// Shared interactive REPL loop for data-explorer-core. A console for a human to
// investigate the parsed data model of Simulink files. Two independent cursors:
//
//   * the FILESYSTEM (cd/ls/pwd — real Unix semantics) is used only to find files
//     to open; it never touches the data model.
//   * the ACTIVE NODE (sel/up/down/next/pre) is a cursor over the loaded data-model
//     tree; props/get/set/add/rm/tree all act on it. The prompt shows the active node.
//
// `open` loads a source AND selects it; `load` loads without changing the active
// node. Extracted from scripts/repl.mjs so both `npm run repl` and the `dex` CLI
// drive the same loop. Not shipped — excluded from the tarball by the `files` list.
//
// startRepl(session, sources): sources is an ARRAY of ISourceNode; a virtual
// session root ('/') lists them as children. Launching with exactly one source
// selects it; otherwise the active node starts at the session root.

import { createInterface } from 'node:readline';
import { readdirSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { homedir } from 'node:os';
import { loadFromPath, loadDirectory } from '../dist/node/index.js';

const SUPPORTED = new Set(['.sldd', '.slx', '.mat', '.prj']);

// ---------- node helpers ----------

const nameOf = (n) => n.displayName || n.name || n.id || '(unnamed)';
const kindOf = (n) => n.kind || (n.isContainer ? 'container' : 'node');

function childByRef(node, ref) {
  const kids = node.children || [];
  if (/^\d+$/.test(ref)) return kids[Number(ref)] ?? null;
  // exact name match, else case-insensitive
  return (
    kids.find((c) => nameOf(c) === ref) ??
    kids.find((c) => nameOf(c).toLowerCase() === ref.toLowerCase()) ??
    null
  );
}

function propInfos(node) {
  if (typeof node.getProperties !== 'function') return [];
  return node.getProperties().map((pc) => node.getPropInfo(pc));
}

const HELP = `
Filesystem (find files to open — real cwd, like a shell)
  ls [dir]         list files in a directory (openable data files marked *)
  cd [dir]         change the working directory (no arg → home)
  pwd              print the working directory

Sources
  open <path>      load a file (or a dir of them) into the model AND select it
  load <path>      load into the model; leave the active node unchanged
  close [name|idx] unload a source (defaults to the active source)

Data model (navigate the active node — this drives props/get/set/add/rm/tree)
  sel [ref]        no arg: show the active node + numbered children;
                   ref = <name|idx|path|id> to select; '/' root; '..' parent
  up               up to parent        down   down to first child
  next             next sibling        pre    previous sibling
  tree [depth]     print the subtree under the active node

Read
  props            list properties of the active node (key = value)
  get <prop>       print one property value
  find <text>      search node names under all sources (prints paths)

Write (CRUD)
  set <prop> <value>   edit a property of the active node
  add <class> [name]   add an entry (the active node is the target section)
  rm                   delete the active node (selects its parent after)
  undo | redo          undo/redo the active source's last change

Misc
  help             this text
  exit | quit      leave (Ctrl-D also works)
`.trim();

export function startRepl(session, sources) {
  // A virtual session root always backs '/'. Its `children` alias the live
  // `sources` array (mutated in place by open/load/close), so mounting and
  // unmounting sources at runtime is reflected immediately.
  const vroot = {
    id: '__root__',
    name: '/',
    displayName: '/',
    kind: 'session',
    className: 'Session',
    icon: '',
    isContainer: true,
    isEntry: false,
    parent: null,
    children: sources,
    flatten() {
      return sources.flatMap((s) => s.flatten());
    },
    getProperties() {
      return [];
    },
  };

  // The active-node cursor. Launching with one source selects it; else start at '/'.
  let active = sources.length === 1 ? sources[0] : vroot;

  const childrenOf = (node) => node.children || [];
  const isSource = (node) => sources.includes(node);
  // Source roots have parent === null; treat the session root as their parent so
  // navigation (up/next/pre) can walk out of one source and across to the others.
  const parentOf = (node) => (node === vroot ? null : node.parent || vroot);

  // The source a node belongs to (or null at the session root).
  const sourceOf = (node) => {
    let n = node;
    while (n && n !== vroot) {
      if (isSource(n)) return n;
      n = n.parent;
    }
    return null;
  };

  const pathOf = (node) => {
    const parts = [];
    let n = node;
    while (n && n !== vroot) {
      parts.unshift(nameOf(n));
      n = n.parent;
    }
    return '/' + parts.join('/');
  };

  // Only pass REAL data-model nodes to setActive — the virtual root has no
  // getPropInfo and would break editProperty. Keeps the session's active node in
  // sync with the REPL cursor so props/set/add/rm operate on it.
  const safeSetActive = (node) => {
    if (node && node !== vroot && typeof node.getProperties === 'function') {
      session.setActive(node, node);
    }
  };

  const selectNode = (node) => {
    active = node;
    safeSetActive(node);
  };

  selectNode(active);

  // ---------- filesystem commands ----------

  function doLs(dir) {
    let entries;
    try {
      entries = readdirSync(dir || '.', { withFileTypes: true });
    } catch (err) {
      console.log(`ls: ${err.message}`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    if (!entries.length) {
      console.log('(empty)');
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        console.log(`  ${e.name}/`);
      } else {
        const openable = SUPPORTED.has(extname(e.name).toLowerCase());
        console.log(`  ${e.name}${openable ? '  *' : ''}`);
      }
    }
  }

  function doCd(dir) {
    try {
      process.chdir(dir || homedir());
    } catch (err) {
      console.log(`cd: ${err.message}`);
    }
  }

  // ---------- source commands ----------

  function ingestPath(path) {
    if (!path) {
      console.log('usage: open <path>  (a file, or a dir of .sldd/.slx/.mat/.prj)');
      return null;
    }
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch (err) {
      console.log(`cannot open ${path}: ${err.message}`);
      return null;
    }
    try {
      // The skips loadDirectory used to print itself. It reports them instead of
      // writing to the console, so the REPL says it — on stdout, like its other
      // messages, since here the terminal IS the consumer.
      const skipped = [];
      const loaded = isDir ? loadDirectory(session, path, skipped) : [loadFromPath(session, path)];
      for (const w of skipped) {
        console.log(`skipped ${w.message}`);
      }
      // loadFromPath/loadDirectory add to the session; mirror them into `sources`
      // (which backs '/') so the new mounts show up under the session root.
      for (const src of loaded) if (!sources.includes(src)) sources.push(src);
      return loaded;
    } catch (err) {
      console.log(`could not open ${path}: ${err.message}`);
      return null;
    }
  }

  function doOpen(path) {
    const loaded = ingestPath(path);
    if (!loaded || !loaded.length) return;
    selectNode(loaded[0]);
    if (loaded.length === 1) {
      console.log(`opened ${nameOf(loaded[0])} — ${loaded[0].flatten().length} nodes (now active)`);
    } else {
      console.log(`opened ${loaded.length} sources; active: ${nameOf(loaded[0])}`);
    }
  }

  function doLoad(path) {
    const loaded = ingestPath(path);
    if (!loaded || !loaded.length) return;
    if (loaded.length === 1) {
      console.log(`loaded ${nameOf(loaded[0])} — ${loaded[0].flatten().length} nodes (active unchanged)`);
    } else {
      console.log(`loaded ${loaded.length} sources (active unchanged)`);
    }
  }

  function doClose(ref) {
    if (!sources.length) {
      console.log('nothing to close (no sources loaded)');
      return;
    }
    let target;
    if (!ref) {
      target = sourceOf(active);
      if (!target) {
        console.log("usage: close <name|idx>  (or 'sel' into a source first, then 'close')");
        return;
      }
    } else {
      target = childByRef(vroot, ref);
      if (!target) {
        console.log(`no such source: ${ref}`);
        return;
      }
    }
    const label = nameOf(target);
    const wasInside = active === target || sourceOf(active) === target;
    session.removeDataSource(target.id);
    const idx = sources.indexOf(target);
    if (idx >= 0) sources.splice(idx, 1);
    if (wasInside) selectNode(vroot);
    console.log(`closed ${label}`);
  }

  // ---------- data-model navigation ----------

  function showActive() {
    console.log(`active: ${pathOf(active)}  [${kindOf(active)}]`);
    const kids = childrenOf(active);
    if (!kids.length) {
      console.log('  (no children)');
      return;
    }
    kids.forEach((c, i) => {
      const n = childrenOf(c).length;
      console.log(`  [${i}] ${kindOf(c)} · ${nameOf(c)}${n ? `  (${n})` : ''}`);
    });
  }

  function resolveSel(ref) {
    if (ref === '/') return vroot;
    if (ref === '..') return parentOf(active) || vroot;
    const leading = ref.startsWith('/');
    const parts = ref.replace(/^\//, '').split('/').filter(Boolean);
    if (!parts.length) return vroot;
    let cur = leading ? vroot : active;
    for (const part of parts) {
      const next = childByRef(cur, part);
      if (!next) {
        // last resort: a bare node id anywhere in the session
        if (parts.length === 1) {
          const byId = session.findNodeById(part);
          if (byId) return byId;
        }
        return null;
      }
      cur = next;
    }
    return cur;
  }

  function doSel(ref) {
    if (ref === undefined) {
      showActive();
      return;
    }
    const target = resolveSel(ref);
    if (!target) {
      console.log(`no such node: ${ref}`);
      return;
    }
    selectNode(target);
  }

  function navUp() {
    if (active === vroot) {
      console.log('at session root');
      return;
    }
    selectNode(parentOf(active) || vroot);
  }

  function navDown() {
    const kids = childrenOf(active);
    if (!kids.length) {
      console.log('(no children)');
      return;
    }
    selectNode(kids[0]);
  }

  function navSibling(delta) {
    const parent = parentOf(active);
    const sibs = parent ? childrenOf(parent) : [active];
    const idx = sibs.indexOf(active);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= sibs.length) {
      console.log(delta > 0 ? '(no next sibling)' : '(no previous sibling)');
      return;
    }
    selectNode(sibs[to]);
  }

  function doTree(depthArg) {
    const maxDepth = depthArg ? Number(depthArg) : Infinity;
    const walk = (n, prefix, isLast, depth) => {
      const kids = childrenOf(n);
      const label = `${kindOf(n)} · ${nameOf(n)}${kids.length ? `  (${kids.length})` : ''}`;
      console.log(prefix === null ? label : `${prefix}${isLast ? '└─ ' : '├─ '}${label}`);
      if (depth >= maxDepth) return;
      const childPrefix = prefix === null ? '' : prefix + (isLast ? '   ' : '│  ');
      kids.forEach((c, i) => walk(c, childPrefix, i === kids.length - 1, depth + 1));
    };
    walk(active, null, true, 0);
  }

  // ---------- read ----------

  function doProps() {
    const infos = propInfos(active);
    if (!infos.length) {
      console.log('(no properties)');
      return;
    }
    for (const info of infos) {
      const lock = info.editable ? '' : '  (read-only)';
      console.log(`  ${info.key} = ${JSON.stringify(info.displayValue)}${lock}`);
    }
  }

  function doGet(prop) {
    const info = propInfos(active).find((i) => i.key === prop || i.displayName === prop);
    if (!info) {
      console.log(`no such property: ${prop}`);
      return;
    }
    console.log(info.displayValue);
  }

  function doFind(text) {
    if (!text) {
      console.log('usage: find <text>');
      return;
    }
    const needle = text.toLowerCase();
    const hits = vroot.flatten().filter((n) => nameOf(n).toLowerCase().includes(needle));
    if (!hits.length) {
      console.log('(no matches)');
      return;
    }
    hits.slice(0, 50).forEach((n) => console.log(`  ${pathOf(n)}  [${kindOf(n)}]`));
    if (hits.length > 50) console.log(`  ... and ${hits.length - 50} more`);
  }

  // ---------- write ----------

  function doSet(prop, value) {
    const info = propInfos(active).find((i) => i.key === prop || i.displayName === prop);
    if (!info) {
      console.log(`no such property: ${prop}`);
      return;
    }
    if (!info.editable) {
      console.log(`property is read-only: ${prop}`);
      return;
    }
    safeSetActive(active);
    // setProperty (and its undo) expect the STRING form of values — the webview
    // always passes strings — so use displayValue as the old value for undo.
    const result = session.editProperty(active.id, info.key, value, info.displayValue);
    if (result === true) {
      console.log(`set ${prop} = ${JSON.stringify(value)}`);
    } else if (result && result.error) {
      console.log(`rejected: ${result.reason} (valid: ${result.validValue})`);
    } else {
      console.log('edit failed (is this the active node / is the prop editable?)');
    }
  }

  function doAdd(className, name) {
    if (!className) {
      console.log('usage: add <class> [name]');
      return;
    }
    safeSetActive(active);
    const node = session.addEntry(active.name, className, name);
    if (node) {
      console.log(`added ${kindOf(node)} · ${nameOf(node)} (id: ${node.id})`);
      selectNode(node);
    } else {
      console.log(`could not add "${className}" here (is the active node a section that accepts it?)`);
    }
  }

  function doRm() {
    if (active === vroot) {
      console.log('nothing selected (sel a node first)');
      return;
    }
    if (isSource(active)) {
      console.log("cannot remove a source root — use 'close' to unload it");
      return;
    }
    const parent = parentOf(active) || vroot;
    const label = `${kindOf(active)} · ${nameOf(active)}`;
    safeSetActive(active);
    const ok = session.deleteNode();
    if (ok) {
      console.log(`removed ${label}`);
      selectNode(parent);
    } else {
      console.log('delete failed (only entries/children of a source can be removed)');
    }
  }

  // tokenize respecting simple double-quotes so `set X "a b c"` works
  function tokenize(line) {
    const out = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(line))) out.push(m[1] ?? m[2]);
    return out;
  }

  function handle(line) {
    const [cmd, ...rest] = tokenize(line.trim());
    if (!cmd) return;
    switch (cmd) {
      // filesystem
      case 'ls': return doLs(rest[0]);
      case 'cd': return doCd(rest[0]);
      case 'pwd': return void console.log(process.cwd());
      // sources
      case 'open': return doOpen(rest[0]);
      case 'load': return doLoad(rest[0]);
      case 'close': return doClose(rest[0]);
      // data-model navigation
      // node names commonly contain spaces ("Design Data"); take the whole
      // remainder as the ref so `sel Design Data` works without quoting.
      case 'sel': return doSel(rest.length ? rest.join(' ') : undefined);
      case 'up': return navUp();
      case 'down': return navDown();
      case 'next': return navSibling(1);
      case 'pre': return navSibling(-1);
      case 'tree': return doTree(rest[0]);
      // read
      case 'props': return doProps();
      case 'get': return doGet(rest[0]);
      case 'find': return doFind(rest.join(' '));
      // write
      case 'set': return doSet(rest[0], rest.slice(1).join(' '));
      case 'add': return doAdd(rest[0], rest[1]);
      case 'rm': return doRm();
      case 'undo': return void (session.undo(), console.log('undo'));
      case 'redo': return void (session.redo(), console.log('redo'));
      // misc
      case 'help': return void console.log(HELP);
      case 'exit':
      case 'quit': return rl.close();
      default: return void console.log(`unknown command: ${cmd} (try 'help')`);
    }
  }

  if (sources.length === 1) {
    console.log(`Loaded ${nameOf(sources[0])} — ${sources[0].flatten().length} nodes (active). Type 'help', 'exit' to quit.`);
  } else if (sources.length === 0) {
    console.log(`Empty session — 'open <path>' to load a file or dir. Type 'help', 'exit' to quit.`);
  } else {
    console.log(`Loaded ${sources.length} sources — 'sel' to pick one. Type 'help', 'exit' to quit.`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => rl.setPrompt(`dex ${pathOf(active)}> `);
  prompt();
  rl.prompt();
  rl.on('line', (line) => {
    try {
      handle(line);
    } catch (err) {
      console.error(`error: ${err.message}`);
    }
    prompt();
    rl.prompt();
  });
  rl.on('close', () => {
    console.log('bye');
    process.exit(0);
  });
}
