% What does MATLAB make of an array literal holding a complex member: its class, isreal, size and
% every element's real and imaginary part, or the error it gives? (The complex-array input of core
% 1.46.1: MatlabValueParser.parseArray read every member of a `[...]` row as a real number, so one
% complex member refused the whole literal.)
%
% The answers, measured against R2027a, are complex_array_literals.truth.json, which
% test/complexArrayInput.test.ts holds the parser to: every literal it reads is read as MATLAB
% reads it, and every one it refuses is one MATLAB refuses, or reads as arithmetic, a call or a
% transpose, which this parser does not compute. In short:
%
%   - inside brackets a `+` or `-` with whitespace after it, or none before it, is binary:
%     `[1 + 2i]`, `[1+ 2i]` and `[1 - 2i]` are one element; one with whitespace before it and none
%     after is unary and starts an element: `[1 +2i]` and `[1 -2i]` are two, `[1 2 +3i]` three;
%   - a real member of a complex array is x+0i, and logical members are 1 and 0;
%   - an array whose every imaginary part is 0 is REAL: `[1+0i 2]`, `[0i 1]`, `[1+0i; 2+0i]`;
%   - `1+Infi`, `1NaNi`, `NaN+NaNi` are no MATLAB syntax (this package shows a part so).
%
% Output: complex_array_literals.truth.json beside this file, {release, cases: [{literal,
% error} | {literal, class, isreal, size, re, im}]}, re and im column-major, each part as
% sprintf('%.17g') spells it (Inf, -Inf, NaN, -0); a cell's members as `cell`.
% Run: matlab -batch "run('test/parity/matlab/probe_complex_array_literals.m')"
%
% The CONTROL, the last case, is `[1 2]`, which must read as the real double it is: a probe that
% reads every literal as complex, or none, fails it.

here = fileparts(mfilename('fullpath'));
L = {
 '[1+i,2i]', '[1+1i 2+2i]', '[1+i; 2i]', '[1i]', '[i]', '[1 + 2i]', '[1 +2i]', '[1+ 2i]', '[1 - 2i]', '[1 -2i]', '[1- 2i]', ...
 '[i 2]', '[1i, -2j]', '[1 2; 3i 4]', '[1+0i 2]', '[1+0i]', '[0i 1]', '[-0i]', '[-0i 1i]', '[1 2+3i]', '[1, 2+3i]', '[1 2+ 3i]', ...
 '[+1i]', '[- 1i]', '[1 - 2i 3]', '[i+1 2]', '[i + 1]', '[2i-3, 1]', '[1+2i+3]', '[1+2i 3+4i; 5 6i]', '[1e3+2.5e-1i -.5-2j]', ...
 '[Inf+1i NaN]', '[-Inf-2i 1]', '[1 , 2i]', '[1 ,2i]', sprintf('[1\t2i]'), '[1+2i;3]', '[1+2i;3 4]', '[1 2i;]', '[;1 2i]', ...
 '[1+i*2]', '[complex(1,2)]', '[1+2i 3]''', '[1+2I]', '[1 2 +3i]', '[1 2 + 3i]', '[ 1i ]', '[1i,]', '[,1i]', '[1i 2i,]', ...
 '[1+-2i]', '[1-+2i]', '[1 + -2i]', '[1 - -2i]', '[-1i -2i]', '[1e+2i]', '[1.i]', '[.5i]', '[1.5e2j 2]', '[0x10i]', '[1_0i]', ...
 '[true 1i]', '[1i true]', '[''a'' 1i]', '[int16(1) 2i]', '[1i; 2i; 3i]', '[1i 2i; 3i 4i]', '[1+1i, 2+2i; 3+3i, 4+4i]', ...
 '[-0-0i 1i]', '[-0+0i 1i]', '[0-0i]', '[1+0i; 2+0i]', '[NaN+NaNi]', '[1+Infi]', '[1NaNi]', '[Inf-Infi NaN+1i 1NaNi -Inf+2i]', ...
 '[1+Inf*1i]', '[1+1i*Inf]', '[Inf*1i]', '[- 2]', '[1, - 2]', '[1 - 2]', '[1 -2]', '[2i - 3]', '[1+2i, 3-4i; -5+6i, 7]', ...
 '{1+2i 3}', '{[1+2i 3]}', '{1 +2i}', '{[1 +2i]}', '{[0i 1]}', '{[1+0i 2]}', '{[1+i; 2i]}', ...
 '[1 2]'
};
p = @(x) arrayfun(@(v) sprintf('%.17g', v), x(:).', 'UniformOutput', false);
one = @(v) struct('class', class(v), 'isreal', isreal(v), 'size', size(v), 're', {p(real(v))}, 'im', {p(imag(v))});
cases = cell(1, numel(L));
for k = 1:numel(L)
  s = L{k};
  try
    v = eval(s);
    if iscell(v)
      members = cell(1, numel(v));
      for c = 1:numel(v), members{c} = one(v{c}); end
      cases{k} = struct('literal', s, 'class', 'cell', 'size', size(v), 'cell', {members});
    else
      r = one(v); r.literal = s; cases{k} = r;
    end
  catch e
    cases{k} = struct('literal', s, 'error', e.identifier);
  end
end
v = ver('MATLAB');
out = struct('release', v.Release, 'cases', {cases});
fid = fopen(fullfile(here, 'complex_array_literals.truth.json'), 'w');
fprintf(fid, '%s', jsonencode(out, 'PrettyPrint', true));
fclose(fid);
last = cases{end};
if ~(isfield(last, 'isreal') && last.isreal), error('CONTROL [1 2] did not read as real'); end
fprintf('COMPLEX_ARRAY_LITERALS OK %d cases\n', numel(L));
