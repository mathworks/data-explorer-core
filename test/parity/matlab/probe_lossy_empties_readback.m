% How does MATLAB read back, out of a TEXT dictionary, an empty string, an empty function handle
% and an N-D empty, at each place a value can stand, and how does it spell one there itself?
% (Agenda follow-up 4 of group F's reviews, "lossy host empties", ruled by group G, measured
% 2026-10-18.)
%
% A text dictionary was given `[]` for a host's string or function-handle `{_type, _emptyDims}` at
% an entry or an object's property, which reopens as a double 0x0, and the form as handed in at a
% struct field or a cell; and `[]`, `''` or the bare `Matrix(…)` header for a binary dictionary's
% N-D empty at a property, a field or a cell, with no refusal past an int32. This probe asks,
% place by place:
%
%   SELF        what MATLAB's own text writer writes for each value, and what MATLAB reads back
%               out of its own text file and its own binary one. The binary file holds each value
%               MATLAB saves there alone (a scratch dictionary per value), and is the input
%               test/lossyEmptiesReadback.test.ts pastes into a text dictionary;
%   CANDIDATES  for each spelling in cands.json (test/parity/matlab/lossy_empties_readback.mjs
%               writes it from core's own output), hand-patched into a MATLAB-made text
%               dictionary, what MATLAB reads back.
%
% The places: an entry's value (entry), a cell's element (cell), a struct field (field), a
% Simulink.Parameter's Value (param) and a user object's property (prop, Widget.Scalar, in
% Other Data).
%
% Not in the candidates, because each one crashes MATLAB R2027a (27.1.0.3409468) with a
% segmentation violation as it opens the dictionary, at the entry, the first place asked: an
% N-D empty enumeration spelled as the bag MATLAB writes for a non-empty N-D one
% (MatWriter.enumTextForm), `{"_array_class": "GearMode", "_dimensions": [1, 1], "_elements":
% [{"_enum_value": <stream>}], "_mw_element_type": "MATLABArray"}`, around an empty 0x2x2 stream
% of int32, of double or of uint8, with an `_id` in the element, without `_mw_element_type`, or
% around `{"_type": "int32", "_value": "Matrix(0,2)"}`: six candidates, one MATLAB each, six crashes.
%
% Run: node test/parity/matlab/lossy_empties_readback.mjs /tmp/lossyempty   (with dist built)
%      env LOSSY_EMPTY_OUT=/tmp/lossyempty mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_lossy_empties_readback.m')"
% then: cp /tmp/lossyempty/lossy_empties_readback.truth.json test/parity/matlab/
%       cp /tmp/lossyempty/self_compressed_binary.sldd test/fixtures/lossy_empties_readback_binary.sldd
% Prints LOSSY_EMPTIES_READBACK OK on its last line. A function handle is kept out of the binary
% file: MATLAB writes one there in its MAT encoding, which carries the matlabroot of the MATLAB
% that wrote it (test/fixtureHygiene.test.ts).
% Output: lossy_empties_readback.truth.json, {version, release, date, self, candidates}:
%   self:       id, expr, place, text (MATLAB's own spelling at that place, or '' when it refused
%               the value), refused (its message), textReads, binaryReads (empty when the value
%               is not in the binary file), binarySaveError (why not, when its save failed);
%   candidates: id, spelling, place, reads; each `reads` {class, size} or {error}.

outdir = getenv('LOSSY_EMPTY_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'lossyempty'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end
here = fileparts(mfilename('fullpath'));
addpath(fullfile(here, '..', '..', 'fixtures', 'mcos'));   % Widget, GearMode
rehash;
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);

%% SELF: what MATLAB writes, and reads back of its own files
EXPR = { ...
  'Str03',   'strings(0,3)'; ...
  'Str00',   'strings(0,0)'; ...
  'Str10',   'strings(1,0)'; ...
  'Str022',  'strings(0,2,2)'; ...
  'Fh00',    'function_handle.empty'; ...
  'Fh10',    'function_handle.empty(1,0)'; ...
  'D022',    'zeros(0,2,2)'; ...
  'I8203',   'int8(zeros(2,0,3))'; ...
  'Lg012',   'false(0,1,2)'; ...
  'Ch002',   'char(zeros(0,0,2))'; ...
  'En022',   'GearMode.empty(0,2,2)'; ...
  'EnND',    'repmat(GearMode.Drive,1,2,2)'; ...
  'DWide',   'zeros(0,2,2147483648)'; ...
  'I8Wide',  'int8(zeros(2147483648,0,2))'; ...
  'LgWide',  'false(0,2,2147483648)'; ...
  'ChWide',  'char(zeros(0,2,2147483648))'; ...
  'EnWide',  'GearMode.empty(0,2,2147483648)'};
NOT_IN_BINARY = {'Fh00', 'Fh10'};
PLACES = {'entry', 'cell', 'field', 'param', 'prop'};
V = cell(size(EXPR, 1), 1);
made = true(size(EXPR, 1), 1);
for i = 1:size(EXPR, 1)
  try
    V{i} = eval(EXPR{i,2});
  catch e
    made(i) = false;
    fprintf('MAKE %-7s %s FAILED %s\n', EXPR{i,1}, EXPR{i,2}, strrep(e.message, newline, ' '));
  end
end
% Which values a binary dictionary saves: each alone, at its five places, in a scratch file.
binarySaveError = repmat({''}, size(EXPR, 1), 1);
for i = 1:size(EXPR, 1)
  if ~made(i) || any(strcmp(EXPR{i,1}, NOT_IN_BINARY)), continue; end
  fn = fullfile(outdir, 'scratch_binary.sldd');
  if exist(fn, 'file'), delete(fn); end
  dd = Simulink.data.dictionary.create(fn); dd.FileFormat = 'compressed-binary';
  addAll(dd, EXPR(i,1), V(i), PLACES);
  try
    saveChanges(dd);
  catch e
    binarySaveError{i} = strrep(e.message, newline, ' ');
  end
  close(dd);
  Simulink.data.dictionary.closeAll('-discard');
end
inBinary = made & cellfun(@isempty, binarySaveError) & ~ismember(EXPR(:,1), NOT_IN_BINARY);
files = struct();
for fmt = {'uncompressed-text', 'compressed-binary'}
  fn = fullfile(outdir, ['self_' strrep(fmt{1}, '-', '_') '.sldd']);
  if exist(fn, 'file'), delete(fn); end
  dd = Simulink.data.dictionary.create(fn); dd.FileFormat = fmt{1};
  if strcmp(fmt{1}, 'compressed-binary'), keep = inBinary; else, keep = made; end
  refused = addAll(dd, EXPR(keep,1), V(keep), PLACES);
  saveChanges(dd); close(dd);
  files.(strrep(fmt{1}, '-', '_')) = struct('fn', fn, 'refused', refused);
end
Simulink.data.dictionary.closeAll('-discard');
textFile = files.uncompressed_text; binFile = files.compressed_binary;
txt = fileread(textFile.fn);
self = struct('id', {}, 'expr', {}, 'place', {}, 'text', {}, 'refused', {}, 'textReads', {}, 'binaryReads', {}, 'binarySaveError', {});
for i = 1:size(EXPR, 1)
  if ~made(i), continue; end
  for q = 1:numel(PLACES)
    [nm, sec] = placed(EXPR{i,1}, PLACES{q});
    row = struct('id', EXPR{i,1}, 'expr', EXPR{i,2}, 'place', PLACES{q}, 'text', '', 'refused', '', 'textReads', [], 'binaryReads', [], 'binarySaveError', binarySaveError{i});
    if isfield(textFile.refused, nm)
      row.refused = textFile.refused.(nm);
    else
      row.text = spellingAt(txt, nm, PLACES{q});
      row.textReads = readAt(textFile.fn, nm, sec, PLACES{q});
    end
    if inBinary(i) && ~isfield(binFile.refused, nm)
      row.binaryReads = readAt(binFile.fn, nm, sec, PLACES{q});
    end
    self(end+1) = row; %#ok<AGROW>
    fprintf('SELF %-7s %-5s text=%s refused=%s => %s | bin %s\n', EXPR{i,1}, PLACES{q}, regexprep(row.text(1:min(end, 160)), '\s+', ' '), row.refused, readsText(row.textReads), readsText(row.binaryReads));
  end
end

%% CANDIDATES: hand-patched spellings read back
base = fullfile(outdir, 'cand_base.sldd');
if exist(base, 'file'), delete(base); end
dd = Simulink.data.dictionary.create(base); dd.FileFormat = 'uncompressed-text';
design = getSection(dd, 'Design Data'); other = getSection(dd, 'Other Data');
addEntry(design, 'k_entry', 987654321);
addEntry(design, 'k_cell', {987654322});
addEntry(design, 'k_param', Simulink.Parameter(987654323));
addEntry(design, 'k_field', struct('f', 987654324));
w = Widget; w.Scalar = 987654325;
addEntry(other, 'k_prop', w);
saveChanges(dd); close(dd);
Simulink.data.dictionary.closeAll('-discard');
baseText = fileread(base);
CANDS = jsondecode(fileread(fullfile(outdir, 'cands.json')));
KEYS = {'entry', 'k_entry', 987654321, 'design'; 'cell', 'k_cell', 987654322, 'design'; ...
        'param', 'k_param', 987654323, 'design'; 'field', 'k_field', 987654324, 'design'; ...
        'prop', 'k_prop', 987654325, 'other'};
candidates = struct('id', {}, 'spelling', {}, 'place', {}, 'reads', {});
for k = 1:numel(CANDS)
  for q = 1:size(KEYS, 1)
    [t, ok] = putCandidate(baseText, KEYS{q,3}, CANDS(k).spelling);
    if ~ok
      reads = struct('error', 'PLACEHOLDER-NOT-FOUND');
    else
      fn = fullfile(outdir, sprintf('cand_%02d_%s.sldd', k, KEYS{q,1}));
      fid = fopen(fn, 'w', 'n', 'UTF-8'); fwrite(fid, t, 'char'); fclose(fid);
      reads = readAt(fn, KEYS{q,2}, KEYS{q,4}, KEYS{q,1});
    end
    candidates(end+1) = struct('id', CANDS(k).id, 'spelling', CANDS(k).spelling, 'place', KEYS{q,1}, 'reads', reads); %#ok<AGROW>
    fprintf('CAND %-8s %-5s => %s\n', CANDS(k).id, KEYS{q,1}, readsText(reads));
  end
end

truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd')), ...
  'self', self, 'candidates', candidates);
fid = fopen(fullfile(outdir, 'lossy_empties_readback.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('LOSSY_EMPTIES_READBACK OK\n');

% Each value at each place in dictionary `dd`; what MATLAB refused, by entry name.
function refused = addAll(dd, ids, vals, places)
  design = getSection(dd, 'Design Data'); other = getSection(dd, 'Other Data');
  refused = struct();
  for i = 1:numel(ids)
    for q = 1:numel(places)
      [nm, sec] = placed(ids{i}, places{q});
      try
        val = valueAt(vals{i}, places{q});
        if strcmp(sec, 'other'), addEntry(other, nm, val); else, addEntry(design, nm, val); end
      catch e
        refused.(nm) = strrep(e.message, newline, ' ');
      end
    end
  end
end

% The entry name and its section for value `id` standing at `place`.
function [nm, sec] = placed(id, place)
  sec = 'design';
  pre = struct('entry', 'e_', 'cell', 'c_', 'field', 's_', 'param', 'p_', 'prop', 'w_');
  nm = [pre.(place) id];
  if strcmp(place, 'prop'), sec = 'other'; end
end

% The value an entry holds for `v` standing at `place`.
function val = valueAt(v, place)
  switch place
    case 'entry', val = v;
    case 'cell',  val = {v};
    case 'field', val = struct('f', {v});
    case 'param', val = Simulink.Parameter; val.Value = v;
    case 'prop',  val = Widget; val.Scalar = v;
  end
end

% MATLAB's own spelling of the value at `place` in entry `nm`: the raw JSON text after the
% place's key, for a value no deeper than one object or one flat list; '?ABSENT' when MATLAB
% wrote no such key there, and '?' + the next 400 characters for a deeper value.
function s = spellingAt(txt, nm, place)
  at = strfind(txt, ['"name": "' nm '"']);
  if numel(at) ~= 1, s = '?NAME'; return; end
  rest = txt(at + 1:end);
  next = strfind(rest, '"name": "');
  if ~isempty(next), rest = rest(1:next(1) - 1); end
  keyOf = struct('entry', '"value":', 'cell', '"_elements":', 'field', '"f":', 'param', '"Value":', 'prop', '"Scalar":');
  k = strfind(rest, keyOf.(place));
  if isempty(k), s = '?ABSENT'; return; end
  rest = rest(k(1) + numel(keyOf.(place)):end);
  if strcmp(place, 'cell'), rest = regexprep(rest, '^\s*\[', '', 'once'); end
  tok = regexp(rest, '^\s*(\[[^\[\]{}]*\]|""|\{[^{}]*\})', 'tokens', 'once');
  if isempty(tok), s = ['?' rest(1:min(end, 400))]; else, s = tok{1}; end
end

% What MATLAB reads at `place` in entry `nm` of file `fn`: {class, size} or {error}.
function r = readAt(fn, nm, sec, place)
  try
    Simulink.data.dictionary.closeAll('-discard');
    dd = Simulink.data.dictionary.open(fn);
    if strcmp(sec, 'other'), s = getSection(dd, 'Other Data'); else, s = getSection(dd, 'Design Data'); end
    v = getValue(getEntry(s, nm));
    switch place
      case 'cell',  v = v{1};
      case 'field', v = v.f;
      case 'param', v = v.Value;
      case 'prop',  v = v.Scalar;
    end
    r = struct('class', class(v), 'size', size(v));
    close(dd);
  catch e
    r = struct('error', strrep(e.message, newline, ' '));
  end
  Simulink.data.dictionary.closeAll('-discard');
end

function s = readsText(r)
  if isempty(r), s = '-'; elseif isfield(r, 'error'), s = ['ERROR ' r.error];
  else, s = sprintf('class=%s size=%s', r.class, mat2str(r.size)); end
end

% `txt` with the one value MATLAB wrote as the placeholder number `ph` replaced by `cand`.
function [txt, ok] = putCandidate(txt, ph, cand)
  phs = sprintf('%d', ph);
  [s, e] = regexp(txt, ['(?<![\d.])' phs '(\.0)?(?![\d])'], 'start', 'end');
  ok = numel(s) == 1;
  if ok, txt = [txt(1:s-1) cand txt(e+1:end)]; end
end
