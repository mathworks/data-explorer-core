% How does MATLAB spell Inf, -Inf and NaN in a TEXT data dictionary, at each place a value stands?
%
% JSON has no spelling for any of the three, and a binary dictionary's reader holds a double
% scalar as a bare number, so an entry copied out of one and pasted into a text dictionary was
% written as `null` (JSON.stringify's spelling of a non-finite number). This asks MATLAB what the
% text dictionary holds instead.
%
% The answers, measured against R2027a:
%
%   - a non-finite double is its typed literal, {"_type": "double", "_value": "Inf"} ("-Inf",
%     "NaN"), alike at an entry (a, b, c), a struct field (e), a cell's element (k) and a
%     Simulink.Parameter's Value (p); a single is {"_type": "single", "_value": "-Inf"} (g);
%   - a row holding one is one literal of the row, its finite elements with a decimal point:
%     "[1.0, Inf, NaN, -Inf]" (d), in a struct field "[NaN, -Inf]" (m), in a Parameter's Value
%     "[1.0, -Inf, NaN]" (q); a column is under its header, "Matrix(2,1)\n[Inf, NaN]" (h);
%   - each reads back as the value written. A Simulink.Signal's Min of -Inf is refused by its
%     setter ("Minimum must be a finite real double scalar value."), so no object holds one there.
%
% Outputs /tmp/dexprobe/nonfinite.sldd, committed as test/fixtures/nonfinite_text.sldd.
% Run: matlab -batch "run('test/parity/matlab/probe_text_nonfinite.m')"

if ~exist('/tmp/dexprobe', 'dir'), mkdir('/tmp/dexprobe'); end
cd('/tmp/dexprobe');
Simulink.data.dictionary.closeAll('-discard');
fn = fullfile('/tmp/dexprobe', 'nonfinite.sldd');
if exist(fn, 'file'), delete(fn); end
dd = Simulink.data.dictionary.create(fn);
dd.FileFormat = 'uncompressed-text';
ds = getSection(dd, 'Design Data');
addEntry(ds, 'a', Inf);
addEntry(ds, 'b', -Inf);
addEntry(ds, 'c', NaN);
addEntry(ds, 'd', [1 Inf NaN -Inf]);
addEntry(ds, 'e', struct('f', Inf));
p = Simulink.Parameter;
p.Value = Inf;
addEntry(ds, 'p', p);
% Beyond the asked set: single, a column, a cell element, a struct field array, a Parameter array Value, and an int-class neighbour.
addEntry(ds, 'g', single(-Inf));
addEntry(ds, 'h', [Inf; NaN]);
addEntry(ds, 'k', {Inf, NaN});
addEntry(ds, 'm', struct('f', [NaN -Inf], 'g', 2));
q = Simulink.Parameter;
q.Value = [1 -Inf NaN];
addEntry(ds, 'q', q);
% (A Signal's Min of -Inf is refused by its setter: "Minimum must be a finite real double scalar value.")
clear ds;
saveChanges(dd);
close(dd);
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);
fprintf('FILE %s bytes=%d\n', fn, dir(fn).bytes);
fid = fopen(fn, 'r', 'n', 'UTF-8');
txt = fread(fid, inf, '*char')';
fclose(fid);
fprintf('%s\n', txt);
% And what it reads back.
dd = Simulink.data.dictionary.open(fn);
ds = getSection(dd, 'Design Data');
names = {'a','b','c','d','e','g','h','k','m','p','q'};
for i = 1:numel(names)
  v = getValue(getEntry(ds, names{i}));
  fprintf('READ %s = %s\n', names{i}, strtrim(evalc('disp(v)')));
end
clear ds;
close(dd);
Simulink.data.dictionary.closeAll('-discard');
