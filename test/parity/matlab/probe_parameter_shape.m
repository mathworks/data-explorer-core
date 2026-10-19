% What are a Simulink.Parameter's Dimensions and Complexity after an edit of its Value: an
% element removed or added, an element set, or a whole Value typed in? (B-25, group H,
% measured 2026-10-19.)
%
% Core kept the Dimensions and Complexity it read, so after such an edit they no longer said
% the Value's shape: pRow cut from 3 elements to 2 still showed and saved Dimensions [1 3], and
% [1 2 3 4] typed over it saved Dimensions [1 3] with Complexity 'complex'. The ruling A7
% (2026-10-15) fixed the removal that collapses a Value to a scalar, which MATLAB measured; this
% asks MATLAB the rest before core follows it.
%
% Every row opens a copy of the repo fixture ../../fixtures/mcos/complex_binary.sldd (a binary
% dictionary MATLAB wrote), takes one entry's value, runs the row's MATLAB statements on it as p
% (each one an edit core's tree can make: Add appends a 0 of the array's class, a removal cuts
% one element, an element editor sets a real number, a Value typed in replaces the Value), and
% records p's Dimensions and Complexity before and after, and the Value's class, size and
% isreal. The dictionary is closed with its changes discarded.
%
% MAKE (PARAM_SHAPE_MAKE=1) also writes symbolic_dims.sldd: the fixture with pRow's Dimensions set
% to the symbolic '[1,N]', which MATLAB keeps through every edit of the Value (the symbolic_* rows),
% and records how its chunk spells it (symbolicDimensionsTag). The file is not kept in the tree: it
% respells every entry and names the user who saved it. Core's half makes its own copy of the
% fixture with that one tag in place (parameter_shape.mjs, fileBytes).
% READ (when $PARAM_SHAPE_OUT holds core_*.sldd, saved by core from the same fixture after the
% same edits, named core_<id>.sldd): what MATLAB reads of that row's entry there.
%
% Run: cp test/fixtures/mcos/complex_binary.sldd /tmp/paramshape/
%      env PARAM_SHAPE_OUT=/tmp/paramshape PARAM_SHAPE_MAKE=1 mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_parameter_shape.m')"
% after: node test/parity/matlab/parameter_shape.mjs /tmp/paramshape   (with dist built: core_*.sldd,
%        which the READ of the next run opens; run it again, with PARAM_SHAPE_MAKE=1)
% then: cp /tmp/paramshape/parameter_shape.truth.json test/parity/matlab/
% Prints PARAMETER_SHAPE OK on its last line. Graded by ../../parameterShape.test.ts.
% Output: parameter_shape.truth.json, {version, release, date, symbolicDimensionsTag, rows, reads}: each row
% {id, entry, edit, before: {dimensions, complexity}, ok, identifier, message,
%  after: {dimensions, complexity, valueClass, valueSize, isreal}}; each read
% {file, id, entry, error | after}.

outdir = getenv('PARAM_SHAPE_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'paramshape'); end
fixture = fullfile(outdir, 'complex_binary.sldd');
assert(exist(fixture, 'file') == 2, 'copy test/fixtures/mcos/complex_binary.sldd to %s first', outdir);
Simulink.data.dictionary.closeAll('-discard');
fprintf('VERSION %s\n', version);

% MAKE (PARAM_SHAPE_MAKE=1): symbolic_dims.sldd, a copy of the fixture whose pRow MATLAB has given
% the symbolic Dimensions '[1,N]', saved; and how its chunk spells that Dimensions
% (symbolicDimensionsTag), which core's half puts into its copy of the fixture.
symbolicTag = '';
if strcmp(getenv('PARAM_SHAPE_MAKE'), '1')
    made = fullfile(outdir, 'symbolic_dims.sldd');
    if exist(made, 'file'), delete(made); end
    copyfile(fixture, made);
    dd = Simulink.data.dictionary.open(made);
    en = getEntry(getSection(dd, 'Design Data'), 'pRow');
    p = getValue(en); p.Dimensions = '[1,N]'; setValue(en, p);
    saveChanges(dd); close(dd);
    Simulink.data.dictionary.closeAll('-discard');
    parts = fullfile(outdir, 'symbolic_dims_parts');
    if exist(parts, 'dir'), rmdir(parts, 's'); end
    unzip(made, parts);
    xml = fileread(fullfile(parts, 'data', 'chunk0.xml'));
    at = strfind(xml, '<P Name="Name" Class="char">pRow</P>');
    stop = strfind(xml(at(1):end), '</Object>');
    symbolicTag = regexp(xml(at(1):at(1) + stop(1)), '<P Name="Dimensions"[^>]*>[^<]*</P>', 'match', 'once');
    fprintf('MADE %s: %s\n', made, symbolicTag);
end

% {id, entry, MATLAB statements on p}.
cases = { ...
    'cut_row_to_2',        'pRow',      'p.Value(3) = [];'; ...
    'cut_row_to_1',        'pRow',      'p.Value(3) = []; p.Value(2) = [];'; ...
    'cut_col_to_2',        'pCol',      'p.Value(3) = [];'; ...
    'cut_int16_to_2',      'pInt16Row', 'p.Value(3) = [];'; ...
    'add_row',             'pRow',      'p.Value(end+1) = 0;'; ...
    'add_col',             'pCol',      'p.Value(end+1) = 0;'; ...
    'add_int16',           'pInt16Row', 'p.Value(end+1) = 0;'; ...
    'add_then_cut',        'pRow',      'p.Value(end+1) = 0; p.Value(end) = [];'; ...
    'element_one_real',    'pRow',      'p.Value(1) = 7;'; ...
    'elements_all_real',   'pRow',      'p.Value(1) = 7; p.Value(2) = 8; p.Value(3) = 9;'; ...
    'typed_real_row',      'pRow',      'p.Value = [1 2 3 4];'; ...
    'typed_real_col',      'pRow',      'p.Value = [1; 2; 3];'; ...
    'typed_matrix',        'pRow',      'p.Value = [1 2; 3 4];'; ...
    'typed_scalar',        'pRow',      'p.Value = 5;'; ...
    'typed_complex',       'pRow',      'p.Value = 3+4i;'; ...
    'typed_zero_imag',     'pRow',      'p.Value = 1+0i;'; ...
    'typed_empty',         'pRow',      'p.Value = [];'; ...
    'typed_empty_char',    'pRow',      'p.Value = '''';'; ...
    'typed_empty_string',  'pRow',      'p.Value = "";'; ...
    'typed_empty_on_real', 'pRow',      'p.Value = [1 2]; p.Value = [];'; ...
    'typed_empty_on_struct','pStruct',  'p.Value = [];'; ...
    'typed_empty_then_row','pRow',      'p.Value = []; p.Value = [1 2 3 4];'; ...
    'typed_empty_then_struct','pRow',   'p.Value = []; p.Value = struct(''field'', 0);'; ...
    'typed_struct_over_complex','pRow', 'p.Value = struct(''field'', 0);'; ...
    'typed_char',          'pRow',      'p.Value = ''abc'';'; ...
    'typed_string',        'pRow',      'p.Value = "abc";'; ...
    'typed_logical_row',   'pRow',      'p.Value = [true false];'; ...
    'typed_logical',       'pRow',      'p.Value = true;'; ...
    'typed_over_scalar',   'pScalar',   'p.Value = [1 2 3 4];'; ...
    'typed_over_struct',   'pStruct',   'p.Value = [1 2 3 4];'; ...
    'typed_then_add',      'pRow',      'p.Value = [1 2 3]; p.Value(end+1) = 0;'; ...
    'typed_then_cut',      'pRow',      'p.Value = [1 2 3]; p.Value(3) = [];'; ...
    'struct_add_field',    'pStruct',   'p.Value.field = 0;'; ...
    'symbolic_set',        'pRow',      'p.Dimensions = ''[1,N]'';'; ...
    'symbolic_cut',        'pRow',      'p.Dimensions = ''[1,N]''; p.Value(3) = [];'; ...
    'symbolic_add',        'pRow',      'p.Dimensions = ''[1,N]''; p.Value(end+1) = 0;'; ...
    'symbolic_typed',      'pRow',      'p.Dimensions = ''[1,N]''; p.Value = [1 2 3 4];'; ...
    'symbolic_typed_scalar','pRow',     'p.Dimensions = ''[1,N]''; p.Value = 5;'; ...
    'symbolic_typed_empty','pRow',      'p.Dimensions = ''[1,N]''; p.Value = [];'; ...
    'dimensions_set_other','pRow',      'p.Dimensions = [1 5];'; ...
    'complexity_set_real', 'pRow',      'p.Complexity = ''real'';'};

rows = {};
for k = 1:size(cases, 1)
    r = struct('id', cases{k,1}, 'entry', cases{k,2}, 'edit', cases{k,3}, ...
               'before', [], 'ok', false, 'identifier', '', 'message', '', 'after', []);
    Simulink.data.dictionary.closeAll('-discard');
    work = fullfile(outdir, 'work.sldd');
    if exist(work, 'file'), delete(work); end
    copyfile(fixture, work);
    dd = Simulink.data.dictionary.open(work);
    p = getValue(getEntry(getSection(dd, 'Design Data'), cases{k,2})); %#ok<NASGU>
    r.before = struct('dimensions', p.Dimensions, 'complexity', p.Complexity);
    try
        eval(cases{k,3});
        r.ok = true;
    catch e
        r.identifier = e.identifier; r.message = e.message;
    end
    r.after = shapeOf(p);
    close(dd);
    Simulink.data.dictionary.closeAll('-discard');
    rows{end+1} = r; %#ok<AGROW>
    fprintf('ROW %-22s ok=%d %s => %s\n', r.id, r.ok, r.identifier, jsonencode(r.after));
end

% What MATLAB reads of core's saves (core_<id>.sldd), where there are any.
reads = {};
d = dir(fullfile(outdir, 'core_*.sldd'));
for f = sort({d.name})
    id = regexprep(f{1}, '^core_(.*)\.sldd$', '$1');
    at = find(strcmp(cases(:,1), id));
    if isempty(at), continue; end
    q = struct('file', f{1}, 'id', id, 'entry', cases{at,2}, 'error', '', 'after', []);
    Simulink.data.dictionary.closeAll('-discard');
    try
        dd = Simulink.data.dictionary.open(fullfile(outdir, f{1}));
        q.after = shapeOf(getValue(getEntry(getSection(dd, 'Design Data'), cases{at,2})));
        close(dd);
    catch e
        q.error = e.message;
    end
    Simulink.data.dictionary.closeAll('-discard');
    reads{end+1} = q; %#ok<AGROW>
    fprintf('READ %-28s %s => %s %s\n', f{1}, q.entry, q.error, jsonencode(q.after));
end

truth = struct('version', version, 'release', version('-release'), ...
               'date', char(datetime('now', 'Format', 'yyyy-MM-dd')), 'symbolicDimensionsTag', symbolicTag, ...
               'rows', {rows}, 'reads', {reads});
fid = fopen(fullfile(outdir, 'parameter_shape.truth.json'), 'w');
fprintf(fid, '%s\n', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('PARAMETER_SHAPE OK\n');

function s = shapeOf(p)
    v = p.Value;
    s = struct('dimensions', p.Dimensions, 'complexity', p.Complexity, ...
               'valueClass', class(v), 'valueSize', size(v), 'isreal', isreal(v));
end
