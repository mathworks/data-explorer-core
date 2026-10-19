% What does MATLAB make of a cell literal whose member opens with a sign and a space
% (`{- 2}`, `{1, - 2}`), or with its imaginary part (`{i + 1}`, `{2i - 3}`), and of the
% arithmetic beside those forms (`{- 2 - 3}`, `{[1] - 2}`, `{i + 1i}`), spaced or not (`{1+2}`, `{-a}`)?
% And of a member whose imaginary part is a literal zero (`{0i}`, `{1 + 0i}`, `{0i + 1}`), at the top
% level too (`1 + 0i`): which of them does MATLAB hold as a real double?
%
% The grading table is ../../cellSignMember.test.ts, which quotes each LIT row of this
% probe's output (R2027a, 27.1.0.3409468) above the entry it grades. The parser
% (MatlabValueParser.tokenizeCellElements) reads the forms MATLAB makes one literal value
% of, and refuses the rest, because it does no arithmetic.
%
% `eval` of each literal only: it opens and writes no file. Run with
%   matlab -batch "run('<abs path>/probe_cell_sign_literals.m')"
% Ends with `CELL_SIGN OK`.
fprintf('### VERSION %s\n', version);
lits = {'{- 2}', '{-2}', '{1, - 2}', '{i + 1}', '{2i - 3}', '{i+1}', '{2i-3}', '{+ 2}', '{-  2}', ...
        '{- 2 3}', '{- 2, 3}', '{1 , - 2}', '{1 ,- 2}', '{1; - 2}', '{- 3; i + 1}', '{i + 1, 2i - 3}', ...
        '{2i - 3, 4}', '{- 2 + 3i}', '{- i}', '{+ i}', '{- 2i}', '{1, - 2i}', '{- Inf}', '{- NaN}', '{- 0}', ...
        '{-2i + 3}', '{- 3i + 2}', '{-i + 1}', '{i + Inf}', '{i - Inf}', '{i + NaN}', '{2j - 3}', '{1j + 1}', ...
        '{2i - 1e3}', '{2.5i + .5}', '{i - 0}', '{-i - 0}', '{i +1}', '{2i -3}', ...
        '{- 2 - 3}', '{- 2 + 3}', '{1, - 2 - 3}', '{- -2}', '{- a}', '{[1] - 2}', '{''a'' - 2}', '{"a" - 2}', ...
        '{[1 2] + 3}', '{- [1 2]}', '{- ''a''}', '{1 - 2}', '{a + b}', '{1 + 2i + 3}', '{i + 1i}', '{i + 1 + 2}', ...
        '{2i+3i}', '{i + -1}', '{1 + -2i}', '{Infi + 1}', '{- 2 3i}', ...
        '{1+2}', '{1-2}', '{a+b}', '{a-b}', '{-a}', '{+a}', '{2*3}', '{6/2}', '{6\2}', '{2^3}', '{2.*3}', ...
        '{1, 2+3}', '{2+3, 1}', '{1+2; 3}', '{1+2+3i}', '{-pi}', '{-true}', '{-}', '{+}', ...
        '{abc}', '{1e+3}', '{1e-3}', '{1+2i}', '{-2i}', ...
        '{0i}', '{0j}', '{-0i}', '{+0i}', '{- 0i}', '{+ 0i}', '{0.0i}', '{.0i}', '{0.i}', '{0e3i}', '{0e-3i}', '{1e-400i}', ...
        '{1 + 0i}', '{1+0i}', '{1 - 0i}', '{1-0i}', '{-1 + 0i}', '{- 1 + 0i}', '{-1-0i}', '{0 + 0i}', '{0+0i}', ...
        '{-0 + 0i}', '{-0+0i}', '{-0 - 0i}', '{-0-0i}', '{- 0 - 0i}', '{Inf + 0i}', '{-Inf - 0i}', '{NaN + 0i}', '{NaN - 0i}', ...
        '{1 + 0j}', '{2.5 - 0.0i}', '{1e3 + 0e2i}', '{1 + 1e-400i}', '{1 +0i}', ...
        '{0i + 1}', '{0i+1}', '{0i - 1}', '{0i-1}', '{-0i + 1}', '{- 0i + 1}', '{-0i - 1}', '{0i + 0}', '{0i - 0}', ...
        '{-0i - 0}', '{-0i + 0}', '{0i + Inf}', '{0i - Inf}', '{0i + NaN}', '{0j + 2}', '{0.0i + .5}', '{0i +1}', ...
        '{1, 0i}', '{0i, 1 + 0i}', '{0i; 1 + 0i}', '{1 + 0i, 2i + 1}', '{1, - 0i}', '{{0i}}', '{{1 + 0i}}', '{{0i + 1}}', ...
        '{1 + 0.5i}', '{0.5i + 1}', '{[0i 1]}', '{[1+0i 2]}', ...
        '0i', '-0i', '1 + 0i', '1+0i', '0i + 1'};
for k = 1:numel(lits)
    try
        v = eval(lits{k});
        fprintf('LIT %-16s -> %s\n', lits{k}, desc(v));
    catch ME
        fprintf('LIT %-16s -> ERROR %s\n', lits{k}, ME.message);
    end
end
fprintf('CELL_SIGN OK\n');

function s = desc(v)
    if iscell(v)
        parts = cellfun(@desc, v(:)', 'UniformOutput', false);
        s = sprintf('cell %s {%s}', mat2str(size(v)), strjoin(parts, ' ; '));
    elseif isnumeric(v) || islogical(v)
        x = v(:).'; el = cell(1, numel(x));
        for q = 1:numel(x)
            if isreal(x)
                el{q} = numtxt(x(q));
            else
                el{q} = [numtxt(real(x(q))) ',' numtxt(imag(x(q))) 'i'];
            end
        end
        cplx = ''; if ~isreal(v), cplx = ' complex'; end
        s = sprintf('%s%s %s [%s]', class(v), cplx, mat2str(size(v)), strjoin(el, ' '));
    elseif ischar(v)
        s = sprintf('char %s ''%s''', mat2str(size(v)), v(:).');
    else
        s = sprintf('%s %s', class(v), mat2str(size(v)));
    end
end
function t = numtxt(x)
    if islogical(x), t = sprintf('%d', x); return; end
    if isinteger(x), t = sprintf('%d', x); return; end
    d = double(x);
    if d == 0 && 1/d < 0, t = '-0'; else, t = sprintf('%.17g', d); end
end
