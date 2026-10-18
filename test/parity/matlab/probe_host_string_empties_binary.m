% How does MATLAB read back, out of a BINARY dictionary core saved, a host's empty string pasted at
% each place a value can stand? (PR #147's review, round 1, measured 2026-10-18.)
%
% A host hands an empty string in as `{_type: 'string', _emptyDims: [r, c]}`. Pasted into a binary
% dictionary, core writes it `Class="string" Dimension="r*c"` with no body, at an entry's value, a
% cell's element and a struct field as before PR #147, and, since MatWriter.emptyDimsHeldForm
% hands it on as the binary reader's empty, at a Simulink.Parameter's Value and at an object's
% property too, where it was `Class="double" Dimension="0*0"`. MATLAB itself writes a string's
% empty in a binary dictionary as its saveobj envelope, so it never writes this spelling; this asks
% what it reads back of it.
%
% Run: node test/parity/matlab/host_string_empties_binary.mjs /tmp/hsb   (with dist built)
%      env HOST_STRING_EMPTIES_OUT=/tmp/hsb mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_host_string_empties_binary.m')"
% then: cp /tmp/hsb/host_string_empties_binary.truth.json test/parity/matlab/
% It opens only the dictionaries the core half wrote, one per entry, each named for its entry.
% Prints HOST_STRING_EMPTIES_BINARY OK on its last line.
% Output: host_string_empties_binary.truth.json, {version, release, date, rows}: each row the core
% half's id, dims, place, name and spelling, and `reads`, {class, size} or {error}.

outdir = getenv('HOST_STRING_EMPTIES_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'hsb'); end
here = fileparts(mfilename('fullpath'));
addpath(fullfile(here, '..', '..', 'fixtures', 'mcos'));   % Widget
rehash;
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);
NAMES = jsondecode(fileread(fullfile(outdir, 'names.json')));
rows = struct('id', {}, 'form', {}, 'dims', {}, 'place', {}, 'name', {}, 'spelling', {}, 'reads', {});
for k = 1:numel(NAMES)
  r = NAMES(k);
  reads = readAt(fullfile(outdir, [r.name '.sldd']), r.name, r.section, r.place);
  rows(end+1) = struct('id', r.id, 'form', r.form, 'dims', r.dims', 'place', r.place, 'name', r.name, 'spelling', r.spelling, 'reads', reads); %#ok<AGROW>
  fprintf('READ %-8s %-7s %-5s %s => %s\n', r.name, r.form, r.place, r.spelling, readsText(reads));
end
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('now', 'Format', 'yyyy-MM-dd')), 'rows', rows);
fid = fopen(fullfile(outdir, 'host_string_empties_binary.truth.json'), 'w', 'n', 'UTF-8');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('HOST_STRING_EMPTIES_BINARY OK\n');

% What MATLAB reads at `place` in entry `nm` of file `fn`: {class, size} or {error}.
function r = readAt(fn, nm, sec, place)
  try
    Simulink.data.dictionary.closeAll('-discard');
    dd = Simulink.data.dictionary.open(fn);
    if strcmp(sec, 'other'), s = getSection(dd, 'Other Data'); else, s = getSection(dd, 'Design Data'); end
    v = getValue(getEntry(s, nm));
    switch place
      case 'cell',  v = v{1};
      case 'field', v = v.f;
      case 'param', v = v.Value;
      case 'prop',  v = v.Scalar;
    end
    r = struct('class', class(v), 'size', size(v));
    close(dd);
  catch e
    r = struct('error', strrep(e.message, newline, ' '));
  end
  Simulink.data.dictionary.closeAll('-discard');
end

function s = readsText(r)
  if isfield(r, 'error'), s = ['ERROR ' r.error];
  else, s = sprintf('class=%s size=%s', r.class, mat2str(r.size)); end
end
