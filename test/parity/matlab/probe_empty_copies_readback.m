% Copyright 2026 The MathWorks, Inc.
%
% Does MATLAB read back core's copy of a struct array of no element with fields, and of a complex
% empty, pasted into a text and a binary dictionary, as `load` reads the .mat variable it was
% copied from? The values are dispcat.mat's: struct('a', {}) as a 0x0 and a 1x0, and
% complex(zeros(0,0)), complex(zeros(1,0)), a complex int16 1x0 and a complex single 1x0. The
% saves are core's, made by empty_copies_readback.mjs beside this file, each value as an entry's
% value, a struct field and a cell's element, copied as read and once marked edited:
%
%   node test/parity/matlab/empty_copies_readback.mjs /tmp/emptycopies
%   env EMPTY_COPIES_OUT=/tmp/emptycopies mw -using Bmain matlab -nodesktop \
%        -batch "run('$PWD/test/parity/matlab/probe_empty_copies_readback.m')"
%   cp /tmp/emptycopies/empty_copies_readback.truth.json test/parity/matlab/
%
% Prints EMPTY_COPIES_READBACK OK on its last line. Output: empty_copies_readback.truth.json,
% {version, release, date, cases}: each row of cases.json, as it was, with `matlab`, what MATLAB
% read at that place, {class, size, isreal, fields}, or {error}, and `loaded`, the same of the
% variable `load` reads from dispcat.mat. test/emptyCopiesReadback.test.ts reads it.
%
% Opens only the files in EMPTY_COPIES_OUT, and writes nothing else there.

outdir = getenv('EMPTY_COPIES_OUT');
if isempty(outdir) && exist('EMPTY_COPIES_OUT', 'var'), outdir = EMPTY_COPIES_OUT; end %#ok<NODEF>
if isempty(outdir), error('set EMPTY_COPIES_OUT to the directory empty_copies_readback.mjs wrote'); end
cd(outdir);
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);
S = load(fullfile(outdir, 'dispcat.mat'));
cases = jsondecode(fileread(fullfile(outdir, 'cases.json')));
if isstruct(cases), cases = num2cell(cases); end
for i = 1:numel(cases)
  c = cases{i};
  try
    dd = Simulink.data.dictionary.open(fullfile(outdir, c.file));
    v = getValue(getEntry(getSection(dd, 'Design Data'), c.entry));
    switch c.place
      case 'field', v = v.f;
      case 'cell',  v = v{1};
    end
    m = shapeOf(v);
    close(dd);
  catch e
    m = struct('error', strrep(e.message, newline, ' '));
  end
  Simulink.data.dictionary.closeAll('-discard');
  c.matlab = m;
  c.loaded = shapeOf(S.(c.variable));
  cases{i} = c;
  fprintf('%-32s %-6s %-22s %s\n', c.file, c.place, c.variable, jsonencode(m));
end
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd')), 'cases', {cases});
fid = fopen(fullfile(outdir, 'empty_copies_readback.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('EMPTY_COPIES_READBACK OK\n');

% A value's class, size, complexity, and its field names (none for anything but a struct), each
% as a list so that JSON keeps one of one as a list.
function m = shapeOf(v)
fields = {};
if isstruct(v)
  fields = fieldnames(v)';
end
m = struct('class', class(v), 'size', size(v), 'isreal', isreal(v), 'fields', {fields});
end
