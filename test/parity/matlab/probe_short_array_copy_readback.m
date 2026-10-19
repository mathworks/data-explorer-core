% Does MATLAB read the copy of a struct array or a cell holding fewer elements than it declares as
% the value core showed? (B-26 of group H.)
%
% A .mat file's 1x3 struct array holding 2 elements, or 1x3 cell holding 1 (and a 2x2 struct cut
% inside its third element, ones holding none, N-D ones), opens in core with a warning ("declares 3
% element(s) and only 2 could be read") and a row for each element held. Its copy was the declared
% size beside only the elements held, an N-D one's its MAT stream. short_array_copy_readback.mjs beside
% this file writes each variable as a .mat file and pastes each copy through core's API into a text
% and a binary dictionary as the entry `pasted`; a 1x3 struct and a 1x3 cell holding every element
% are the controls:
%
%   node test/parity/matlab/short_array_copy_readback.mjs /tmp/shortcopy
%   env SHORT_COPY_OUT=/tmp/shortcopy mw -using Bmain matlab -nodesktop \
%        -batch "run('$PWD/test/parity/matlab/probe_short_array_copy_readback.m')"
%   cp /tmp/shortcopy/short_array_copy_readback.truth.json test/parity/matlab/
%
% It opens only the files that script wrote. Prints SHORT_ARRAY_COPY_READBACK OK on its last line.
% Output: short_array_copy_readback.truth.json, {version, release, date, cases}: each row of
% cases.json, as it was, with `loaded`, what `load` read of the .mat variable, and `matlab`, what
% MATLAB read of the pasted entry. Each is {class, size, fields, elements} or {error}: a struct's
% elements one bag per element of each field's {class, size, value}, a cell's one {class, size,
% value} per element. test/shortArrayCopy.test.ts reads it.

outdir = getenv('SHORT_COPY_OUT');
if isempty(outdir), error('set SHORT_COPY_OUT to the directory short_array_copy_readback.mjs wrote'); end
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);
cases = jsondecode(fileread(fullfile(outdir, 'cases.json')));
if isstruct(cases), cases = num2cell(cases); end
for i = 1:numel(cases)
  c = cases{i};
  try
    S = load(fullfile(outdir, c.mat));
    c.loaded = describe(S.v);
  catch e
    c.loaded = struct('error', said(e, outdir));
  end
  try
    dd = Simulink.data.dictionary.open(fullfile(outdir, c.file));
    v = getValue(getEntry(getSection(dd, 'Design Data'), c.entry));
    c.matlab = describe(v);
    close(dd);
  catch e
    c.matlab = struct('error', said(e, outdir));
  end
  Simulink.data.dictionary.closeAll('-discard');
  cases{i} = c;
  fprintf('%-28s loaded %s | read %s\n', c.file, jsonencode(c.loaded), jsonencode(c.matlab));
end
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd')), 'cases', {cases});
fid = fopen(fullfile(outdir, 'short_array_copy_readback.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('SHORT_ARRAY_COPY_READBACK OK\n');

% A struct array's or a cell's class and size, its field names and each of its elements.
function d = describe(v)
  d = struct('class', class(v), 'size', size(v));
  if isstruct(v)
    names = fieldnames(v)';
    d.fields = names;
    d.elements = cell(1, numel(v));
    for k = 1:numel(v)
      bag = struct();
      for f = names
        bag.(f{1}) = item(v(k).(f{1}));
      end
      d.elements{k} = bag;
    end
  elseif iscell(v)
    d.elements = cellfun(@item, v(:)', 'UniformOutput', false);
  end
end

function d = item(x)
  d = struct('class', class(x), 'size', size(x));
  if isnumeric(x), d.value = x(:)'; end
end

% An error's message on one line, with the directory the files are in left out of it.
function m = said(e, outdir)
  m = strrep(strrep(e.message, newline, ' '), [outdir filesep], '');
end
