% How does MATLAB R2027a write, in a TEXT dictionary, a bus that holds one element, after an
% element is added to it and after one is then removed again; and what does it read back of core's
% saves of the same edits? (B-24, group H, measured 2026-10-19.)
%
% MATLAB writes a one-element Elements_internal as the element itself, `{_id, _object_class,
% _properties}` (../artifacts/text/params.sldd's MyConnBus), and one of more elements as the array,
% `{_array_class, _dimensions, _elements}`. Core rebuilt every bus's Elements_internal in the array
% form, so a save that changed nothing differed from such a file there.
%
% MAKE (BUS_ONE_MAKE=1): a text dictionary holding a Simulink.Bus, a Simulink.ConnectionBus and a
% Simulink.ServiceBus of one element each, saved (bus_one_element_text.sldd); a copy of it with an
% element added to each (self_added.sldd); a copy of that with the added element removed again
% (self_added_removed.sldd), and one with the first element removed instead
% (self_added_removed_first.sldd). Every file is made here, under $BUS_ONE_OUT.
% READ (always): what MATLAB reads of each of those, and of each dictionary
% bus_one_element_text.mjs saved through core from bus_one_element_text.sldd (core_*.sldd), bus by
% bus: its class, its elements' class and names, and any warning, or the error.
%
% Run: env BUS_ONE_OUT=/tmp/busone BUS_ONE_MAKE=1 mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_bus_one_element_text.m')"
% then: cp /tmp/busone/bus_one_element_text.sldd /tmp/busone/self_*.sldd test/fixtures/bus_one_element/
%       node test/parity/matlab/bus_one_element_text.mjs /tmp/busone   (with dist built)
%       env BUS_ONE_OUT=/tmp/busone mw -using Bmain matlab -nodesktop -batch "run(...)"   (READ only)
%       cp /tmp/busone/bus_one_element_text.truth.json test/parity/matlab/
% Prints BUS_ONE_ELEMENT_TEXT OK on its last line. Graded by ../../busOneElementText.test.ts.
% Output: bus_one_element_text.truth.json, {version, release, date, rows}: each row a file, an
% entry, for a core save the `fragment` it wrote there (its cases.json; '' for MATLAB's own files),
% and `reads`: {class, elementClass, names, warning} or {error}.

outdir = getenv('BUS_ONE_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'busone'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);
ENTRIES = {'OneBus', 'OneConnBus', 'OneServiceBus'};

if strcmp(getenv('BUS_ONE_MAKE'), '1')
  made = fullfile(outdir, 'bus_one_element_text.sldd');
  if exist(made, 'file'), delete(made); end
  dd = Simulink.data.dictionary.create(made); dd.FileFormat = 'uncompressed-text';
  sec = getSection(dd, 'Design Data');
  b = Simulink.Bus; e = Simulink.BusElement; e.Name = 'x'; b.Elements = e;
  addEntry(sec, 'OneBus', b);
  c = Simulink.ConnectionBus; ce = Simulink.ConnectionElement; ce.Name = 'c1'; c.Elements = ce;
  addEntry(sec, 'OneConnBus', c);
  s = Simulink.ServiceBus; fe = Simulink.FunctionElement; fe.Prototype = 'y = svc(u,v)'; s.Elements = fe;
  addEntry(sec, 'OneServiceBus', s);
  saveChanges(dd); close(dd);
  Simulink.data.dictionary.closeAll('-discard');
  % Each element added is named as core names the one it adds (BaseBusNode / ServiceBusNode.addChildNode).
  added = {'a', 'a', 'f1'};
  editCopy(made, fullfile(outdir, 'self_added.sldd'), ENTRIES, @(v, k) appendElement(v, added{k}));
  editCopy(fullfile(outdir, 'self_added.sldd'), fullfile(outdir, 'self_added_removed.sldd'), ENTRIES, @(v, k) dropElement(v, numel(v.Elements)));
  editCopy(fullfile(outdir, 'self_added.sldd'), fullfile(outdir, 'self_added_removed_first.sldd'), ENTRIES, @(v, k) dropElement(v, 1));
end

files = [{'bus_one_element_text.sldd'}, listed(outdir, 'self_*.sldd'), listed(outdir, 'core_*.sldd')];
% The core half's rows, each save's Elements_internal as written, carried into the truth.
cases = struct('file', {}, 'entry', {}, 'fragment', {});
if exist(fullfile(outdir, 'cases.json'), 'file'), cases = jsondecode(fileread(fullfile(outdir, 'cases.json'))); end
rows = {};
for f = 1:numel(files)
  for k = 1:numel(ENTRIES)
    reads = readBus(fullfile(outdir, files{f}), ENTRIES{k});
    at = find(strcmp({cases.file}, files{f}) & strcmp({cases.entry}, ENTRIES{k}));
    fragment = '';
    if ~isempty(at), fragment = cases(at(1)).fragment; end
    rows{end+1} = struct('file', files{f}, 'entry', ENTRIES{k}, 'fragment', fragment, 'reads', reads); %#ok<AGROW>
    fprintf('READ %-32s %-14s => %s\n', files{f}, ENTRIES{k}, jsonencode(reads));
  end
end
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd')), 'rows', {rows});
fid = fopen(fullfile(outdir, 'bus_one_element_text.truth.json'), 'w');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('BUS_ONE_ELEMENT_TEXT OK\n');

function names = listed(outdir, pattern)
  d = dir(fullfile(outdir, pattern));
  names = sort({d.name});
end

% Copy `from` to `to`, and in the copy apply `change` to each entry's value and save.
function editCopy(from, to, entries, change)
  if exist(to, 'file'), delete(to); end
  copyfile(from, to);
  dd = Simulink.data.dictionary.open(to);
  sec = getSection(dd, 'Design Data');
  for k = 1:numel(entries)
    en = getEntry(sec, entries{k});
    setValue(en, change(getValue(en), k));
  end
  saveChanges(dd); close(dd);
  Simulink.data.dictionary.closeAll('-discard');
end

% A function element is named by its prototype, as ServiceBusNode.addChildNode writes one.
function v = appendElement(v, name)
  el = feval(class(v.Elements));
  if isa(el, 'Simulink.FunctionElement'), el.Prototype = ['y = ' name '(u,v)']; else, el.Name = name; end
  v.Elements(end + 1) = el;
end

function v = dropElement(v, k)
  v.Elements(k) = [];
end

function reads = readBus(file, entry)
  Simulink.data.dictionary.closeAll('-discard');
  lastwarn('');
  try
    dd = Simulink.data.dictionary.open(file);
    v = getValue(getEntry(getSection(dd, 'Design Data'), entry));
    names = arrayfun(@(e) e.Name, v.Elements, 'UniformOutput', false);
    [w, ~] = lastwarn;
    reads = struct('class', class(v), 'elementClass', class(v.Elements), 'names', {names(:)'}, 'warning', w);
    close(dd);
  catch err
    reads = struct('error', err.message);
  end
  Simulink.data.dictionary.closeAll('-discard');
end
