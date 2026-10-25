% The complex-array live gate: does MATLAB R2027a load each complex array core saved, typed as a
% Value through core's session (complex_array_gate.mjs), as the value MATLAB makes of the same
% literal, with no warning?
%
% For each case of cases.json (a text dictionary, a binary dictionary, a MAT-file; an entry's Value
% or a Simulink.Parameter's), the value loaded is held to MATLAB's own evaluation of the literal
% (or, where the literal is this package's display spelling and no MATLAB syntax, the expression
% that makes it): isequaln, the same class, the same size, real or complex alike (and for a
% Parameter its Dimensions and Complexity); and the open and the load print no warning. The CONTROL
% case was typed as one value and is compared with another: the gate fails unless it is found to
% differ.
%
% Run, with CX_OUT the directory complex_array_gate.mjs wrote:
%   node test/parity/matlab/complex_array_gate.mjs /tmp/cxgate   (with dist built)
%   env CX_OUT=/tmp/cxgate matlab -batch "run('test/parity/matlab/probe_complex_array_gate.m')"
% Writes complex_array_gate.truth.json into CX_OUT, and prints COMPLEX_ARRAY_GATE OK last.
out = getenv('CX_OUT');
if isempty(out), error('set CX_OUT'); end
cd(out);
cases = jsondecode(fileread(fullfile(out, 'cases.json')));
Simulink.data.dictionary.closeAll('-discard');
rows = cell(1, numel(cases));
warned = {};
deepreal = @(x) iscell(x) && all(cellfun(@isreal, x(:))) || ~iscell(x) && isreal(x);
for k = 1:numel(cases)
  c = cases(k);
  lastwarn('');
  printed = '';
  try
    if endsWith(c.file, '.sldd')
      printed = evalc('dd = Simulink.data.dictionary.open(fullfile(out, c.file)); ds = getSection(dd, ''Design Data''); v = getValue(getEntry(ds, c.entry));');
      close(dd);
      Simulink.data.dictionary.closeAll('-discard');
    else
      printed = evalc('S = load(fullfile(out, c.file)); v = S.(c.entry);');
    end
    extra = '';
    if c.parameter
      p = v;
      v = p.Value;
      extra = sprintf('Dimensions=%s Complexity=%s', mat2str(p.Dimensions), p.Complexity);
    end
    w = eval(c.matlab);
    same = isequaln(v, w) && strcmp(class(v), class(w)) && isequal(size(v), size(w)) && deepreal(v) == deepreal(w);
    if c.parameter
      same = same && isequal(p.Dimensions, size(w)) && strcmp(p.Complexity, ternary(isreal(w), 'real', 'complex'));
    end
    msg = strtrim([lastwarn ' ' printed]);
    if ~isempty(msg), warned{end+1} = sprintf('%s %s: %s', c.file, c.entry, msg); end %#ok<AGROW>
    rows{k} = struct('file', c.file, 'entry', c.entry, 'literal', c.literal, 'matlab', c.matlab, 'control', c.control, ...
      'class', class(v), 'isreal', deepreal(v), 'size', size(v), 'same', same, 'warning', msg, 'extra', extra);
  catch e
    rows{k} = struct('file', c.file, 'entry', c.entry, 'literal', c.literal, 'matlab', c.matlab, 'control', c.control, ...
      'class', '', 'isreal', false, 'size', [0 0], 'same', false, 'warning', ['ERROR ' e.identifier ': ' e.message], 'extra', '');
  end
  r = rows{k};
  fprintf('CASE %-14s %-10s %-34s same=%d class=%s real=%d size=%s %s %s\n', r.file, r.entry, r.literal, r.same, r.class, r.isreal, mat2str(r.size), r.extra, r.warning);
end
v = ver('MATLAB');
fid = fopen(fullfile(out, 'complex_array_gate.truth.json'), 'w');
fprintf(fid, '%s', jsonencode(struct('release', v.Release, 'cases', {rows}), 'PrettyPrint', true));
fclose(fid);
control = [cases.control];
same = cellfun(@(r) r.same, rows);
if any(same(control)), error('CONTROL passed: the gate cannot tell two values apart'); end
if ~all(same(~control)), error('%d case(s) differ', nnz(~same(~control))); end
if ~isempty(warned), error('warnings: %s', strjoin(warned, ' | ')); end
fprintf('COMPLEX_ARRAY_GATE OK %d cases, control caught\n', nnz(~control));

function t = ternary(c, a, b)
  if c, t = a; else, t = b; end
end
