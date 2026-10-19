% How does MATLAB R2027a read a Simulink.VariantBankCoderInfo whose saveobj envelope is spelled
% <P Name="undefined" Class="struct">, as an earlier version of this package wrote one back, in
% place of MATLAB's <P Source="saveobj" PropertyType="any" Class="struct">? (group H item B-08,
% under theme 1, warn and show what was read, and theme 2, follow MATLAB, measured 2026-10-18.)
% And, as controls (measured 2026-10-19): an 'undefined' struct beside the envelope MATLAB wrote,
% and a text dictionary's plain bag with neither the five properties nor an 'undefined'.
%
% This opens, for each dictionary coderinfo_undefined.mjs makes from the R2027a fixture, what
% MATLAB reads of its two coder infos, ciA and ciB, and the last warning the open gave.
%
% Run: node test/parity/matlab/coderinfo_undefined.mjs /tmp/ciundef
%      env CODERINFO_UNDEFINED_OUT=/tmp/ciundef mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_coderinfo_undefined.m')"
% then: cp /tmp/ciundef/coderinfo_undefined.truth.json test/parity/matlab/
% It opens only the dictionaries the core half wrote. Prints CODERINFO_UNDEFINED OK on its last
% line. Output: coderinfo_undefined.truth.json, {version, release, date, cases, rows}: `cases` the
% core half's names.json as written, and each row a case's id, `warning`, the last warning the
% open gave ('' for none), and `reads`, each coder info's class and five properties, or {error}.

outdir = getenv('CODERINFO_UNDEFINED_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'ciundef'); end
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);
namesText = strtrim(fileread(fullfile(outdir, 'names.json')));
NAMES = jsondecode(namesText);
if isstruct(NAMES), NAMES = num2cell(NAMES); end
rows = cell(1, numel(NAMES));
for k = 1:numel(NAMES)
  id = NAMES{k}.id;
  [reads, warned] = readCoderInfos(fullfile(outdir, [id '.sldd']));
  rows{k} = struct('id', id, 'warning', warned, 'reads', reads);
  fprintf('READ %-18s %s\n', id, readsText(reads));
  if ~isempty(warned), fprintf('     WARN %s\n', warned); end
end
meta = jsonencode(struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd'))));
fid = fopen(fullfile(outdir, 'coderinfo_undefined.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s,\n"cases": %s,\n"rows": %s}\n', meta(1:end-1), namesText, jsonencode(rows, 'PrettyPrint', true));
fclose(fid);
fprintf('CODERINFO_UNDEFINED OK\n');

% What MATLAB reads of the coder infos ciA and ciB in `fn`, and the last warning the open gave.
function [reads, warned] = readCoderInfos(fn)
  reads = struct();
  warned = '';
  Simulink.data.dictionary.closeAll('-discard');
  lastwarn('');
  try
    dd = Simulink.data.dictionary.open(fn);
    ds = getSection(dd, 'Design Data');
    for nm = {'ciA', 'ciB'}
      try
        v = getValue(getEntry(ds, nm{1}));
        reads.(nm{1}) = struct('class', class(v), 'HeaderFile', v.HeaderFile, 'DefinitionFile', v.DefinitionFile, ...
          'PreStatement', v.PreStatement, 'PostStatement', v.PostStatement, 'Qualifier', char(v.Qualifier));
      catch e
        reads.(nm{1}) = struct('error', strrep(e.message, newline, ' '));
      end
    end
    warned = strrep(lastwarn, newline, ' ');
    close(dd);
  catch e
    reads = struct('error', strrep(e.message, newline, ' '));
  end
  Simulink.data.dictionary.closeAll('-discard');
end

function s = readsText(reads)
  if isfield(reads, 'error'), s = ['ERROR ' reads.error]; return; end
  parts = {};
  for nm = {'ciA', 'ciB'}
    c = reads.(nm{1});
    if isfield(c, 'error'), parts{end+1} = [nm{1} ' ERROR ' c.error]; continue; end %#ok<AGROW>
    parts{end+1} = sprintf('%s %s Header=''%s'' Definition=''%s'' Pre=''%s'' Post=''%s'' Qualifier=''%s''', nm{1}, c.class, ...
      c.HeaderFile, c.DefinitionFile, c.PreStatement, c.PostStatement, c.Qualifier); %#ok<AGROW>
  end
  s = strjoin(parts, ' | ');
end
