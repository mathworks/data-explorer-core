% How does MATLAB read back a classed or shaped EMPTY out of a TEXT dictionary, at each
% place a value can stand, and how does it spell one there itself?  (1A-TEXT, CELL-EMPTIES-87
% and D8 of the 2026-10-13 save decisions, measured 2026-10-18 and ruled by group F.)
%
% A binary dictionary states an empty as its class and a Dimension (`<P Name="Value"
% Class="int8" Dimension="0*3"/>`), and core holds one so, with its class and its size. Pasted
% into a TEXT dictionary, it was written `[]` or `''` at an entry, a property or a field, which
% MATLAB reopens as a double or a char 0x0. This probe asks, place by place:
%
%   SELF        what MATLAB's own text writer writes for each empty, and what MATLAB reads back
%               out of its own text file and its own binary one (MATLAB's text writer loses the
%               size of every rank-2 empty; its binary writer keeps them all);
%   CANDIDATES  for each candidate spelling, hand-patched into a MATLAB-made text dictionary,
%               what MATLAB reads back.
%
% The places: an entry's value (`entry`), a cell's element (`cell`), a struct field (`field`),
% a Simulink.Parameter's Value (`param`) and a user object's property (`prop`, Widget.Scalar,
% in 'Other Data', the section a user class may be stored in).
%
% Run: env TEXT_EMPTY_OUT=/tmp/textempty mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_text_empty_readback.m')"
% then: cp /tmp/textempty/text_empty_readback.truth.json test/parity/matlab/
%       cp /tmp/textempty/self_compressed_binary.sldd test/fixtures/text_empty_readback_binary.sldd
% Prints TEXT_EMPTY_READBACK OK on its last line. test/textEmptyReadback.test.ts reads both: the
% binary dictionary is MATLAB's own, every value at every place it accepted, which the test pastes
% into a text dictionary and grades the spelling written against the truth.
% Output: text_empty_readback.truth.json, {version, release, date, self, candidates}:
%   self:       id, expr, place, text (MATLAB's own spelling, the raw JSON text at that place, or
%               '' when it refused the value), refused (its message), textReads, binaryReads;
%   candidates: spelling, place, reads; each `reads` {class, size} or {error}.

outdir = getenv('TEXT_EMPTY_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'textempty'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end
here = fileparts(mfilename('fullpath'));
addpath(fullfile(here, '..', '..', 'fixtures', 'mcos'));   % Widget, WidgetPart
% An integer enumeration of its own, the kind dSLDD_JSONApi.sldd's dSomeColors is.
fid = fopen(fullfile(outdir, 'dProbeColors.m'), 'w');
fprintf(fid, 'classdef dProbeColors < Simulink.IntEnumType\n  enumeration\n    Red(0)\n    Green(1)\n    Blue(2)\n  end\nend\n');
fclose(fid);
addpath(outdir);
rehash;
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);

%% SELF: what MATLAB writes, and reads back of its own files
V = { ...
  'I16',     'int16([])',                     int16([]); ...
  'I8',      'int8(zeros(0,3))',              int8(zeros(0,3)); ...
  'Lg',      'false(1,0)',                    false(1,0); ...
  'Lg03',    'false(0,3)',                    false(0,3); ...
  'Lg0',     'logical([])',                   logical([]); ...
  'D2',      'zeros(0,2)',                    zeros(0,2); ...
  'D20',     'zeros(2,0)',                    zeros(2,0); ...
  'D10',     'zeros(1,0)',                    zeros(1,0); ...
  'D0',      '[]',                            []; ...
  'En2',     'dProbeColors.empty(0,2)',       dProbeColors.empty(0,2); ...
  'En0',     'dProbeColors.empty',            dProbeColors.empty; ...
  'Ch',      'char(zeros(0,2))',              char(zeros(0,2)); ...
  'Ch20',    'char(zeros(2,0))',              char(zeros(2,0)); ...
  'Ch3',     'char(zeros(0,0,2))',            char(zeros(0,0,2)); ...
  'Parts0',  'WidgetPart.empty',              WidgetPart.empty; ...
  'Parts10', 'WidgetPart.empty(1,0)',         WidgetPart.empty(1,0); ...
  'Params0', 'Simulink.Parameter.empty(1,0)', Simulink.Parameter.empty(1,0); ...
  'Params00','Simulink.Parameter.empty',      Simulink.Parameter.empty};
PLACES = {'entry', 'cell', 'field', 'param', 'prop'};
self = struct('id', {}, 'expr', {}, 'place', {}, 'text', {}, 'refused', {}, 'textReads', {}, 'binaryReads', {});
files = struct();
for fmt = {'uncompressed-text', 'compressed-binary'}
  fn = fullfile(outdir, ['self_' strrep(fmt{1}, '-', '_') '.sldd']);
  if exist(fn, 'file'), delete(fn); end
  dd = Simulink.data.dictionary.create(fn); dd.FileFormat = fmt{1};
  design = getSection(dd, 'Design Data'); other = getSection(dd, 'Other Data');
  refused = struct();
  for i = 1:size(V, 1)
    for q = 1:numel(PLACES)
      [nm, sec] = placed(V{i,1}, PLACES{q});
      try
        val = valueAt(V{i,3}, PLACES{q});
        if strcmp(sec, 'other'), addEntry(other, nm, val); else, addEntry(design, nm, val); end
      catch e
        refused.(nm) = strrep(e.message, newline, ' ');
      end
    end
  end
  saveChanges(dd); close(dd);
  files.(strrep(fmt{1}, '-', '_')) = struct('fn', fn, 'refused', refused);
end
Simulink.data.dictionary.closeAll('-discard');
textFile = files.uncompressed_text; binFile = files.compressed_binary;
txt = fileread(textFile.fn);
for i = 1:size(V, 1)
  for q = 1:numel(PLACES)
    [nm, sec] = placed(V{i,1}, PLACES{q});
    row = struct('id', V{i,1}, 'expr', V{i,2}, 'place', PLACES{q}, 'text', '', 'refused', '', 'textReads', [], 'binaryReads', []);
    if isfield(textFile.refused, nm)
      row.refused = textFile.refused.(nm);
    else
      row.text = spellingAt(txt, nm, PLACES{q});
      row.textReads = readAt(textFile.fn, nm, sec, PLACES{q});
    end
    if ~isfield(binFile.refused, nm)
      row.binaryReads = readAt(binFile.fn, nm, sec, PLACES{q});
    end
    self(end+1) = row; %#ok<AGROW>
    fprintf('SELF %-8s %-5s text=%s refused=%s => %s\n', V{i,1}, PLACES{q}, regexprep(row.text, '\s+', ' '), row.refused, readsText(row.textReads));
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
CANDS = { ...
  '{"_type":"int8","_value":"Matrix(0,3)"}'; ...
  '{"_type":"double","_value":"Matrix(0,2)"}'; ...
  '{"_type":"double","_value":"Matrix(2,0)"}'; ...
  '{"_type":"double","_value":"Matrix(1,0)"}'; ...
  '{"_type":"logical","_value":"Matrix(0,3)"}'; ...
  '{"_type":"logical","_value":"Matrix(1,0)"}'; ...
  '{"_type":"dProbeColors","_value":"Matrix(0,2)"}'; ...
  '{"_type":"int16","_value":"[]"}'; ...
  '{"_type":"logical","_value":"[]"}'; ...
  '{"_type":"dProbeColors","_value":"[]"}'; ...
  '[]'; ...
  '{"_type":"mxchar","_value":"Matrix(0,2)\n[]"}'; ...
  '{"_type":"mxchar","_value":"Matrix(2,0)\n[[]; []]"}'; ...
  '""'; ...
  '{"_type":"int16","_value":"Matrix(0,0)"}'; ...
  '{"_type":"logical","_value":"Matrix(0,0)"}'; ...
  '{"_type":"WidgetPart","_value":"[]"}'; ...
  '{"_type":"WidgetPart","_value":"Matrix(0,0)"}'; ...
  '{"_type":"WidgetPart","_value":"Matrix(1,0)"}'; ...
  '{"_type":"Simulink.Parameter","_value":"[]"}'; ...
  '{"_type":"Simulink.Parameter","_value":"Matrix(1,0)"}'};
KEYS = {'entry', 'k_entry', 987654321, 'design'; 'cell', 'k_cell', 987654322, 'design'; ...
        'param', 'k_param', 987654323, 'design'; 'field', 'k_field', 987654324, 'design'; ...
        'prop', 'k_prop', 987654325, 'other'};
candidates = struct('spelling', {}, 'place', {}, 'reads', {});
for k = 1:numel(CANDS)
  for q = 1:size(KEYS, 1)
    [t, ok] = putCandidate(baseText, KEYS{q,3}, CANDS{k});
    if ~ok
      reads = struct('error', 'PLACEHOLDER-NOT-FOUND');
    else
      fn = fullfile(outdir, sprintf('cand_%02d_%s.sldd', k, KEYS{q,1}));
      fid = fopen(fn, 'w', 'n', 'UTF-8'); fwrite(fid, t, 'char'); fclose(fid);
      reads = readAt(fn, KEYS{q,2}, KEYS{q,4}, KEYS{q,1});
    end
    candidates(end+1) = struct('spelling', CANDS{k}, 'place', KEYS{q,1}, 'reads', reads); %#ok<AGROW>
    fprintf('CAND %02d %-5s %s => %s\n', k, KEYS{q,1}, CANDS{k}, readsText(reads));
  end
end

truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd')), ...
  'self', self, 'candidates', candidates);
fid = fopen(fullfile(outdir, 'text_empty_readback.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('TEXT_EMPTY_READBACK OK\n');

% The entry name and its section for value `id` standing at `place`.
function [nm, sec] = placed(id, place)
  sec = 'design';
  pre = struct('entry', 'e_', 'cell', 'c_', 'field', 's_', 'param', 'p_', 'prop', 'w_');
  nm = [pre.(place) id];
  if strcmp(place, 'prop'), sec = 'other'; end
end

% The value an entry holds for `v` standing at `place`. A Simulink.Parameter refuses some
% values as its Value, which is then the refusal recorded.
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
% place's key, within that entry, for a value no deeper than one object or one flat list (every
% empty here); '?ABSENT' when MATLAB wrote no such key there (a property at its default), and
% '?' + the next 300 characters for a deeper value, so that one is seen rather than cut.
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
  if isempty(tok), s = ['?' rest(1:min(end, 300))]; else, s = tok{1}; end
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
