% How does MATLAB spell a shaped value INSIDE a cell, in a text .sldd?
%
% The cell arm of MatlabValueParser used to read an element with its own bespoke
% code rather than with the parser's own `parse`, and the two disagreed: the `[`
% branch kept the flat element list and threw the DIMS away, so `{[1;2]}` became a
% 1x2 and was written back as `{[1 2]}` (defect 49). Fixing it means writing the
% element's shape down, and a cell element is the one place none of the existing
% probes had asked what that spelling is -- probe_matrix_serial.m answered it for a
% top-level value, probe_char_shape.m for a char, probe_typed_shapes.m for a struct
% field.
%
% The answers, and every one of them is now a line in cellElementRaw:
%
%   {[1;2]}         {"_type": "double",  "_value": "Matrix(2,1)\n[1.0, 2.0]"}
%   {[1 2;3 4]}     {"_type": "double",  "_value": "Matrix(2,2)\n[[1.0, 2.0]; [3.0, 4.0]]"}
%   {[1 2]}         [1, 2]          <- a double ROW is bare, and it is the only array that is
%   {[]}            []
%   {[true;false]}  {"_type": "logical", "_value": "Matrix(2,1)\n[1, 0]"}
%   {[true false]}  {"_type": "logical", "_value": "[1, 0]"}   <- a logical row is NOT bare
%   {true}          true
%   {['ab';'cd']}   {"_type": "mxchar",  "_value": "Matrix(2,2)\n[[97, 98]; [99, 100]]"}
%   {'ab'}          "ab"
%   {["a";"b"]}     {"_array_type": "String", "_dimensions": [2,1], "_elements": ["a","b"]}
%   {["a" "b"]}     {"_array_type": "String", "_dimensions": [1,2], ...}  <- a string row IS wrapped
%   {"a"}           ["a"]           <- a 1x1 string is a one-element LIST, not a wrapper
%   {{1;2}}         {"_array_type": "Cell", "_dimensions": [2,1], "_elements": [1,2]}
%   {int32([1;2])}  {"_type": "int32",   "_value": "Matrix(2,1)\n[1, 2]"}
%   {1+2i}          {"_type": "cdata",   "_value": "<a MAT stream>"}
%
% Two of those are not choices we could have made ourselves. A bare JSON list says
% DOUBLE, which is why a logical row keeps a typed envelope the double row does not
% need; and a bare JSON string says CHAR, which is why a scalar string is `["a"]`.
% Note also that MATLAB omits `_mw_element_type` from a nested wrapper.
%
% One more answer, about the cell's OWN element list rather than one element, and it
% is the evidence for defect 50 (found while fixing 49, fixed in the commit after it):
%
%   {1 2; 3 4}      "_dimensions": [2,2], "_elements": [1, 3, 2, 4]
%
% Column-major, as every reader in this repo already stores a cell list -- and as it
% stores a STRING array's list, which had the same defect. The parser assembled both
% ROW-major, so editing a multi-row one transposed it. A numeric list is the exception
% and stays row-major, because formatMatrixSerial re-transposes that one on the way out.
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('test/parity/matlab/probe_cell_shapes.m')"

outdir = getenv('CELL_SHAPES_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'cellshapes'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end

% Each entry is a 1x1 cell holding one value, so the JSON printed below is the
% element spelling and nothing else.
C = { ...
    'cellCol',    {[1;2]}; ...
    'cellRow',    {[1 2]}; ...
    'cellMat',    {[1 2; 3 4]}; ...
    'cellNum',    {1}; ...
    'cellEmpty',  {[]}; ...
    'cellLogCol', {[true; false]}; ...
    'cellLogRow', {[true false]}; ...
    'cellLogSc',  {true}; ...
    'cellCharMat',{['ab'; 'cd']}; ...
    'cellCharRow',{'ab'}; ...
    'cellStrCol', {["a"; "b"]}; ...
    'cellStrRow', {["a" "b"]}; ...
    'cellStrSc',  {"a"}; ...
    'cellNest',   {{1;2}}; ...
    'cellInt',    {int32([1;2])}; ...
    'cellCplx',   {1+2i}; ...
    % Not a 1x1: the ORDER a multi-row cell's own elements are written in. The
    % values are asymmetric under transpose, so a column-major list reads
    % [1, 3, 2, 4] and a row-major one [1, 2, 3, 4].
    'cell2x2',    {1 2; 3 4}};

Simulink.data.dictionary.closeAll('-discard');
fn = fullfile(outdir, 'cells_text.sldd');
if exist(fn, 'file'), delete(fn); end
dd = Simulink.data.dictionary.create(fn);
dd.FileFormat = 'uncompressed-text';   % the JSON flavour, which is the one with a spelling
ds = dd.getSection('Design Data');
for i = 1:size(C, 1)
    try
        ds.addEntry(C{i,1}, C{i,2});
    catch e
        fprintf('REJECTED %-12s %s\n', C{i,1}, e.message);
    end
end
clear ds
dd.saveChanges();
dd.close();

% ---- what MATLAB reads back out of its own file -------------------------------
fprintf('\nREAD BACK\n');
dd = Simulink.data.dictionary.open(fn);
ds = dd.getSection('Design Data');
for i = 1:size(C, 1)
    try
        v = ds.getEntry(C{i,1}).getValue();
        el = v{1};
        fprintf('  %-12s element class=%-8s size=%s\n', C{i,1}, class(el), mat2str(size(el)));
    catch e
        fprintf('  %-12s UNREADABLE %s\n', C{i,1}, e.message);
    end
end
clear ds
dd.close();

% ---- the bytes it wrote, one entry per line -----------------------------------
% Whitespace-collapsed so each element spelling reads as one line, with a cdata
% body elided (a complex element carries a whole MAT stream).
fprintf('\nTEXT JSON\n');
txt = fileread(fn);
for i = 1:size(C, 1)
    k = strfind(txt, ['"name": "' C{i,1} '"']);
    if isempty(k)
        fprintf('  %-12s NOT FOUND\n', C{i,1});
        continue
    end
    seg = txt(k(1):min(numel(txt), k(1) + 1200));
    stop = strfind(seg, '"name":');
    if numel(stop) > 1
        seg = seg(1:stop(2) - 1);
    end
    seg = regexprep(seg, '\s+', ' ');
    seg = regexprep(seg, '("_type": "cdata", "_value": ")[^"]*"', '$1<CDATA>"');
    fprintf('  %s\n', seg);
end
fprintf('FILE %s\n', fn);

disp('CELLSHAPES OK');
