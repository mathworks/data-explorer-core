% How does MATLAB spell an ARRAY inside a cell, in the binary flavour?
%
% probe_cell_string.m settled one cell of this matrix -- `string` at the
% cell-element site -- and in doing so exposed the generalization: `parseCellElement`
% is a hand-rolled COPY of the class dispatch the entry and property sites share, so
% every idea added to the shared dispatch has to be added to the copy by hand, and
% the copy lags. Defect 52 was the missing `string` branch. This probe asks for the
% other idea the copy was missing: "a dimensioned element set", which the shared
% dispatch handles in one place (`parseArrayOfElements`) and the copy handled in
% three half-right ways.
%
% Only MATLAB can answer, because the three array kinds are spelled three different
% ways and a reader branch keyed on the wrong one is no fix: a complex array states
% its elements as TEXT, a struct array states its shape on the element ITSELF, and an
% object array states its shape on a CLASSLESS wrapper one level above the objects.
% Nothing about the data model predicts which; the bytes decide.
%
% The answers, measured against R2027a (27.1.0.3372387):
%
%   COMPLEX ARRAY -- the shape and the complexity ride on the same <Element>, and
%   the body is text whatever the rank:
%
%     <Element Class="double" IsComplex="1" Dimension="1*2">1.0+2.0i 3.0-4.0i</Element>
%     <Element Class="double" IsComplex="1" Dimension="2*1">1.0+2.0i 3.0-4.0i</Element>
%     <Element Class="double" IsComplex="1" Dimension="2*2*2">1.0+1.0i ... 8.0+8.0i</Element>
%
%   A complex SCALAR carries NO Dimension (`<Element Class="double" IsComplex="1">`),
%   which is exactly why defect 53 hid: the reader asked the shape first and only
%   reached its IsComplex check when there was no shape to find. So the scalar was
%   right and every complex ARRAY in a cell lost its imaginary parts -- on screen AND
%   out of the file, because the re-serialized element dropped IsComplex too.
%
%   STRUCT ARRAY -- the shape is on the element that declares the class, one child
%   <Element> per struct, the same way a struct-array PROPERTY states it on its <P>:
%
%     <Element Class="struct" Dimension="1*2">
%       <Element> <P Name="a" Class="double">1.0</P> </Element>
%       <Element> <P Name="a" Class="double">2.0</P> </Element>
%     </Element>
%
%   A 1x1 struct in a cell is the same shape with no Dimension, so a reader that
%   hardcodes 1x1 (defect 54) is right for the control and wrong for every array.
%
%   OBJECT ARRAY -- the shape is on a CLASSLESS wrapper, and the objects are its
%   children, each carrying its own class:
%
%     <Element Dimension="1*2">
%       <Element Class="Simulink.Parameter"> ... </Element>
%       <Element Class="Simulink.Parameter"> ... </Element>
%     </Element>
%
%   A SINGLE object in a cell is that same classless wrapper with no Dimension and
%   one child -- which is why a reader that just took the first child (defect 55)
%   looked correct until a cell held more than one object, and then showed the first
%   object's value as though the cell held a scalar and wrote the rest out of the
%   file.
%
%   THE TEXT FLAVOUR IS RIGHT FOR ALL THREE. That is the signature of this repo's
%   recurring defect class: the two channels spell the same value independently, so
%   an invariant has to be pinned BETWEEN them, not inside either one.
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('test/parity/matlab/probe_cell_arrays.m')"

outdir = getenv('CELL_ARRAYS_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'cellarrays'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end

pArr = [Simulink.Parameter(1) Simulink.Parameter(2)];
sArr = [struct('a', 1) struct('a', 2)];

C = { ...
    % --- the three defects, at the cell-element site --------------------------
    'cCplxArr',     {[1 + 2i, 3 - 4i]}; ...          % defect 53: complex ROW in a cell
    'cCplxCol',     {[1 + 2i; 3 - 4i]}; ...          %   ... and a COLUMN, same spelling
    'cCplxNd',      {reshape((1:8) + 1i * (1:8), 2, 2, 2)}; ... %   ... and rank 3
    'cStructArr',   {sArr}; ...                      % defect 54: struct ARRAY in a cell
    'cStructArr2D', {[struct('a',1) struct('a',2); struct('a',3) struct('a',4)]}; ...
    'cObjArr',      {pArr}; ...                      % defect 55: object ARRAY in a cell
    % --- the controls that hid them: each is the 1x1 of the row above ---------
    'cCplx',        {1 + 2i}; ...                    % no Dimension at all -> was right
    'cStruct',      {struct('a', 1)}; ...            % the hardcoded 1x1 -> was right
    'cObj',         {Simulink.Parameter(5)}; ...     % one child -> taking [0] was right
    % --- controls the fix must not regress ------------------------------------
    'cNd',          {reshape(1:12, 2, 3, 2)}; ...    % REAL N-D: still the shaped arm
    'cStr',         {"a"}; ...                       % defect 52's case, still lifted
    % --- the sibling sites, already right: the fix must agree with them -------
    'sObjArr',      struct('f', pArr); ...           % object array as a struct FIELD
    'sStructArr',   struct('f', {sArr}); ...         % struct array as a struct FIELD
    'pCplxArr',     Simulink.Parameter([1 + 2i, 3 - 4i])};  % complex array as a PROPERTY

fprintf('PROBE_BEGIN\nVERSION %s\n', version);

Simulink.data.dictionary.closeAll('-discard');
for fmt = {'uncompressed-text', 'compressed-binary'}
    tag = fmt{1};
    fn = fullfile(outdir, ['cellarr_' strrep(tag, '-', '_') '.sldd']);
    if exist(fn, 'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = tag;
    ds = dd.getSection('Design Data');
    for i = 1:size(C, 1)
        try
            ds.addEntry(C{i,1}, C{i,2});
        catch e
            fprintf('REJECTED %-13s %s\n', C{i,1}, e.message);
        end
    end
    clear ds
    dd.saveChanges();
    dd.close();

    % Read back through MATLAB's own API, so the class, the shape and the imaginary
    % parts of each nested value are MATLAB's answer and not ours. Those three are
    % exactly what the three defects destroyed.
    fprintf('\nREAD BACK (%s)\n', tag);
    dd = Simulink.data.dictionary.open(fn);
    ds = dd.getSection('Design Data');
    for i = 1:size(C, 1)
        try
            fprintf('  %-13s %s\n', C{i,1}, describe(ds.getEntry(C{i,1}).getValue(), 1));
        catch e
            fprintf('  %-13s UNREADABLE %s\n', C{i,1}, e.message);
        end
    end
    clear ds
    dd.close();
    fprintf('FILE %s\n', fn);
end

% ---- the bytes MATLAB actually wrote -----------------------------------------
% The binary flavour is a ZIP of XML, and the nesting IS the answer here, so print
% the whole chunk rather than an attribute-filtered view of it.
fprintf('\nBINARY XML\n');
zdir = fullfile(outdir, 'unzipped');
if exist(zdir, 'dir'), rmdir(zdir, 's'); end
names = unzip(fullfile(outdir, 'cellarr_compressed_binary.sldd'), zdir);
for j = 1:numel(names)
    if exist(names{j}, 'file') ~= 2, continue, end
    body = fileread(names{j});
    if isempty(strfind(body, 'cCplxArr')) %#ok<STREMP>
        continue
    end
    fprintf('  --- %s\n', names{j});
    disp(body);
end

fprintf('\nTEXT JSON\n');
txt = regexprep(fileread(fullfile(outdir, 'cellarr_uncompressed_text.sldd')), '\s+', ' ');
for i = 1:size(C, 1)
    k = strfind(txt, ['"' C{i,1} '"']);
    if isempty(k)
        fprintf('  %-13s NOT FOUND\n', C{i,1});
        continue
    end
    fprintf('  %s\n', txt(k(1):min(numel(txt), k(1) + 300)));
end

disp('CELLARRAYS OK');

% ---- a recursive class/size/value description: MATLAB's own truth per element --
% Local functions must be last in a script file.
function s = describe(v, depth)
    if depth > 3
        s = '...';
        return
    end
    tag = sprintf('%s%s', class(v), mat2str(size(v)));
    if iscell(v)
        parts = cell(1, numel(v));
        for k = 1:numel(v)
            parts{k} = describe(v{k}, depth + 1);
        end
        s = sprintf('%s{%s}', tag, strjoin(parts, ', '));
    elseif isstruct(v)
        f = fieldnames(v);
        parts = cell(1, numel(f));
        for k = 1:numel(f)
            if isempty(v)
                parts{k} = f{k};
            else
                parts{k} = sprintf('%s=%s', f{k}, describe(v(1).(f{k}), depth + 1));
            end
        end
        s = sprintf('%s(%s)', tag, strjoin(parts, ', '));
    elseif isobject(v) && ~isempty(v) && isprop(v(1), 'Value')
        % `v(1)` not `v`: isprop on a 1x2 object array answers 1x2, and `&&` refuses a
        % non-scalar -- an object ARRAY is half of what this probe measures, so that
        % throw would have hidden the answer behind UNREADABLE.
        % An object array has no scalar Value either, so describe element 1 and say so.
        if isscalar(v)
            s = sprintf('%s[Value=%s]', tag, describe(v.Value, depth + 1));
        else
            s = sprintf('%s[1.Value=%s]', tag, describe(v(1).Value, depth + 1));
        end
    elseif ischar(v) || isstring(v)
        % Reshape first: indexing a 2-D char/string with (1,:) is not the flat order
        % the file stores, and `v(1)` on an EMPTY one throws.
        flat = string(v(:)');
        if isempty(flat)
            s = tag;
        else
            s = sprintf('%s"%s"', tag, strjoin(flat, ' '));
        end
    elseif isnumeric(v) || islogical(v)
        if isempty(v)
            s = tag;
        else
            % `.'` not `'`: the plain transpose CONJUGATES, which would print the
            % imaginary parts with the wrong sign -- in a probe about complex values
            % that is the one mistake that makes the truth unreadable.
            s = sprintf('%s=%s', tag, mat2str(reshape(v, 1, []), 17));
        end
    else
        s = tag;
    end
end
