function make_param_stream(out)
% Copyright 2026 The MathWorks, Inc.
%
% Simulink.Parameter objects a dictionary holds inside a cell and a struct beside an enumeration
% value, which it saves as a MAT stream: a double one, a complex one, and one in a struct field. test/parameterStreamValue.test.ts
% types text, an empty text and other classes into their Values. Run from this folder, in each
% release: make_param_stream(pwd). R2027a also writes a text dictionary.
cObj = {Simulink.Parameter(5), Simulink.Parameter([1+2i 3-4i]), 7, matlab.lang.OnOffSwitchState.on};
sObj = struct('p', Simulink.Parameter(3), 'n', 4, 'e', matlab.lang.OnOffSwitchState.on);
rel = version('-release');
formats = {'binary', 'compressed-binary'; 'text', 'uncompressed-text'};
for f = 1:size(formats, 1)
  if strcmp(formats{f, 1}, 'text') && ~strcmp(rel, '2027a'), continue; end
  file = fullfile(out, sprintf('param_stream_%s_r%s.sldd', formats{f, 1}, rel));
  if isfile(file), delete(file); end
  Simulink.data.dictionary.closeAll('-discard');
  dd = Simulink.data.dictionary.create(file);
  % R2023b has no FileFormat: its dictionaries are binary.
  if isprop(dd, 'FileFormat'), dd.FileFormat = formats{f, 2}; end
  sec = getSection(dd, 'Design Data');
  addEntry(sec, 'cObj', cObj);
  addEntry(sec, 'sObj', sObj);
  saveChanges(dd);
  close(dd);
end
Simulink.data.dictionary.closeAll('-discard');
end
