% Does MATLAB read back, as it was, the MAT stream an N-D cell or struct holding a value the reader
% did not decode used to copy as? (B-11 of group H.)
%
% A .mat file's 1x1x2 cell or struct array whose element 2 is a 3x4 sparse array that core shows
% as not decoded (its indices place 4 non-zeros and its bytes hold no values for them, values of a
% type with no width, or only 2 of the 4) used to copy as its whole MAT stream, with the member's
% own bytes in it; its copy is refused now, as the member's own copy is (F1-10). A 3x4 sparse array
% that decodes is the control, which core still copies as a stream. nd_undecoded_copy_readback.mjs
% beside this file writes each variable as a .mat file and pastes each stream through core's API
% into a text and a binary dictionary as the entry `pasted`:
%
%   node test/parity/matlab/nd_undecoded_copy_readback.mjs /tmp/ndundecoded
%   env ND_UNDECODED_OUT=/tmp/ndundecoded mw -using Bmain matlab -nodesktop \
%        -batch "run('$PWD/test/parity/matlab/probe_nd_undecoded_copy_readback.m')"
%   cp /tmp/ndundecoded/nd_undecoded_copy_readback.truth.json test/parity/matlab/
%
% It opens only the files that script wrote. Prints ND_UNDECODED_COPY_READBACK OK on its last line.
% Output: nd_undecoded_copy_readback.truth.json, {version, release, date, cases}: each row of
% cases.json, as it was, with `loaded`, what `load` read of the .mat variable, and `matlab`, what
% MATLAB read of the pasted entry. Each is {class, size, first, member: {class, size, sparse, nnz,
% values}} or {error}. test/undecodedCopy.test.ts reads it.

outdir = getenv('ND_UNDECODED_OUT');
if isempty(outdir), error('set ND_UNDECODED_OUT to the directory nd_undecoded_copy_readback.mjs wrote'); end
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);
cases = jsondecode(fileread(fullfile(outdir, 'cases.json')));
if isstruct(cases), cases = num2cell(cases); end
for i = 1:numel(cases)
  c = cases{i};
  try
    S = load(fullfile(outdir, c.mat));
    c.loaded = describe(S.c);
  catch e
    c.loaded = struct('error', strrep(e.message, newline, ' '));
  end
  try
    dd = Simulink.data.dictionary.open(fullfile(outdir, c.file));
    v = getValue(getEntry(getSection(dd, 'Design Data'), c.entry));
    c.matlab = describe(v);
    close(dd);
  catch e
    c.matlab = struct('error', strrep(e.message, newline, ' '));
  end
  Simulink.data.dictionary.closeAll('-discard');
  cases{i} = c;
  fprintf('%-28s loaded %s | read %s\n', c.file, jsonencode(c.loaded), jsonencode(c.matlab));
end
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd')), 'cases', {cases});
fid = fopen(fullfile(outdir, 'nd_undecoded_copy_readback.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('ND_UNDECODED_COPY_READBACK OK\n');

% A 1x1x2 cell's or struct's class and size, its element 1 and what its element 2 is.
function d = describe(v)
  d = struct('class', class(v), 'size', size(v));
  if numel(v) ~= 2 || ~(iscell(v) || isstruct(v)), return; end
  if iscell(v)
    a = v{1}; m = v{2};
  else
    a = v(1).f; m = v(2).f;
  end
  d.first = a;
  d.member = struct('class', class(m), 'size', size(m), 'sparse', issparse(m));
  try
    d.member.nnz = nnz(m);
    d.member.values = full(m(:))';
  catch e
    d.member.error = strrep(e.message, newline, ' ');
  end
end
