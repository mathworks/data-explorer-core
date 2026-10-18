% Does MATLAB read back what core SAVES, for three questions the 2026-10-13 save decisions left
% to a MATLAB check?  (D8-READBACKS M1, M2 and M3, run for group F on 2026-10-18.)
%
%   M1  a config set regenerated in a binary dictionary and pasted into its text twin: does it
%       read 10 Components, each element its own class, as MATLAB's own file does (D15)?
%   M2  enumeration values regenerated in a binary dictionary and pasted into a text one, empty
%       ones included: does each read back as the class, size and enumerals it was?
%   M3  an emptied and a new bus, in each dictionary, and the two spellings older saves gave an
%       empty bus (`Class="char"/>`, `Class="double" Dimension="0*0"/>`): BusElement 0x0?
%
% The saves are core's, made by save_readbacks.mjs beside this file, which writes them and
% cases.json (one row per question, with the fragment of the save it is about) into a directory:
%
%   node test/parity/matlab/save_readbacks.mjs /tmp/savereadbacks <dir holding dNJSON_SLDDApi_opc.sldd
%        and dNJSON_SLDDApi.sldd, corpus files; without it M1 is left out>
%   env SAVE_READBACKS_OUT=/tmp/savereadbacks mw -using Bmain matlab -nodesktop \
%        -batch "run('$PWD/test/parity/matlab/probe_save_readbacks.m')"
%   cp /tmp/savereadbacks/save_readbacks.truth.json test/parity/matlab/
%
% Prints SAVE_READBACKS OK on its last line. Output: save_readbacks.truth.json, {version, release,
% date, cases}: each row of cases.json, as it was, with `matlab`, what MATLAB read: {class, size}
% and, by kind, `enumerals` (an enumeration's names), `elements` (a bus's Elements class and size),
% `components` (a config set's Components size and each element's class, and two of its
% parameters), or {error}. test/parity/readbacks.truth.test.ts reads it.

outdir = getenv('SAVE_READBACKS_OUT');
if isempty(outdir), error('set SAVE_READBACKS_OUT to the directory save_readbacks.mjs wrote'); end
here = fileparts(mfilename('fullpath'));
addpath(fullfile(here, '..', '..', 'fixtures', 'mcos'));   % GearMode, Widget, WidgetPart
fid = fopen(fullfile(outdir, 'dProbeColors.m'), 'w');
fprintf(fid, 'classdef dProbeColors < Simulink.IntEnumType\n  enumeration\n    Red(0)\n    Green(1)\n    Blue(2)\n  end\nend\n');
fclose(fid);
addpath(outdir);
rehash;
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);

cases = jsondecode(fileread(fullfile(outdir, 'cases.json')));
if isstruct(cases), cases = num2cell(cases); end
SECTION = struct('design', 'Design Data', 'other', 'Other Data', 'config', 'Configurations');
for i = 1:numel(cases)
  c = cases{i};
  try
    dd = Simulink.data.dictionary.open(fullfile(outdir, c.file));
    v = getValue(getEntry(getSection(dd, SECTION.(c.section)), c.entry));
    if strcmp(c.kind, 'enumProperty'), v = v.Mode; end
    m = struct('class', class(v), 'size', size(v));
    switch c.kind
      case {'enum', 'enumProperty'}
        m.enumerals = arrayfun(@char, v(:)', 'UniformOutput', false);
      case 'bus'
        m.elements = struct('class', class(v.Elements), 'size', size(v.Elements));
      case 'configset'
        comps = v.Components;
        m.components = struct('size', size(comps), 'classes', {arrayfun(@(x) class(x), comps(:)', 'UniformOutput', false)}, ...
          'DefaultParameterBehavior', get_param(v, 'DefaultParameterBehavior'), 'StopTime', get_param(v, 'StopTime'));
    end
    close(dd);
  catch e
    m = struct('error', strrep(e.message, newline, ' '));
  end
  Simulink.data.dictionary.closeAll('-discard');
  c.matlab = m;
  cases{i} = c;
  fprintf('%s %-28s %-28s %s\n', c.check, c.file, c.entry, jsonencode(m));
end
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd')), 'cases', {cases});
fid = fopen(fullfile(outdir, 'save_readbacks.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('SAVE_READBACKS OK\n');
