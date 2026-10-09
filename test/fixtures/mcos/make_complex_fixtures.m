function make_complex_fixtures()
  % Copyright 2026 The MathWorks, Inc.
  % Authors the complex-MCOS fixtures: Simulink data objects whose numeric property is
  % COMPLEX (a Simulink.Parameter's Value, an mpt.Parameter's Value, a
  % Simulink.LookupTable's Table.Value), at top level and nested in a struct field or a
  % cell element, beside plain complex doubles as a control for the spelling the
  % extension already uses. Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<repo>/test/fixtures/mcos'); make_complex_fixtures"
  %
  % (One line, for the reason make_class_fixtures.m gives. Verify by the WROTE lines and
  % the trailing MAKE_COMPLEX_FIXTURES_DONE, not by the exit code; any FAIL line above it
  % means a fixture says something other than what this header promises.)
  %
  % Writes eight files into this folder:
  %   complex_objects.mat         MATLAB's default `save` format — Level 5, not -v7.3
  %   complex_objects.truth.json  MATLAB's answers about it, read back with `load`
  %   complex_ws.slx              an empty model whose MODEL WORKSPACE (DataSource 'Model
  %                               File', so the data is a part of the .slx itself) holds
  %                               complex Parameters, one of them inside a struct
  %   complex_ws.truth.json       MATLAB's answers about it, read back out of the
  %                               workspace of the model reopened from disk
  %   complex.sldd                a data dictionary, FileFormat 'uncompressed-text'
  %                               (R2027a's default, set explicitly here), whose
  %                               Design Data holds the SAME values as
  %                               complex_objects.mat, entry for variable — a
  %                               cross-venue twin of the .mat
  %   complex_sldd.truth.json     MATLAB's answers about it, read back out of the
  %                               dictionary reopened from disk
  %   complex_binary.sldd         the same entries again, FileFormat
  %                               'compressed-binary'. This is the venue whose
  %                               spelling of a complex value — `<P IsComplex="1">`
  %                               with MATLAB's own text body, `1.0+2.0i 3.0-4.0i` —
  %                               the reader hands the node layer as it is, so it is
  %                               the one an MCOS complex value is held to
  %   complex_binary_sldd.truth.json  MATLAB's answers about it, as above
  %
  % WHY THE TRUTH SPELLS EVERY VALUE OUT. jsonencode REFUSES a complex value ("Unable to
  % encode complex-valued objects of class double as JSON-formatted text"), so no
  % complex number reaches the JSON as itself. Every numeric value is recorded by
  % value_truth() instead: class, size, isreal, its real and imaginary parts as plain
  % numbers in MATLAB's column-major order, mat2str with and without 'class', disp, and
  % the same two spellings per element.
  %
  % WHICH SPELLING IS THE TARGET. mat2str's (`3+4i`, `[1+2i 3+4i 5+6i]`), which is the
  % one a table cell follows (gen_truth.m's elemTruth gives the reason), not disp's
  % Command Window `3.0000 + 4.0000i`. Two of MATLAB's answers here say that mat2str is
  % not a lossless spelling of a complex value, and both are recorded rather than
  % smoothed over:
  %   pZeroIm   Simulink.Parameter(complex(1,0)). The value is still complex after a
  %             save and a load (isreal false, Complexity 'complex'), but mat2str
  %             answers `1` and disp answers `1.0000 + 0.0000i`. Its ELEMENT, x(1),
  %             is real to MATLAB — indexing drops an all-zero imaginary part — so
  %             its elementDisp is `1` and its elementIsreal is true.
  %   pInt8     an int8 Value. mat2str answers `3-4i`, mat2str(...,'class') answers
  %             `int8(3-4i)`, disp answers `3 -    4i`.
  %   pNd       a 2x2x2 Value, which mat2str refuses ("Input matrix must be 2-D"):
  %             its record has mat2str_error, and its parts and per-element answers.
  %   pNonFinite  [complex(Inf,-Inf) complex(NaN,1) complex(1,NaN) complex(-Inf,2)].
  %             mat2str answers `[Inf-1i*Inf NaN+1i 1+1i*NaN -Inf+2i]`; a binary
  %             dictionary writes the body `Inf-Infi NaN+1.0i 1.0NaNi -Inf+2.0i`.
  %   pInt64    int64(complex(intmax('int64'), 1)), a real part no double holds:
  %             mat2str answers `complex(9223372036854775807,1)`.
  %   pStruct   a Simulink.Parameter whose Value is a STRUCT, struct('a', 1+2i, 'b',
  %             [3+4i 5-6i]): complex numbers one level inside a property.
  % Two more in the .mat only, because a dictionary cannot hold the first and the second
  % would bring a second class of node into the cross-venue comparison:
  %   pArr      a 1x2 Simulink.Parameter ARRAY, [Parameter(1+1i) Parameter(2-2i)]. An
  %             object array cannot be a dictionary entry (make_class_fixtures.m).
  %   holder    a ComplexHolder (ComplexHolder.m, beside this file): a custom class with a
  %             complex scalar Z, a struct S with complex field f, a cell C of a complex
  %             scalar and a complex row, and a complex 2x2 Zm.
  % No complex EMPTY is here, and that is MATLAB's answer rather than an omission: a
  % Simulink.Parameter(complex(zeros(1,0))) and a plain complex(zeros(1,0)) both stay
  % complex 1x0 through a .mat and a binary dictionary, but the text dictionary reads
  % both back as a REAL 0x0. A row the venues disagree on cannot be one catalog's row.
  %
  % WHICH CLASSES. Simulink.Parameter is the class the bug was found on. mpt.Parameter
  % is a second class with a Value, and Simulink.LookupTable puts the complex numbers
  % one object further down (its Table is a Simulink.lookuptable.Table object). The
  % classes probed and refused are in complex_objects.truth.json's notes.probes, each
  % with MATLAB's own message: a Simulink.Parameter's Min and Max refuse a complex
  % value, Simulink.Signal has no complex-capable numeric property
  % (Min and Max must be finite real doubles, InitialValue is a char), and neither a
  % Simulink.Breakpoint nor a Simulink.VariantControl will hold a complex value.
  %
  % WHY TWINS, AND WHY EACH TWIN IS BUILT, NOT ASSIGNED. make_nested_fixtures.m gives
  % both reasons. Every nested object here has a top-level twin of equal value built by
  % its own build() call, `twins` pairs them, and each pair records MATLAB's own
  % `sameHandle` (false) beside `isequal`. The nested values differ from every
  % top-level non-twin value, so a reader that resolved a nested object to the wrong
  % heap entry cannot pass by accident.
  %
  % WHY THE TRUTH COMES FROM THE FILES. Every entry is measured on what `load`, a model
  % reopened with load_system and a dictionary reopened with
  % Simulink.data.dictionary.open hand back — never on the values built here.
  %
  % The truth files, all three:
  %   version, release   version and version('-release') of the MATLAB that wrote them
  %   paths              one record per MATLAB path ('pRow', 's.p', 'c{2}', ...),
  %                      containers included. Every record has class, size, numel,
  %                      isobject, isempty, isreal and disp. isreal is MATLAB's answer
  %                      on the value itself, verbatim, so it is FALSE for every
  %                      struct, cell and object (gen_truth.m says the same); the
  %                      answer about the numbers is the one inside the value record.
  %                      Then by kind:
  %                        numeric  value_truth()'s fields, merged into the record
  %                        struct   fields
  %                        cell     elementClasses (column-major)
  %                        object   the class's own fields below, and `properties` in
  %                                 gen_truth.m's form — class, size, disp and mat2str
  %                                 of every property
  %                      Simulink.Parameter, mpt.Parameter: Value (a field_truth
  %                      record), DataType, Min, Max, Unit, Description, Dimensions
  %                      (raw, as make_nested_fixtures.m records it), Complexity.
  %                      Simulink.LookupTable: Table and Breakpoints, each a record of
  %                      this same form. Simulink.lookuptable.Table and .Breakpoint:
  %                      Value (a field_truth record), DataType, Min, Max, Unit,
  %                      FieldName, Description. ComplexHolder: Z, S, C and Zm, each a
  %                      field_truth record.
  %   field_truth        a numeric value's value_truth record; a scalar struct's
  %                      {class 'struct', fields, values: one field_truth per field};
  %                      a cell's {class 'cell', size, elements: one field_truth per
  %                      element, column-major}.
  %   value_truth        class, size, numel, isreal, disp, mat2str, mat2strClass
  %                      (mat2str(x, 'class')), real and imag (one entry per
  %                      element, column-major, so a 1x1 is still a one-element
  %                      array), and elementMat2str, elementDisp and elementIsreal
  %                      (column-major, each MATLAB's answer on x(k)). An entry of
  %                      real or imag is a plain number, except where a JSON number
  %                      cannot carry the value: Inf, -Inf and NaN are the strings
  %                      'Inf', '-Inf' and 'NaN' (jsonencode would write null for all
  %                      three), and an integer-class part beyond flintmax is its
  %                      exact decimal text (double() would round it). See parts_of.
  %   twins              {nested, twin, isHandle, isequal, isequaln, sameHandle,
  %                      recordsEqual} per pair, as in make_nested_fixtures.m.
  %   complex_objects.truth.json adds `variables` (`whos -file`: name, class, size,
  %   complex), `header` and `notes.probes`; complex_ws.truth.json adds the model name,
  %   the workspace DataSource, `variables`, the package's `parts` and the
  %   `workspaceParts` among them; complex_sldd.truth.json adds the section, its
  %   sorted `entries`, the reopened dictionary's FileFormat and the distinct
  %   LastModifiedBy of its entries.
  %
  % NO ACCOUNT NAME IN ANY FILE. The model's Creator and ModifiedByFormat are set to a
  % fixed word before it is saved, as make_nested_fixtures.m does. A dictionary writes
  % each entry's `modifiedby` from the USER environment variable, so USER is set to the
  % same word while the dictionary is made and restored afterwards. Every file written
  % — and every part of the .slx package — is then searched for the account name, and
  % a hit is a FAIL.
  here = fileparts(mfilename('fullpath'));
  failures = {};

  [matTruth, failures] = write_mat(here, failures);
  write_json(fullfile(here, 'complex_objects.truth.json'), matTruth);

  [wsTruth, failures] = write_slx(here, failures);
  write_json(fullfile(here, 'complex_ws.truth.json'), wsTruth);

  [ddTruth, failures] = write_sldd(here, failures, 'complex.sldd', 'uncompressed-text');
  write_json(fullfile(here, 'complex_sldd.truth.json'), ddTruth);

  [binTruth, failures] = write_sldd(here, failures, 'complex_binary.sldd', 'compressed-binary');
  write_json(fullfile(here, 'complex_binary_sldd.truth.json'), binTruth);

  if isempty(failures)
    fprintf('MAKE_COMPLEX_FIXTURES_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_COMPLEX_FIXTURES_FAILED %d\n', numel(failures));
  end
end

% ---------------------------------------------------------------------------
% The catalogs. A row is {path, getter, expected class, twin name, build key}.
% A row whose path is a variable name and that has a build key is a top-level
% variable built by that key; a row with a twin name gets a top-level variable
% of that name, built by the same build key as the nested value. A container
% row (no build key) is assembled by its writer.
% ---------------------------------------------------------------------------

function M = mat_catalog()
  % Also the .sldd's catalog: the dictionary holds the same names and values.
  M = {
    'pScalar',  @(L) L.pScalar,    'Simulink.Parameter',   '',       'scalar'
    'pRow',     @(L) L.pRow,       'Simulink.Parameter',   '',       'row'
    'pCol',     @(L) L.pCol,       'Simulink.Parameter',   '',       'col'
    'pMat',     @(L) L.pMat,       'Simulink.Parameter',   '',       'mat'
    'pNegIm',   @(L) L.pNegIm,     'Simulink.Parameter',   '',       'negIm'
    'pZeroRe',  @(L) L.pZeroRe,    'Simulink.Parameter',   '',       'zeroRe'
    'pFrac',    @(L) L.pFrac,      'Simulink.Parameter',   '',       'frac'
    'pSingle',  @(L) L.pSingle,    'Simulink.Parameter',   '',       'single'
    'pInt8',    @(L) L.pInt8,      'Simulink.Parameter',   '',       'int8'
    'pZeroIm',  @(L) L.pZeroIm,    'Simulink.Parameter',   '',       'zeroIm'
    'pNd',      @(L) L.pNd,        'Simulink.Parameter',   '',       'nd'
    'pNonFinite', @(L) L.pNonFinite, 'Simulink.Parameter', '',       'nonFinite'
    'pInt64',   @(L) L.pInt64,     'Simulink.Parameter',   '',       'int64'
    'pStruct',  @(L) L.pStruct,    'Simulink.Parameter',   '',       'struct'
    'mptP',     @(L) L.mptP,       'mpt.Parameter',        '',       'mpt'
    'lut',      @(L) L.lut,        'Simulink.LookupTable', '',       'lut'
    'z',        @(L) L.z,          'double',               '',       'z'
    'zRow',     @(L) L.zRow,       'double',               '',       'zRow'
    's',        @(L) L.s,          'struct',               '',       ''
    's.p',      @(L) L.s.p,        'Simulink.Parameter',   'spTop',  'sp'
    's.v',      @(L) L.s.v,        'Simulink.Parameter',   'svTop',  'sv'
    's.z',      @(L) L.s.z,        'double',               '',       'sz'
    'c',        @(L) L.c,          'cell',                 '',       ''
    'c{1}',     @(L) L.c{1},       'Simulink.Parameter',   'c1Top',  'c1'
    'c{2}',     @(L) L.c{2},       'Simulink.Parameter',   'c2Top',  'c2'
  };
end

function M = mat_only_catalog()
  % Rows the .mat holds and the dictionaries do not: see the header.
  M = {
    'pArr',     @(L) L.pArr,       'Simulink.Parameter',   '',       'arr'
    'holder',   @(L) L.holder,     'ComplexHolder',        '',       'holder'
  };
end

function W = ws_catalog()
  W = {
    'pScalar', @(V) V.pScalar, 'Simulink.Parameter', '',        'scalar'
    'pRow',    @(V) V.pRow,    'Simulink.Parameter', '',        'row'
    'z',       @(V) V.z,       'double',             '',        'z'
    'cfg',     @(V) V.cfg,     'struct',             '',        ''
    'cfg.p',   @(V) V.cfg.p,   'Simulink.Parameter', 'cfgPTop', 'cfgP'
  };
end

function v = build(key)
  % One value per key, a FRESH object on every call — see the header for why a twin
  % may not be a second name for the nested object.
  switch key
    case 'scalar'
      v = Simulink.Parameter(3+4i);
    case 'row'
      v = Simulink.Parameter([1+2i 3+4i 5+6i]);
    case 'col'
      v = Simulink.Parameter([1+2i; 3+4i; 5+6i]);
    case 'mat'
      % Four distinct elements, so the column-major order (1+2i 5+6i 3+4i 7+8i)
      % differs from the row-major one.
      v = Simulink.Parameter([1+2i 3+4i; 5+6i 7+8i]);
    case 'negIm'
      v = Simulink.Parameter(1-2i);
    case 'zeroRe'
      v = Simulink.Parameter(complex(0, 5));
    case 'frac'
      v = Simulink.Parameter(1.5+0.25i);
    case 'single'
      % Exact in single, so the value reads back as typed. Simulink.Parameter sets
      % DataType to 'single' itself.
      v = Simulink.Parameter(single(2.5-0.5i));
    case 'int8'
      % Simulink.Parameter accepts a complex integer and sets DataType to 'int8'.
      v = Simulink.Parameter(int8(complex(3, -4)));
    case 'zeroIm'
      % Complex with a zero imaginary part: see the header.
      v = Simulink.Parameter(complex(1, 0));
    case 'nd'
      % Eight distinct elements, real and imaginary parts running opposite ways, so a
      % page or a part read out of place shows.
      v = Simulink.Parameter(complex(reshape(1:8, 2, 2, 2), reshape(8:-1:1, 2, 2, 2)));
    case 'nonFinite'
      % Each non-finite in each part, and a NaN imaginary part, which is the one a
      % sign rule has to decide: `NaN >= 0` is false.
      v = Simulink.Parameter([complex(Inf, -Inf) complex(NaN, 1) complex(1, NaN) complex(-Inf, 2)]);
    case 'int64'
      % A real part beyond flintmax: exact only as text.
      v = Simulink.Parameter(int64(complex(intmax('int64'), 1)));
    case 'struct'
      v = Simulink.Parameter(struct('a', 1+2i, 'b', [3+4i 5-6i]));
    case 'arr'
      v = [Simulink.Parameter(1+1i), Simulink.Parameter(2-2i)];
    case 'holder'
      v = ComplexHolder;
      v.Z = 3+4i;
      v.S = struct('f', 1-2i);
      v.C = {1+2i, [3+4i 5+6i]};
      v.Zm = [1+1i 2+2i; 3+3i 4+4i];
    case 'mpt'
      v = mpt.Parameter;
      v.Value = 6-7i;
    case 'lut'
      v = Simulink.LookupTable;
      v.Table.Value = [1+2i 3+4i 5+6i];
      v.Breakpoints(1).Value = [1 2 3];
    case 'z'
      v = 3+4i;
    case 'zRow'
      v = [1+2i 3+4i 5+6i];
    case 'sp'
      v = Simulink.Parameter(7+8i);
    case 'sv'
      v = Simulink.Parameter([1-1i 2-2i 3-3i]);
    case 'sz'
      v = 2+3i;
    case 'c1'
      v = Simulink.Parameter(9+10i);
    case 'c2'
      v = Simulink.Parameter([0.5+1.5i; 2.5-3.5i]);
    case 'cfgP'
      v = Simulink.Parameter(11-12i);
    otherwise
      error('make_complex_fixtures:build', 'no value for key %s', key);
  end
end

function tf = is_top_level(path)
  tf = isvarname(path);
end

function vars = add_top_levels(vars, M)
  % Every top-level row with a build key, then every twin.
  for i = 1:size(M, 1)
    if is_top_level(M{i, 1}) && ~isempty(M{i, 5})
      vars.(M{i, 1}) = build(M{i, 5});
    end
  end
  for i = 1:size(M, 1)
    if ~isempty(M{i, 4})
      vars.(M{i, 4}) = build(M{i, 5});
    end
  end
end

function vars = mat_vars()
  % The .mat's variables and the .sldd's entries, one fresh set per call.
  vars = struct();
  vars = add_top_levels(vars, mat_catalog());
  s = struct();
  s.p = build('sp');
  s.v = build('sv');
  s.z = build('sz');
  vars.s = s;
  % Assigned, not passed to struct(): struct('c', {...}) would make a struct ARRAY.
  vars.c = {build('c1'), build('c2')};
end

% ---------------------------------------------------------------------------
% The .mat
% ---------------------------------------------------------------------------

function [T, failures] = write_mat(here, failures)
  matPath = fullfile(here, 'complex_objects.mat');
  if isfile(matPath), delete(matPath); end

  vars = add_top_levels(mat_vars(), mat_only_catalog());
  % No version flag: the default, which is what a user's `save` writes. The header is
  % checked below, so a machine whose default is -v7.3 fails here rather than writing
  % an HDF5 file under a Level 5 name.
  save(matPath, '-struct', 'vars');
  clear vars

  fid = fopen(matPath, 'r');
  hdr = fread(fid, [1 116], 'char=>char');
  fclose(fid);
  want = 'MATLAB 5.0 MAT-file';
  if ~startsWith(hdr, want)
    failures{end + 1} = sprintf('complex_objects.mat header is "%s", expected "%s..."', ...
      strtrim(hdr(1:min(end, 40))), want);
  end
  failures = check_no_user(failures, matPath);
  fprintf('WROTE complex_objects.mat bytes=%d\n', dir(matPath).bytes);

  M = [mat_catalog(); mat_only_catalog()];
  L = load(matPath);
  [paths, twins, failures] = measure(M, L, failures);

  w = whos('-file', matPath);
  variables = arrayfun(@(e) struct('name', e.name, 'class', e.class, 'size', e.size, ...
    'complex', e.complex), w(:)', 'UniformOutput', false);

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.file = 'complex_objects.mat';
  T.header = hdr(1:numel(want));
  T.variables = variables;
  T.paths = paths;
  T.twins = twins;
  T.notes = struct('probes', {probe_classes()});
end

function P = probe_classes()
  % MATLAB's answer to "will this hold a complex value?", for the classes the header
  % names: 'ACCEPTED' with the stored value's isreal, or MATLAB's own error message.
  cases = {
    'Simulink.Parameter.Value (double)',    @() Simulink.Parameter(3+4i),                 @(o) o.Value
    'Simulink.Parameter.Value (single)',    @() Simulink.Parameter(single(1+2i)),         @(o) o.Value
    'Simulink.Parameter.Value (int8)',      @() Simulink.Parameter(int8(complex(1, 2))), @(o) o.Value
    'mpt.Parameter.Value',                  @() set_prop(mpt.Parameter, 'Value', 1+2i),   @(o) o.Value
    'Simulink.LookupTable.Table.Value',     @() set_lut_table(1+2i),                     @(o) o.Table.Value
    'Simulink.Parameter.Min',               @() set_prop(Simulink.Parameter, 'Min', 1+2i), @(o) o.Min
    'Simulink.Parameter.Max',               @() set_prop(Simulink.Parameter, 'Max', 1+2i), @(o) o.Max
    'Simulink.Signal.Min',                  @() set_prop(Simulink.Signal, 'Min', 1+2i),   @(o) o.Min
    'Simulink.Signal.Max',                  @() set_prop(Simulink.Signal, 'Max', 1+2i),   @(o) o.Max
    'Simulink.Breakpoint.Breakpoints.Value', @() set_bp(1+1i),                           @(o) o.Breakpoints.Value
    'Simulink.VariantControl.Value',        @() set_prop(Simulink.VariantControl, 'Value', 1+2i), @(o) o.Value
  };
  P = cell(1, size(cases, 1));
  for i = 1:size(cases, 1)
    r = struct('target', cases{i, 1});
    try
      o = cases{i, 2}();
      x = cases{i, 3}(o);
      r.answer = 'ACCEPTED';
      r.storedClass = class(x);
      r.storedIsreal = isreal(x);
    catch err
      r.answer = err.message;
    end
    P{i} = r;
  end
  % Recorded rather than probed: Simulink.Signal.InitialValue is a char expression, not
  % a number, so "complex" is not a question it can be asked.
  s = Simulink.Signal;
  P{end + 1} = struct('target', 'Simulink.Signal.InitialValue', ...
    'answer', sprintf('a property of class %s, not numeric', class(s.InitialValue)));
end

function o = set_prop(o, name, v)
  o.(name) = v;
end

function o = set_lut_table(v)
  o = Simulink.LookupTable;
  o.Table.Value = [v v];
  o.Breakpoints(1).Value = [1 2];
end

function o = set_bp(v)
  o = Simulink.Breakpoint;
  o.Breakpoints.Value = [v 2 3];
end

% ---------------------------------------------------------------------------
% The .slx
% ---------------------------------------------------------------------------

function [T, failures] = write_slx(here, failures)
  % The model is named for the file it is saved to: save_system to another name
  % renames the block diagram (gen_truth.m).
  mdl = 'complex_ws';
  slxPath = fullfile(here, [mdl '.slx']);
  if bdIsLoaded(mdl), close_system(mdl, 0); end
  if isfile(slxPath), delete(slxPath); end
  closer = onCleanup(@() close_if_loaded(mdl)); %#ok<NASGU>

  new_system(mdl);
  set_param(mdl, 'Creator', 'fixture', 'ModifiedByFormat', 'fixture');
  ws = get_param(mdl, 'ModelWorkspace');
  if ~strcmp(ws.DataSource, 'Model File')
    failures{end + 1} = sprintf('new model workspace DataSource is %s', ws.DataSource);
  end
  W = ws_catalog();
  vars = struct();
  vars = add_top_levels(vars, W);
  cfg = struct();
  cfg.p = build('cfgP');
  vars.cfg = cfg;
  names = fieldnames(vars);
  for i = 1:numel(names)
    assignin(ws, names{i}, vars.(names{i}));
  end
  save_system(mdl, slxPath);
  close_system(mdl, 0);
  clear cfg vars ws
  fprintf('WROTE %s.slx bytes=%d\n', mdl, dir(slxPath).bytes);

  [parts, failures] = zip_parts(slxPath, [mdl '.slx'], failures, getenv('USER'));
  fprintf('  part %s\n', parts{:});
  wsParts = parts(contains(parts, 'modelworkspace', 'IgnoreCase', true));
  if isempty(wsParts)
    failures{end + 1} = 'complex_ws.slx holds no model-workspace part';
  end

  load_system(slxPath);
  ws = get_param(mdl, 'ModelWorkspace');
  names = workspace_names(ws);
  V = struct();
  for i = 1:numel(names)
    V.(names{i}) = getVariable(ws, names{i});
  end
  [paths, twins, failures] = measure(W, V, failures);

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.file = [mdl '.slx'];
  T.model = mdl;
  T.dataSource = ws.DataSource;
  T.variables = names;
  T.workspaceParts = wsParts;
  T.parts = parts;
  T.paths = paths;
  T.twins = twins;
  close_system(mdl, 0);
end

function names = workspace_names(ws)
  % Sorted, so the truth does not depend on the order the workspace lists them in.
  try
    w = whos(ws);
    names = {w.name};
  catch
    names = evalin(ws, 'who');
  end
  names = sort(names(:)');
end

function [parts, failures] = zip_parts(zipPath, label, failures, user)
  % The package's member names, read by unzipping it into a scratch folder that is
  % removed again before this returns. Every part is searched for the account name
  % while it is unpacked.
  tmp = tempname;
  mkdir(tmp);
  cleanup = onCleanup(@() rmdir(tmp, 's')); %#ok<NASGU>
  files = unzip(zipPath, tmp);
  % By the scratch folder's own name rather than its whole path, which on macOS can come
  % back from unzip under /private.
  [~, tag] = fileparts(tmp);
  parts = sort(regexprep(strrep(files(:)', filesep, '/'), ['^.*/' tag '/'], ''));
  for k = 1:numel(files)
    if isfile(files{k})
      failures = check_no_user(failures, files{k}, ...
        sprintf('%s part %s', label, regexprep(strrep(files{k}, filesep, '/'), ['^.*/' tag '/'], '')), user);
    end
  end
end

function close_if_loaded(mdl)
  if bdIsLoaded(mdl), close_system(mdl, 0); end
end

% ---------------------------------------------------------------------------
% The .sldd
% ---------------------------------------------------------------------------

function [T, failures] = write_sldd(here, failures, ddName, format)
  % MATLAB keys open dictionaries by FILE NAME alone (gen_truth.m), so everything is
  % closed first, and the section handle is cleared before close() because holding it
  % counts as referencing the dictionary.
  ddPath = fullfile(here, ddName);
  Simulink.data.dictionary.closeAll('-discard');
  if isfile(ddPath), delete(ddPath); end

  oldUser = getenv('USER');
  setenv('USER', 'fixture');
  restoreUser = onCleanup(@() setenv('USER', oldUser));

  vars = mat_vars();
  dd = Simulink.data.dictionary.create(ddPath);
  ds = getSection(dd, 'Design Data');
  names = sort(fieldnames(vars))';
  for i = 1:numel(names)
    try
      addEntry(ds, names{i}, vars.(names{i}));
    catch err
      failures{end + 1} = sprintf('%s refused entry %s: %s', ddName, names{i}, err.message); %#ok<AGROW>
    end
  end
  % Before saveChanges, which is what decides the bytes (make_class_fixtures.m).
  dd.FileFormat = format;
  saveChanges(dd);
  clear ds vars
  close(dd);
  clear dd
  Simulink.data.dictionary.closeAll('-discard');
  clear restoreUser
  if ~strcmp(getenv('USER'), oldUser)
    failures{end + 1} = 'USER was not restored after the dictionary was written';
  end
  if strcmp(format, 'compressed-binary')
    % A zip: a search of its raw bytes cannot see inside a deflated part, so every
    % part is searched unpacked.
    [~, failures] = zip_parts(ddPath, ddName, failures, oldUser);
  else
    failures = check_no_user(failures, ddPath, ddName, oldUser);
  end
  fprintf('WROTE %s bytes=%d\n', ddName, dir(ddPath).bytes);

  dd = Simulink.data.dictionary.open(ddPath);
  fileFormat = dd.FileFormat;
  if ~strcmp(fileFormat, format)
    failures{end + 1} = sprintf('%s reopens as FileFormat %s, written as %s', ddName, fileFormat, format);
  end
  ds = getSection(dd, 'Design Data');
  es = find(ds);
  entries = sort({es.Name});
  modifiedBy = unique({es.LastModifiedBy});
  V = struct();
  for i = 1:numel(entries)
    V.(entries{i}) = getValue(getEntry(ds, entries{i}));
  end
  clear ds es
  close(dd);
  clear dd
  Simulink.data.dictionary.closeAll('-discard');

  [paths, twins, failures] = measure(mat_catalog(), V, failures);

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.file = ddName;
  T.fileFormat = fileFormat;
  T.section = 'Design Data';
  T.entries = entries;
  T.lastModifiedBy = modifiedBy;
  T.paths = paths;
  T.twins = twins;
end

% ---------------------------------------------------------------------------
% Measuring
% ---------------------------------------------------------------------------

function [paths, twins, failures] = measure(M, L, failures)
  paths = containers.Map('KeyType', 'char', 'ValueType', 'any');
  twins = {};
  for i = 1:size(M, 1)
    [path, getter, cls, twin, key] = M{i, 1:5};
    v = getter(L);
    paths(path) = truth_of(v);
    failures = check_class(failures, path, v, cls);
    failures = check_complex(failures, path, v, key);
    fprintf('  %-8s %-21s %s\n', path, class(v), mat2str(size(v)));
    if isempty(twin), continue, end
    w = L.(twin);
    paths(twin) = truth_of(w);
    failures = check_class(failures, twin, w, cls);
    failures = check_complex(failures, twin, w, key);
    r = twin_truth(path, v, twin, w);
    twins{end + 1} = r; %#ok<AGROW>
    if ~r.recordsEqual
      failures{end + 1} = sprintf('%s and its twin %s read back differently', path, twin); %#ok<AGROW>
    end
    if ~isequal(r.sameHandle, false)
      failures{end + 1} = sprintf('%s and its twin %s are one object', path, twin); %#ok<AGROW>
    end
  end
end

function failures = check_class(failures, path, v, cls)
  if ~strcmp(class(v), cls)
    failures{end + 1} = sprintf('%s reads back as %s, expected %s', path, class(v), cls);
  end
end

function failures = check_complex(failures, path, v, key)
  % Every non-container row's numbers were built complex, and must read back complex.
  if isempty(key), return, end
  if isa(v, 'Simulink.LookupTable')
    x = v.Table.Value;
  elseif isa(v, 'ComplexHolder')
    x = v.Z;
  elseif isstruct(v) || (isobject(v) && isstruct(v(1).Value))
    % A struct, or a Parameter whose Value is one: isreal answers false for any struct,
    % so the field that must be complex is asked instead.
    if isstruct(v), s = v; else, s = v(1).Value; end
    f = fieldnames(s);
    x = s.(f{1});
  elseif isobject(v)
    x = v.Value;
  else
    x = v;
  end
  if isreal(x)
    failures{end + 1} = sprintf('%s reads back REAL: %s', path, mat2str(x));
  end
end

function failures = check_no_user(failures, path, label, user)
  if nargin < 3, label = ''; end
  if nargin < 4, user = getenv('USER'); end
  if isempty(label)
    [~, name, ext] = fileparts(path);
    label = [name ext];
  end
  if isempty(user), return, end
  fid = fopen(path, 'r');
  bytes = fread(fid, Inf, 'uint8=>char')';
  fclose(fid);
  if contains(bytes, user)
    failures{end + 1} = sprintf('%s names the account that saved it', label);
  end
end

function r = twin_truth(path, a, twin, b)
  r = struct();
  r.nested = path;
  r.twin = twin;
  r.isHandle = isa(a, 'handle');
  r.isequal = isequal(a, b);
  r.isequaln = isequaln(a, b);
  % `==` on a handle is identity; on anything else there is no identity to compare.
  r.sameHandle = false;
  if r.isHandle
    try
      r.sameHandle = isequal(size(a), size(b)) && all(eq(a(:), b(:)));
    catch err
      r.sameHandle = err.message;
    end
  end
  r.recordsEqual = isequaln(truth_of(a), truth_of(b));
end

function t = truth_of(x)
  t = struct();
  t.class = class(x);
  t.size = size(x);
  t.numel = numel(x);
  t.isobject = isobject(x);
  t.isempty = isempty(x);
  % MATLAB's answer on x itself — false for every struct, cell and object. See the
  % header.
  t.isreal = isreal(x);
  % SuppressMarkup on every call, for the reasons gen_truth.m gives at t.disp.
  t.disp = strtrim(formattedDisplayText(x, 'SuppressMarkup', true));
  if isstruct(x)
    t.fields = fieldnames(x)';
  elseif iscell(x)
    t.elementClasses = cellfun(@class, x(:)', 'UniformOutput', false);
  elseif isobject(x) && ~isscalar(x)
    % gen_truth.m's reason for not reading properties off an array: `arr.Prop` on a
    % nonscalar Simulink data array silently yields element 1's value.
    t.elements = cell(1, numel(x));
    for k = 1:numel(x)
      t.elements{k} = truth_of(x(k));
    end
  elseif isobject(x)
    t = class_fields(t, x);
    t.properties = prop_truth(x);
  elseif isnumeric(x)
    v = value_truth(x);
    names = fieldnames(v);
    for k = 1:numel(names)
      t.(names{k}) = v.(names{k});
    end
  else
    try
      t.mat2str = mat2str(x);
    catch err
      t.mat2str_error = err.message;
    end
  end
end

function v = value_truth(x)
  % A numeric value, spelled out so that no complex number reaches jsonencode. See the
  % header.
  v = struct();
  v.class = class(x);
  v.size = size(x);
  v.numel = numel(x);
  v.isreal = isreal(x);
  v.disp = strtrim(formattedDisplayText(x, 'SuppressMarkup', true));
  try
    v.mat2str = mat2str(x);
    v.mat2strClass = mat2str(x, 'class');
  catch err
    v.mat2str_error = err.message;
  end
  % reshape, never x(:)': `'` is the CONJUGATE transpose, which negates every imaginary
  % part of a complex double and errors on a complex integer.
  lin = reshape(x, 1, []);
  % Cells, so that one element is still a JSON array.
  v.real = parts_of(real(lin));
  v.imag = parts_of(imag(lin));
  % Taken on lin(k), which MATLAB hands back REAL when its imaginary part is zero, so
  % elementIsreal is recorded beside the two spellings: see pZeroIm in the header.
  v.elementMat2str = cell(1, numel(lin));
  v.elementDisp = cell(1, numel(lin));
  v.elementIsreal = cell(1, numel(lin));
  for k = 1:numel(lin)
    e = lin(k);
    v.elementMat2str{k} = mat2str(e);
    v.elementDisp{k} = strtrim(formattedDisplayText(e, 'SuppressMarkup', true));
    v.elementIsreal{k} = isreal(e);
  end
end

function c = parts_of(p)
  % One JSON value per element: the number itself, or MATLAB's own text for it where a
  % JSON number cannot carry it — Inf, -Inf and NaN, for which jsonencode writes null,
  % and an integer-class part beyond flintmax, which double() would round.
  c = cell(1, numel(p));
  for k = 1:numel(p)
    e = p(k);
    if isinteger(e) && abs(double(e)) > flintmax
      c{k} = sprintf('%d', e);
    elseif isnan(e)
      c{k} = 'NaN';
    elseif isinf(e)
      if e > 0
        c{k} = 'Inf';
      else
        c{k} = '-Inf';
      end
    else
      c{k} = double(e);
    end
  end
end

function t = class_fields(t, x)
  names = {};
  if isa(x, 'Simulink.Parameter')
    % mpt.Parameter is a Simulink.Parameter, so it lands here too.
    names = {'Value', 'DataType', 'Min', 'Max', 'Unit', 'Description', 'Dimensions', 'Complexity'};
  elseif isa(x, 'Simulink.lookuptable.Table') || isa(x, 'Simulink.lookuptable.Breakpoint')
    names = {'Value', 'DataType', 'Min', 'Max', 'Unit', 'FieldName', 'Description'};
  elseif isa(x, 'ComplexHolder')
    names = {'Z', 'S', 'C', 'Zm'};
  elseif isa(x, 'Simulink.LookupTable')
    t.Table = truth_of(x.Table);
    bps = x.Breakpoints;
    t.Breakpoints = cell(1, numel(bps));
    for k = 1:numel(bps)
      t.Breakpoints{k} = truth_of(bps(k));
    end
  end
  % Value is always a field_truth record, so that a test reads one shape whatever the
  % value, and so is every property of a ComplexHolder; any other numeric field is
  % recorded raw, as make_nested_fixtures.m does, unless it is complex and jsonencode
  % would refuse it.
  for k = 1:numel(names)
    if isprop(x, names{k})
      val = x.(names{k});
      if strcmp(names{k}, 'Value') || isa(x, 'ComplexHolder') || (isnumeric(val) && ~isreal(val))
        t.(names{k}) = field_truth(val);
      else
        t.(names{k}) = val;
      end
    end
  end
end

function t = field_truth(val)
  % A property value whose numbers may be complex, in a form jsonencode takes: a number
  % through value_truth, a scalar struct field by field, a cell element by element.
  if isnumeric(val)
    t = value_truth(val);
  elseif isstruct(val) && isscalar(val)
    f = fieldnames(val)';
    t = struct('class', 'struct', 'fields', {f}, 'values', struct());
    for k = 1:numel(f)
      t.values.(f{k}) = field_truth(val.(f{k}));
    end
  elseif iscell(val)
    t = struct('class', 'cell', 'size', size(val));
    t.elements = cellfun(@field_truth, reshape(val, 1, []), 'UniformOutput', false);
  else
    t = val;
  end
end

function p = prop_truth(v)
  % gen_truth.m's propTruth, unchanged in what it records.
  p = struct();
  names = properties(v);
  for i = 1:numel(names)
    n = names{i};
    try
      val = v.(n);
      p.(n) = struct('class', class(val), 'size', size(val), ...
                     'numel', numel(val), 'isempty', isempty(val), ...
                     'disp', strtrim(formattedDisplayText(val, 'SuppressMarkup', true)));
      try
        p.(n).mat2str = mat2str(val);
      catch e2
        p.(n).mat2str_error = e2.message;
      end
    catch e
      p.(n) = struct('error', e.message);
    end
  end
end

function write_json(path, data)
  fid = fopen(path, 'w', 'n', 'UTF-8');
  fprintf(fid, '%s', jsonencode(data, 'PrettyPrint', true));
  fclose(fid);
  [~, name, ext] = fileparts(path);
  fprintf('WROTE %s%s bytes=%d\n', name, ext, dir(path).bytes);
end
