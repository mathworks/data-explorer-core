% How does MATLAB spell an EMPTY char in a compressed-binary data dictionary, at an entry's Value,
% a cell's element and a struct field, for each empty shape, and what does it read back?
%
% The binary writer left the Dimension off a 1x0 char as it does off a row, so a 1x0 read back as
% the 0x0. The answers, measured against R2027a:
%
%   - the 0x0 is `Class="char"/>`, with no Dimension, at every place;
%   - every other empty states its Dimension, a 1x0 among them: `Class="char" Dimension="1*0"/>`,
%     `"0*2"`, `"2*0"`, `"1*0*2"`, alike at `<P Name="Value"`, `<Element` and `<P Name="f"`;
%   - each reads back as the shape it was written with.
%
% Outputs /tmp/dexprobe/char1x0_matlab.sldd, committed as test/fixtures/char_empty_binary.sldd
% (test/binaryEmptyChar.test.ts reads it), and prints each char line of its chunk (XML ...) and
% the class and size of each value read back (READ ...).
% Run: matlab -batch "run('test/parity/matlab/probe_char_empty_binary.m')"

if ~exist('/tmp/dexprobe', 'dir'), mkdir('/tmp/dexprobe'); end
cd('/tmp/dexprobe');
Simulink.data.dictionary.closeAll('-discard');
fn = fullfile('/tmp/dexprobe', 'char1x0_matlab.sldd');
if exist(fn, 'file'), delete(fn); end
dd = Simulink.data.dictionary.create(fn);
dd.FileFormat = 'compressed-binary';
ds = getSection(dd, 'Design Data');
shapes = {'c1x0', zeros(1,0); 'c0x0', zeros(0,0); 'c0x2', zeros(0,2); 'c2x0', zeros(2,0); 'c1x0x2', zeros(1,0,2)};
for i = 1:size(shapes, 1)
  v = char(shapes{i, 2});
  addEntry(ds, shapes{i, 1}, v);
  addEntry(ds, ['cell_' shapes{i, 1}], {v});
  addEntry(ds, ['field_' shapes{i, 1}], struct('f', v));
end
clear ds;
saveChanges(dd);
close(dd);
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);
d = tempname; mkdir(d);
unzip(fn, d);
txt = fileread(fullfile(d, 'data', 'chunk0.xml'));
lines = regexp(txt, '[^\n]*', 'match');
for i = 1:numel(lines)
  if contains(lines{i}, 'Name="Name"') || contains(lines{i}, 'Class="char"')
    fprintf('XML %s\n', strtrim(lines{i}));
  end
end
dd = Simulink.data.dictionary.open(fn);
ds = getSection(dd, 'Design Data');
es = find(ds);
for i = 1:numel(es)
  v = getValue(es(i));
  if iscell(v), w = v{1}; where = 'cell'; elseif isstruct(v), w = v.f; where = 'field'; else, w = v; where = 'value'; end
  fprintf('READ %s %s %s %s\n', es(i).Name, where, class(w), mat2str(size(w)));
end
clear ds es;
close(dd);
Simulink.data.dictionary.closeAll('-discard');
