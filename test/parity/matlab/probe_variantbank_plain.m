% How does MATLAB R2027a read a Simulink.VariantBank a text dictionary holds in R2026b's spelling,
% as plain properties with no saveobj envelope? And does it read back core's own edit of one so
% spelled as written? (group H item B-06, under group F's C-168 and #141's "the same fix shape
% C-169B uses", measured 2026-10-18.)
%
% R2027a writes a bank as a saveobj envelope, and reads one by its loadobj; make_variantbank_r2027a.m
% measured that, and that a value a setter refuses there loads the WHOLE bank as defaults. A text
% dictionary R2026b wrote holds the same properties as a plain bag instead. This opens, for each
% hand edit of such a file and each save core makes of it, what MATLAB reads of its three banks.
%
% Run: node test/parity/matlab/variantbank_plain.mjs /tmp/vbplain   (with dist built)
%      env VARIANTBANK_PLAIN_OUT=/tmp/vbplain mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_variantbank_plain.m')"
% then: cp /tmp/vbplain/variantbank_plain.truth.json test/parity/matlab/
% It opens only the dictionaries the core half wrote. Prints VARIANTBANK_PLAIN OK on its last line.
% Output: variantbank_plain.truth.json, {version, release, date, cases, rows}: `cases` the core
% half's names.json as written (id, kind, what, and its edit or edits), and each row a case's id,
% `warning`, the last warning the open gave ('' for none), and `reads`, each bank's class, Name,
% Description, VariantConditions (its class, size and elements), AllChoicesCoderInfo,
% ActiveChoiceCoderInfo and BankCoderInfo, or {error}.

outdir = getenv('VARIANTBANK_PLAIN_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'vbplain'); end
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);
% The cases are copied into the truth as the core half wrote them: decoded and encoded again by
% MATLAB, a key such as `_array_type` would come back renamed.
namesText = strtrim(fileread(fullfile(outdir, 'names.json')));
NAMES = jsondecode(namesText);
if isstruct(NAMES), NAMES = num2cell(NAMES); end
rows = cell(1, numel(NAMES));
for k = 1:numel(NAMES)
  id = NAMES{k}.id;
  [reads, warned] = readBanks(fullfile(outdir, [id '.sldd']));
  rows{k} = struct('id', id, 'warning', warned, 'reads', reads);
  fprintf('READ %-22s %s\n', id, readsText(reads));
  if ~isempty(warned), fprintf('     WARN %s\n', warned); end
end
meta = jsonencode(struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd'))));
fid = fopen(fullfile(outdir, 'variantbank_plain.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s,\n"cases": %s,\n"rows": %s}\n', meta(1:end-1), namesText, jsonencode(rows, 'PrettyPrint', true));
fclose(fid);
fprintf('VARIANTBANK_PLAIN OK\n');

% What MATLAB reads of the banks vbN, vb1 and vbD in `fn`, and the last warning the open gave.
function [reads, warned] = readBanks(fn)
  reads = struct();
  warned = '';
  Simulink.data.dictionary.closeAll('-discard');
  lastwarn('');
  try
    dd = Simulink.data.dictionary.open(fn);
    ds = getSection(dd, 'Design Data');
    for nm = {'vbN', 'vb1', 'vbD'}
      try
        reads.(nm{1}) = bankOf(getValue(getEntry(ds, nm{1})));
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

function b = bankOf(v)
  vc = v.VariantConditions;
  if iscell(vc), elements = vc; else, elements = {}; end
  b = struct('class', class(v), 'Name', v.Name, 'Description', v.Description, ...
    'VariantConditions', struct('class', class(vc), 'size', size(vc), 'elements', {reshape(elements, 1, [])}), ...
    'AllChoicesCoderInfo', v.AllChoicesCoderInfo, 'ActiveChoiceCoderInfo', v.ActiveChoiceCoderInfo, ...
    'BankCoderInfo', v.BankCoderInfo);
end

function s = readsText(reads)
  if isfield(reads, 'error'), s = ['ERROR ' reads.error]; return; end
  parts = {};
  for nm = {'vbN', 'vb1', 'vbD'}
    b = reads.(nm{1});
    if isfield(b, 'error'), parts{end+1} = [nm{1} ' ERROR ' b.error]; continue; end %#ok<AGROW>
    vc = b.VariantConditions;
    parts{end+1} = sprintf('%s Name=''%s'' Desc=''%s'' VC=%s%s{%s} All=''%s'' Active=''%s'' Bank=''%s''', nm{1}, b.Name, ...
      strrep(b.Description, newline, '\n'), vc.class, mat2str(vc.size), strjoin(cellfun(@(c) ['''' c ''''], vc.elements, 'UniformOutput', false), ','), ...
      b.AllChoicesCoderInfo, b.ActiveChoiceCoderInfo, b.BankCoderInfo); %#ok<AGROW>
  end
  s = strjoin(parts, ' | ');
end
