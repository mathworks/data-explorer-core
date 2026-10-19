% How does MATLAB read back, out of a BINARY dictionary core saved, a struct some of whose elements
% do not hold a field the struct has? (B-17, group H, measured 2026-10-19.)
%
% A text dictionary's struct element can be `null` or `{}`, or hold only some of the fields:
% MATLAB R2027a reads each field it does not hold as [] (structAbsentField.test.ts), and so does
% core's StructNode. Pasted into a binary dictionary at a place core writes a struct from its bag
% (DataNode._structXml: a Parameter's Value, an object's property, a struct in a cell or in a
% field there), each element was written with only the fields it holds, `<Element></Element>`
% for `{}` or `null`, and each in its own key order, which in MATLAB's own text dictionaries is
% sorted and not the struct's `_fields` order. This asks what MATLAB reads of that spelling, and
% of the same struct written field by field in the struct's order, each absent field as `[]`
% (`Class="double" Dimension="0*0"`), or with the `[]` after what the element holds; and, as the
% source a copy into a binary dictionary comes from, what it reads of the struct as held in a
% text dictionary at the same place.
%
% Run: node test/parity/matlab/struct_absent_fields_binary.mjs /tmp/sab   (with dist built)
%      env STRUCT_ABSENT_OUT=/tmp/sab mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_struct_absent_fields_binary.m')"
% then: cp /tmp/sab/struct_absent_fields_binary.truth.json test/parity/matlab/
% It opens only the dictionaries the core half wrote, one per entry, each named for its entry.
% Prints STRUCT_ABSENT_FIELDS_BINARY OK on its last line.
% Output: struct_absent_fields_binary.truth.json, {version, release, date, rows}: each row the core
% half's id, form, place, name and spelling, and `reads`: {error}, or {class, size, fields,
% elements}, `elements` one list per element of {field, class, size, value} (value [] unless a
% numeric scalar).

outdir = getenv('STRUCT_ABSENT_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'sab'); end
here = fileparts(mfilename('fullpath'));
addpath(fullfile(here, '..', '..', 'fixtures', 'mcos'));   % Widget
rehash;
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);
NAMES = jsondecode(fileread(fullfile(outdir, 'names.json')));
rows = cell(1, numel(NAMES));
for k = 1:numel(NAMES)
  r = NAMES(k);
  reads = readAt(fullfile(outdir, [r.name '.sldd']), r.name, r.section, r.place);
  rows{k} = struct('id', r.id, 'form', r.form, 'place', r.place, 'name', r.name, 'spelling', r.spelling, 'reads', reads);
  fprintf('READ %-8s %-8s %-6s => %s\n', r.name, r.form, r.place, jsonencode(reads));
end
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd')));
truth.rows = rows;
fid = fopen(fullfile(outdir, 'struct_absent_fields_binary.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('STRUCT_ABSENT_FIELDS_BINARY OK\n');

% What MATLAB reads at `place` in entry `nm` of file `fn`: {error}, or describe(v).
function r = readAt(fn, nm, sec, place)
  try
    Simulink.data.dictionary.closeAll('-discard');
    dd = Simulink.data.dictionary.open(fn);
    if strcmp(sec, 'other'), s = getSection(dd, 'Other Data'); else, s = getSection(dd, 'Design Data'); end
    v = getValue(getEntry(s, nm));
    switch place
      case 'param',  v = v.Value;
      case 'prop',   v = v.Scalar;
      case 'pcell',  v = v.Scalar{1};
      case 'pfield', v = v.Scalar.f;
    end
    r = describe(v);
    close(dd);
  catch e
    r = struct('error', strrep(e.message, newline, ' '));
  end
  Simulink.data.dictionary.closeAll('-discard');
end

% A value's class and size and, for a struct, its field names and each element's fields.
function d = describe(v)
  d = struct('class', class(v), 'size', size(v));
  if ~isstruct(v), return; end
  f = fieldnames(v)';
  d.fields = f;
  els = cell(1, numel(v));
  for k = 1:numel(v)
    e = cell(1, numel(f));
    for j = 1:numel(f)
      x = v(k).(f{j});
      if isnumeric(x) && isscalar(x), val = double(x); else, val = []; end
      e{j} = struct('field', f{j}, 'class', class(x), 'size', size(x), 'value', val);
    end
    els{k} = e;
  end
  d.elements = els;
end
