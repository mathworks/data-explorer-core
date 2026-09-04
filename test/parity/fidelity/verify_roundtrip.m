function verify_roundtrip(slddPath, entryName, specJson)
% Definitive UI->serializer->MATLAB-truth gate. Opens a .sldd our code produced,
% reads back the named entry, and asserts each expected property EQUALS what the
% UI set (value AND type) — not merely that the file opened.
%
% specJson: a JSON object mapping a property PATH to an expected value, e.g.
%   {"Min":5, "Value":[1,2,3], "CoderInfo.StorageClass":"ExportedGlobal",
%    "DataType":"int32", "__class__":"Simulink.Parameter", "__count__":3}
% Special keys: "__class__" asserts class(v); "__count__" asserts
% numel(v.Elements); "__value__" asserts the entry's own value; "__size__"
% asserts size(v).
% A dotted path walks sub-objects (CoderInfo.StorageClass). String expecteds are
% compared with isequal after char() coercion; numeric with isequal (exact).
%
% __value__ and __size__ together pin an entry's value COMPLETELY, and they are two
% keys rather than one for two reasons that are both about what JSON cannot say:
%
%   - isequal ignores CLASS. isequal(int32(5), 5) is true, so a 5 that came back a
%     double when we wrote an int32 passes __value__ and there is no expected class
%     to compare against — jsondecode makes every JSON number a double. So a class
%     claim must be spelled __class__, which is checked as its own assertion. Do not
%     add a third spelling.
%   - JSON has no row-vs-column. A flat [7,8,9] arrives from jsondecode as a 3x1
%     COLUMN, while the entry may be a 1x3 row, and isequal would then fail on a
%     correct value. So __value__ compares column-major linearized contents plus
%     numel, and __size__ asserts the shape. Neither can be fooled: a transpose
%     linearizes differently ([1 2 3;4 5 6] gives 1 4 2 5 3 6, its transpose gives
%     1 2 3 4 5 6) and size() is exact.
%
% A __value__ given as a STRING is compared against MATLAB's own text for the value
% instead, which is the escape hatch for the two things JSON cannot spell:
%   - a 64-bit integer, exactly — the same limit that caused defect 1.
%     "18446744073709551615" is how to assert intmax('uint64') survived.
%   - a non-finite. Inf is not a JSON number, and mixing it with numbers makes
%     jsondecode hand back a cell, so "[1 Inf -Inf NaN 5]" (mat2str's spelling) is
%     the only way to assert nonFinVec at all.
%
% Prints one line per assertion: "PASS <path>" or "FAIL <path> expected=.. got=..",
% then a final "RESULT PASS|FAIL n/m". Exit-style: the vitest caller greps RESULT.
%
% Run:  mw matlab -nodesktop -batch "cd('test/parity/fidelity'); verify_roundtrip('/tmp/x.sldd','MyParam','{\"Min\":5}')"

spec = jsondecode(specJson);
Simulink.data.dictionary.closeAll('-discard');
dd = Simulink.data.dictionary.open(slddPath);
c0 = onCleanup(@() safeClose(dd)); %#ok<NASGU>
sec = getSection(dd, 'Design Data');
e = getEntry(sec, entryName);
v = getValue(e);

keys = fieldnames(spec);
nPass = 0; nTot = 0;
for k = 1:numel(keys)
    key = keys{k};
    nTot = nTot + 1;
    % jsondecode mangles field names: any char that is not valid in a MATLAB
    % identifier becomes _0xHH_ (its hex code), and a leading underscore gets an
    % 'x' prefix. Undo BOTH generically so paths like "Elements(1).Min" (where
    % '.', '(' and ')' are all hex-escaped) resolve, not just the dot case.
    origKey = regexprep(key, '_0x([0-9A-Fa-f]{2})_', '${char(hex2dec($1))}');
    if strncmp(origKey, 'x__', 3); origKey = origKey(2:end); end
    expected = spec.(key);
    try
        if strcmp(origKey, '__class__')
            got = class(v); ok = strcmp(got, expected);
            report(origKey, ok, expected, got); nPass = nPass + ok;
        elseif strcmp(origKey, '__count__')
            got = numel(v.Elements); ok = isequal(got, expected);
            report(origKey, ok, num2str(expected), num2str(got)); nPass = nPass + ok;
        elseif strcmp(origKey, '__value__')
            % Compare the entry value directly (for plain variables where v IS
            % the value, not an object with properties). See the header for why
            % this does not coerce to double and does not assert class or shape.
            ok = compareValue(v, expected);
            report(origKey, ok, toStr(expected), toStr(v)); nPass = nPass + ok;
        elseif strcmp(origKey, '__size__')
            % size() is always a ROW, and jsondecode makes a flat JSON array a
            % column, so the expected is reshaped to a row before comparing. That
            % is a spelling fix, not a leniency: the extents themselves are
            % compared exactly and in order.
            got = size(v); want = reshape(double(expected), 1, []);
            ok = isequal(got, want);
            report(origKey, ok, toStr(want), toStr(got)); nPass = nPass + ok;
        else
            got = walkPath(v, origKey);
            ok = compareVal(got, expected);
            report(origKey, ok, toStr(expected), toStr(got)); nPass = nPass + ok;
        end
    catch err
        fprintf('FAIL %s (read error: %s)\n', origKey, regexprep(err.message,'\s+',' '));
    end
end
fprintf('RESULT %s %d/%d\n', ternary(nPass==nTot,'PASS','FAIL'), nPass, nTot);
end

function val = walkPath(v, path)
% Walk a dotted property path, with optional 1-based array indexing on any
% segment: "Elements(2).Name" reads v.Elements(2).Name. This lets a
% structural round-trip assert the value of a specific bus element / struct
% field after an add/remove.
parts = strsplit(path, '.');
val = v;
for i = 1:numel(parts)
    seg = parts{i};
    tok = regexp(seg, '^([A-Za-z_]\w*)\((\d+)\)$', 'tokens', 'once');
    if ~isempty(tok)
        val = val.(tok{1});
        val = val(str2double(tok{2}));
    else
        val = val.(seg);
    end
end
end

function ok = compareValue(got, expected)
% __value__'s comparison. Exact, no double() coercion — that coercion is what makes
% compareVal unusable here: double(uint64(18446744073709551615)) rounds, so a 64-bit
% value that came back WRONG would still compare equal, which is defect 1 all over
% again in the very gate meant to catch it.
if ischar(expected) || isstring(expected)
    % A string expected is compared against MATLAB's OWN text for the value, and
    % which text that is depends on the value, because no single spelling covers
    % all three reasons to reach this branch:
    %   char/string value -> the characters themselves
    %   scalar            -> string(), which prints every digit of a 64-bit integer
    %                        and adds no class wrapper ("18446744073709551615")
    %   array             -> mat2str(), the only spelling that can carry a
    %                        non-finite: [1 Inf -Inf NaN 5] has no JSON form at all
    %                        (Inf is not a JSON number, and mixing it with numbers
    %                        makes jsondecode return a cell), so without this an
    %                        array of non-finites could not be asserted.
    if ischar(got) || isstring(got)
        actual = char(string(got));
    elseif isscalar(got)
        actual = char(string(got));
    else
        actual = mat2str(got);
    end
    ok = strcmp(actual, char(string(expected)));
elseif isnumeric(expected) || islogical(expected)
    % Column-major contents plus count. isequal across classes compares VALUES,
    % so this is exact for anything a double can hold; class is __class__'s job
    % and shape is __size__'s.
    ok = numel(got) == numel(expected) && isequal(got(:), reshape(expected, [], 1));
else
    ok = isequal(got, expected);
end
end

function ok = compareVal(got, expected)
if ischar(expected) || isstring(expected)
    ok = strcmp(char(string(got)), char(string(expected)));
elseif isnumeric(expected)
    ok = isequal(double(got), double(expected));
elseif islogical(expected)
    ok = isequal(logical(got), expected);
else
    ok = isequal(got, expected);
end
end

function report(key, ok, exp, got)
if ok
    fprintf('PASS %s\n', key);
else
    fprintf('FAIL %s expected=%s got=%s\n', key, exp, got);
end
end

function s = toStr(v)
% The printed form in a failure line, so it has to be legible for the values this
% gate exists for: mat2str spells a 64-bit integer and a non-finite exactly, where
% num2str rounds. It also REFUSES rank >= 3 ("Input matrix must be 2-D"), and a
% failure whose diagnostic itself errors tells the reader nothing — so the shape
% summary is the fallback rather than an exception.
if ischar(v); s = ['''' v ''''];
elseif isstring(v); s = char(v);
elseif isnumeric(v) || islogical(v)
    if isempty(v)
        s = '[]';
    else
        try
            s = mat2str(v);
        catch
            s = ['<' regexprep(num2str(size(v)), '\s+', 'x') ' ' class(v) '>'];
        end
    end
else; s = ['<' class(v) '>']; end
end

function r = ternary(c,a,b); if c; r=a; else; r=b; end; end
function safeClose(dd); try; close(dd); catch; end; end
