% Has MATLAB R2027a's Simulink.VariantConfigurations a Value? (group H item B-19, under group E
% theme 2, follow MATLAB, measure first; the twin of C-168 and C-169, which found that
% Simulink.VariantBank and Simulink.VariantBankCoderInfo have none. Measured 2026-10-18.)
%
% This opens no file. For each of the two class names a dictionary entry of this kind goes by
% (the data, Simulink.VariantConfigurationData, and the container MATLAB stores,
% Simulink.VariantConfigurations), it constructs one and records the class it got, properties(),
% isprop(..., 'Value'), every property the metaclass lists (hidden ones included, with their
% Hidden flag), and what reading and setting a Value do.
%
% Run: env VARIANTCONFIGURATIONS_VALUE_OUT=/tmp/vcvalue mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_variantconfigurations_value.m')"
% then: cp /tmp/vcvalue/variantconfigurations_value.truth.json test/parity/matlab/
% Prints VARIANTCONFIGURATIONS_VALUE OK on its last line. Output:
% variantconfigurations_value.truth.json, {version, release, date, rows}: each row a class name
% as typed, and either {error} (the constructor failed) or {class, properties, isprop_Value,
% meta: {names, hidden}, get_Value, set_Value}, where get_Value and set_Value are {ok} or
% {identifier, message}.

outdir = getenv('VARIANTCONFIGURATIONS_VALUE_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'vcvalue'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end
fprintf('VERSION %s\n', version);
NAMES = {'Simulink.VariantConfigurationData', 'Simulink.VariantConfigurations'};
rows = cell(1, numel(NAMES));
for k = 1:numel(NAMES)
  rows{k} = measure(NAMES{k});
  fprintf('CLASS %s\n', NAMES{k});
  disp(rows{k});
end
meta = jsonencode(struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd'))));
fid = fopen(fullfile(outdir, 'variantconfigurations_value.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s,\n"rows": %s}\n', meta(1:end-1), jsonencode(rows, 'PrettyPrint', true));
fclose(fid);
fprintf('VARIANTCONFIGURATIONS_VALUE OK\n');

% What MATLAB says of an object constructed by the name `typed`.
function row = measure(typed)
  row = struct('typed', typed);
  try
    x = feval(typed);
  catch e
    row.error = strrep(e.message, newline, ' ');
    return;
  end
  row.class = class(x);
  row.properties = properties(x);
  row.isprop_Value = isprop(x, 'Value');
  try
    mc = metaclass(x);
    row.meta = struct('names', {{mc.PropertyList.Name}}, 'hidden', [mc.PropertyList.Hidden]);
  catch e
    row.meta = struct('error', strrep(e.message, newline, ' '));
  end
  try
    v = x.Value; %#ok<NASGU>
    row.get_Value = struct('ok', true);
  catch e
    row.get_Value = struct('identifier', e.identifier, 'message', strrep(e.message, newline, ' '));
  end
  try
    x.Value = 'x';
    row.set_Value = struct('ok', true);
  catch e
    row.set_Value = struct('identifier', e.identifier, 'message', strrep(e.message, newline, ' '));
  end
end
