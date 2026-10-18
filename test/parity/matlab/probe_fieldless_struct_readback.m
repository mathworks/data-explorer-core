% Does MATLAB read back core's spelling of a field-less struct array it could never write itself?
% (F1-9, run for group F on 2026-10-18.)
%
% repmat(struct(), 1e4, 1e4) has 1e8 elements and no field. MATLAB's own dictionary spelling of it
% is element by element: 1e8 `<Element/>` in a binary dictionary (2.3 GB of chunk0.xml, written in
% 14.5 s and read in 48.5 s) and 1e8 `{}` in a text one (1.2 GB, 57 s and 35 s). Core writes a copy
% of it as one MAT stream instead: a 132-byte cdata `_value` in a text dictionary, a 72-byte hex
% stream in a binary one. The saves are core's, made by fieldless_struct_readback.mjs beside this
% file from MATLAB's own `save` of the array (test/fixtures/mcos/fieldless_1e4x1e4.mat), as an
% entry's value, a struct field and a cell's element:
%
%   node test/parity/matlab/fieldless_struct_readback.mjs /tmp/fieldless
%   env FIELDLESS_OUT=/tmp/fieldless mw -using Bmain matlab -nodesktop \
%        -batch "run('$PWD/test/parity/matlab/probe_fieldless_struct_readback.m')"
%   cp /tmp/fieldless/fieldless_struct_readback.truth.json test/parity/matlab/
%
% And the fixture itself, should it need making again:
%   big = repmat(struct(), 1e4, 1e4); save('fieldless_1e4x1e4.mat', 'big')
%
% Prints FIELDLESS_STRUCT_READBACK OK on its last line. Output: fieldless_struct_readback.truth.json,
% {version, release, date, cases}: each row of cases.json, as it was, with `matlab`, what MATLAB read
% at that place: {class, size, fields} or {error}. test/fieldlessStructReadback.test.ts reads it.

outdir = getenv('FIELDLESS_OUT');
if isempty(outdir), error('set FIELDLESS_OUT to the directory fieldless_struct_readback.mjs wrote'); end
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);
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
    m = struct('class', class(v), 'size', size(v), 'fields', numel(fieldnames(v)));
    close(dd);
  catch e
    m = struct('error', strrep(e.message, newline, ' '));
  end
  Simulink.data.dictionary.closeAll('-discard');
  c.matlab = m;
  cases{i} = c;
  fprintf('%-30s %-6s %s\n', c.file, c.place, jsonencode(m));
end
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd')), 'cases', {cases});
fid = fopen(fullfile(outdir, 'fieldless_struct_readback.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('FIELDLESS_STRUCT_READBACK OK\n');
