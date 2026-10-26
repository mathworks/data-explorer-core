% Which empties MATLAB's own text dictionary holds as they are: each value set by MATLAB, as an
% entry and as the second element of a cell, saved in an uncompressed-text dictionary and read
% back. Pinned as text_dictionary_empties.truth.json, which test/textDictionaryEmpties.test.ts
% holds the D15 rule to (SectionNode._valueRefusal: a text dictionary refuses the empties it reads
% back as others).
%
% Run, with TDE_OUT a new directory:
%   env TDE_OUT=/tmp/tde matlab -batch "run('test/parity/matlab/probe_text_dictionary_empties.m')"
% Writes text_dictionary_empties.truth.json into TDE_OUT, and prints TEXT_DICTIONARY_EMPTIES OK last.
out = getenv('TDE_OUT');
if isempty(out), error('set TDE_OUT'); end
cd(out);
texts = {'zeros(0,3)', 'zeros(1,0)', 'zeros(1,0,''int8'')', 'zeros(0,3,''single'')', 'false(1,0)', ...
  'char(zeros(1,0))', 'cell(1,0)', 'cell(0,3)', 'strings(0,3)', 'strings(1,0)', ...
  'zeros(0,0)', 'zeros(0,0,''int8'')', 'cell(0,0)', 'strings(0,0)'};
Simulink.data.dictionary.closeAll('-discard');
fn = fullfile(out, 'own_text.sldd');
if exist(fn, 'file'), delete(fn); end
dd = Simulink.data.dictionary.create(fn);
dd.FileFormat = 'uncompressed-text';
ds = getSection(dd, 'Design Data');
for i = 1:numel(texts)
  addEntry(ds, sprintf('v%d', i), eval(texts{i}));
  addEntry(ds, sprintf('c%d', i), {1, eval(texts{i})});
end
saveChanges(dd); close(dd); Simulink.data.dictionary.closeAll('-discard');
dd = Simulink.data.dictionary.open(fn);
ds = getSection(dd, 'Design Data');
rows = cell(1, numel(texts));
for i = 1:numel(texts)
  v = getValue(getEntry(ds, sprintf('v%d', i)));
  c = getValue(getEntry(ds, sprintf('c%d', i)));
  typed = eval(texts{i});
  rows{i} = struct('text', texts{i}, 'typedClass', class(typed), 'typedSize', size(typed), 'class', class(v), 'size', size(v), ...
    'inCellClass', class(c{2}), 'inCellSize', size(c{2}));
  fprintf('EMPTY %-22s %s %s | in a cell %s %s\n', texts{i}, class(v), mat2str(size(v)), class(c{2}), mat2str(size(c{2})));
end
close(dd); Simulink.data.dictionary.closeAll('-discard');
% The CONTROL: a 0x3 double read as itself would be a 0x3; it must not be taken for a 0x0.
if isequal(size(zeros(0,3)), size([])), error('CONTROL not caught'); end
truth = struct('release', ['(R' version('-release') ')'], 'cases', {rows});
fid = fopen(fullfile(out, 'text_dictionary_empties.truth.json'), 'w');
fwrite(fid, jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('TEXT_DICTIONARY_EMPTIES OK %d values, control caught\n', numel(texts));
