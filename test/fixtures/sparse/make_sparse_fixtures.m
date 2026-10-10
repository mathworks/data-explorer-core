function make_sparse_fixtures()
  % Copyright 2026 The MathWorks, Inc.
  % Authors the sparse-array fixtures: sparse arrays of every kind MATLAB makes (double
  % real and complex, logical, single, all-zero, 0x0, row, column, non-finite, a large
  % mostly-zero one and one whose declared size is far past any dense reading), each
  % beside a DENSE CONTROL of the same class and value, plus sparse arrays one level
  % down — a Simulink.Parameter's Value, a struct field, a cell element — in four
  % venues, and in the dictionaries one value written as hex for a reason other than
  % sparsity. Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_sparse_fixtures"
  %
  % (One line: a multi-line -batch argument silently runs nothing and exits 0. Verify by
  % the WROTE lines and the trailing MAKE_SPARSE_FIXTURES_DONE, not by the exit code; any
  % FAIL line above it means a fixture says something other than what this header
  % promises.)
  %
  % Writes eight files into this folder:
  %   sparse_values.mat               MATLAB's default `save` format — Level 5, not -v7.3
  %   sparse_values.truth.json        MATLAB's answers about it, read back with `load`
  %   sparse_ws.slx                   an empty model whose MODEL WORKSPACE (DataSource
  %                                   'Model File') holds the same variables; the part is
  %                                   simulink/modelWorkspace.mxarray, a MAT stream
  %   sparse_ws.truth.json            read back out of the workspace of the reopened model
  %   sparse_text.sldd                a data dictionary, FileFormat 'uncompressed-text'
  %   sparse_text_sldd.truth.json     read back out of the reopened dictionary
  %   sparse_binary.sldd              the same entries, FileFormat 'compressed-binary'
  %   sparse_binary_sldd.truth.json   as above, plus what MATLAB wrote for every entry
  % The classes in +dexsparse (beside this file) are needed to build the values and to
  % read the dictionaries back in MATLAB; nothing that only parses the files needs them.
  %
  % WHAT A BINARY DICTIONARY WRITES (R2027a, measured here and graded on every entry):
  %   * A value is written as
  %       <P Name="Value" Class="<class(value)>" Encoding="hex" EncodedLength="<n>">
  %     EXACTLY when it holds a sparse array or a function handle anywhere inside it
  %     (binary_encodings fails any entry for which that is not so). It is the WHOLE
  %     entry value that is hex, not the sparse part: a struct with one sparse field is
  %     Class="struct" hex, a cell with one sparse element Class="cell" hex, and a
  %     Simulink.Parameter whose Value is sparse is Class="Simulink.Parameter" hex — its
  %     DataType, Min, Max and every other property are inside the bytes.
  %   * The body is getByteStreamFromArray(value), byte for byte (graded), so it decodes
  %     with getArrayFromByteStream: an 8-byte preamble 00 01 49 4D 00 00 00 00 (version
  %     0x0100, 'IM', 4 reserved), then ONE miMATRIX element. Uppercase hex, starting on
  %     the line after the tag, 128 hex characters per line indented 16 spaces, the last
  %     line shorter and closed by </P> on the same line. EncodedLength is the BYTE count
  %     (graded), i.e. half the hex characters.
  %   * Class is class(value): 'double', 'logical' or 'single' for a sparse array, never
  %     'sparse' (graded). spDiag's bytes are those of sparse(1:10, 1:10, 1:10), the 10x10
  %     diagonal a real dictionary was found holding.
  %   * The flags byte of a sparse array's miMATRIX has 0x10 set, and the class code is
  %     NOT always 5: a double or logical sparse array has class code 5 (logical adds
  %     0x02, complex 0x08), but a SINGLE sparse array has class code 7 — mxSINGLE —
  %     with 0x10. A reader that recognises sparse by class code 5 alone reads a sparse
  %     single as dense, its row indices as the values. Recorded per entry as
  %     matClassCode, matFlags and matNzmax. (sparse_values.mat stores the same class
  %     codes and flags; that was read off the file outside this script, not graded.)
  %   * Every other value is XML as before: the dense controls, numAlias, pDense.
  % WHAT A TEXT DICTIONARY WRITES:
  %   * A sparse array is {"_type": "cdata", "_value": "..."}, the SAME
  %     getByteStreamFromArray bytes at six bits per character (CdataCodec.ts's rule;
  %     graded on every top-level cdata). In a struct, a cell or a Parameter only the
  %     sparse member is cdata; the container is the usual JSON. A dense complex array
  %     is cdata too (dComplex), as it already was.
  %   * EXCEPT sparse(0,0): written as the literal [] and read back as a DENSE 0x0
  %     double, issparse false. That is the one place a venue does not hand back the
  %     value built, so it is recorded in venueDifferences rather than failed (and it
  %     fails if it stops happening — expected_differences).
  %   * A function handle is {"_type": "function_handle", "_value": "sin"}: JSON, not
  %     cdata, so fhAlias is hex in one format only. A text dictionary writes only the
  %     properties away from the classdef default (make_class_fixtures.m), which is why
  %     fhAlias sets Fh.
  %
  % WHAT MATLAB CALLS A SPARSE ARRAY. class() answers the underlying class — double,
  % logical, single; complex is still double — and issparse() is the storage attribute.
  % whos -file says class 'double' with sparse true. MATLAB's own one-line summary,
  % recorded per value as fieldDisp (the value as a struct field) and cellDisp (as a
  % cell element), is `[10×10 double]` and `{10×10 double}` for spDiag: the summary
  % names the class, not the storage, and is the same as the dense control's.
  %
  % SIMULINK.PARAMETER AND SPARSE. A Simulink.Parameter accepts a sparse Value — double
  % (DataType 'auto'), logical ('boolean'), complex double (Complexity 'complex') and
  % single ('single') — and it stays sparse through every venue (graded: same_value
  % compares sparsity at every level, which isequaln does not). It refuses a struct
  % Value with a sparse field ("A valid structure must be numeric"). MATLAB's answers
  % are in sparse_values.truth.json's notes.parameterProbes.
  %
  % HEX FOR A REASON OTHER THAN SPARSITY. fhAlias is a dexsparse.FhAlias, a
  % Simulink.AliasType subclass with a function-handle property Fh (= @sin): the binary
  % dictionary writes it Class="dexsparse.FhAlias" Encoding="hex". numAlias, the same
  % base class with a numeric property instead, is its control and is XML. Design Data
  % REFUSES a bare function handle, a struct or cell holding one, a plain classdef
  % object, and an array of Simulink.Parameter or of dexsparse.NumAlias objects; Other
  % Data takes a plain classdef object holding a function handle and writes it hex as
  % well, and a sparse array there is hex as in Design Data. Those answers, with MATLAB's messages and
  % the tags it wrote, are in sparse_binary_sldd.truth.json's notes.probes. (A
  % Simulink.DataType subclass must live in a class directory inside a package, which is
  % why the classes are +dexsparse/@FhAlias and +dexsparse/@NumAlias.)
  %
  % SIZE. spBig is 1000x1000 with five non-zeros and spTall 10000000x2 with two; both
  % stay sparse in every file (a few dozen to 4 KB). No dense control is made for either.
  % The truth writes full() values only up to full_limit() elements; past it, the
  % non-zeros are the whole value and the record says so in fullOmitted.
  %
  % WHY THE TRUTH COMES FROM THE FILES. Every entry is measured on what `load`, a model
  % reopened with load_system and a dictionary reopened with
  % Simulink.data.dictionary.open hand back — never on the values built here — and each
  % read-back is then compared with the value built (class, size, issparse, isreal,
  % isequaln). A difference not in expected_differences is a FAIL.
  %
  % The truth files, all four:
  %   version, release   of the MATLAB that wrote them
  %   paths              one record per MATLAB path ('spDiag', 'st.sp', 'c{1}', ...),
  %                      containers included: class, size, numel, isobject, isempty,
  %                      issparse, isreal, disp. Then by kind:
  %                        numeric, logical  value_truth()'s fields, merged in
  %                        struct            fields
  %                        cell              elementClasses, elementIssparse
  %                        object            the class's fields below, and
  %                                          `properties` (gen_truth.m's propTruth)
  %                      Simulink.Parameter: Value (a field_truth record), DataType,
  %                      Min, Max, Unit, Description, Dimensions, Complexity.
  %                      dexsparse.FhAlias, .NumAlias: BaseType, Description,
  %                      DataScope, HeaderFile, and Fh ({class, func2str}) or K.
  %   value_truth        class, issparse, isreal, size, numel, nnz, nzmax (sparse
  %                      only), disp, fieldDisp, cellDisp, mat2str and mat2strClass
  %                      (mat2str(x, 'class')); real and imag, the full() values in
  %                      column-major order, one entry per element (absent past
  %                      full_limit(), with fullOmitted saying so); and nonzeros, {rows,
  %                      cols, real, imag} of find(x), 1-based, column-major — for a
  %                      dense value too, so a test reads one shape whatever the
  %                      storage. A logical's parts are 0 and 1. An entry of real or
  %                      imag is a plain number, or 'Inf', '-Inf', 'NaN' (jsonencode
  %                      would write null).
  %   venueDifferences   {path, what, built} per expected difference in this venue
  %   sparse_values.truth.json adds `variables` (`whos -file`: name, class, size,
  %   bytes, sparse, complex), `header` and notes.parameterProbes;
  %   sparse_ws.truth.json adds the model name, the DataSource, `variables`, `parts`,
  %   `workspaceParts` and `workspacePartHeads` (first 16 bytes, hex);
  %   the dictionaries' add the section, the sorted `entries`, the reopened
  %   FileFormat, the distinct LastModifiedBy, and `encodings`, one record per entry:
  %     binary   valueTag (the <P Name="Value" ...> tag as written), attributes,
  %              isHex, builtClass, containsSparse, containsFunctionHandle; for a hex
  %              value hexLineCount, hexLineLengths, hexStartsOnNewLine, hexIndent,
  %              hexUppercase, hexClosesOnDataLine, hexByteCount,
  %              encodedLengthIsByteCount, hexHead, matClassCode, matFlags, matNzmax,
  %              isGetByteStreamFromArray, and decodedClass/Issparse/Size/Isequaln
  %              (getArrayFromByteStream's answer)
  %     text     form ('object' or 'literal'), keys or literal, type (the _type), and
  %              cdata: every cdata anywhere inside the value, with `at` (its JSON
  %              path, '' for the value itself), chars, isMatStream, declaredBytes, the
  %              mat* flags, decodedClass/Issparse/Size, and for a top-level cdata
  %              isGetByteStreamFromArray
  %   sparse_binary_sldd.truth.json also has `hexEntries` (name, Class, EncodedLength,
  %   matClassCode, matFlags, containsSparse, containsFunctionHandle per hex entry) and
  %   notes.probes.
  %
  % NO ACCOUNT NAME IN ANY FILE. The model's Creator and ModifiedByFormat are set to a
  % fixed word, and USER is set to the same word while a dictionary is made (an entry's
  % modifiedby comes from it) and restored afterwards. Every file — every part of a zip
  % package, and the decoded bytes of every hex and cdata value, which a search of the
  % raw text cannot see into — is searched for the account name, this MATLAB's
  % matlabroot and any absolute path, and a hit is a FAIL.
  %
  % NO PATH IN ANY FILE: MATLAB writes its own matlabroot into every function handle it
  % serializes, so fhAlias's hex value in the binary dictionary carries the install path
  % of the MATLAB that wrote it. scrub_matlabroot replaces it with a token of the same
  % length before the file is graded and read back, and the grade compares the hex with
  % getByteStreamFromArray of the value scrubbed the same way.
  here = fileparts(mfilename('fullpath'));
  % The folder that holds +dexsparse, so its classes resolve when a value is built and
  % when a dictionary holding one is read back.
  addpath(here);
  failures = {};

  [matTruth, failures] = write_mat(here, failures);
  write_json(fullfile(here, 'sparse_values.truth.json'), matTruth);

  [wsTruth, failures] = write_slx(here, failures);
  write_json(fullfile(here, 'sparse_ws.truth.json'), wsTruth);

  [ddTruth, failures] = write_sldd(here, failures, 'sparse_text.sldd', 'uncompressed-text');
  write_json(fullfile(here, 'sparse_text_sldd.truth.json'), ddTruth);

  [binTruth, failures] = write_sldd(here, failures, 'sparse_binary.sldd', 'compressed-binary');
  write_json(fullfile(here, 'sparse_binary_sldd.truth.json'), binTruth);

  if isempty(failures)
    fprintf('MAKE_SPARSE_FIXTURES_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_SPARSE_FIXTURES_FAILED %d\n', numel(failures));
  end
end

% ---------------------------------------------------------------------------
% The catalogs. A row is {path, getter, expected class, build key}. A row whose
% path is a variable name and that has a build key is a top-level variable built
% by that key; a container row (no build key) is assembled by mat_vars, and its
% nested rows name the key their value is built by.
% ---------------------------------------------------------------------------

function M = mat_catalog()
  % The .mat's variables, the model workspace's, and the dictionaries' entries.
  M = {
    'spDiag',      @(L) L.spDiag,      'double',             'spDiag'
    'spComplex',   @(L) L.spComplex,   'double',             'spComplex'
    'spLogical',   @(L) L.spLogical,   'logical',            'spLogical'
    'spSingle',    @(L) L.spSingle,    'single',             'spSingle'
    'spAllZero',   @(L) L.spAllZero,   'double',             'spAllZero'
    'spEmpty',     @(L) L.spEmpty,     'double',             'spEmpty'
    'spRow',       @(L) L.spRow,       'double',             'spRow'
    'spCol',       @(L) L.spCol,       'double',             'spCol'
    'spNonFinite', @(L) L.spNonFinite, 'double',             'spNonFinite'
    'spBig',       @(L) L.spBig,       'double',             'spBig'
    'spTall',      @(L) L.spTall,      'double',             'spTall'
    'dDiag',       @(L) L.dDiag,       'double',             'dDiag'
    'dComplex',    @(L) L.dComplex,    'double',             'dComplex'
    'dLogical',    @(L) L.dLogical,    'logical',            'dLogical'
    'dSingle',     @(L) L.dSingle,     'single',             'dSingle'
    'dAllZero',    @(L) L.dAllZero,    'double',             'dAllZero'
    'dEmpty',      @(L) L.dEmpty,      'double',             'dEmpty'
    'dRow',        @(L) L.dRow,        'double',             'dRow'
    'dCol',        @(L) L.dCol,        'double',             'dCol'
    'dNonFinite',  @(L) L.dNonFinite,  'double',             'dNonFinite'
    'pSp',         @(L) L.pSp,         'Simulink.Parameter', 'pSp'
    'pSpLogical',  @(L) L.pSpLogical,  'Simulink.Parameter', 'pSpLogical'
    'pSpComplex',  @(L) L.pSpComplex,  'Simulink.Parameter', 'pSpComplex'
    'pDense',      @(L) L.pDense,      'Simulink.Parameter', 'pDense'
    'st',          @(L) L.st,          'struct',             ''
    'st.sp',       @(L) L.st.sp,       'double',             'stSp'
    'st.d',        @(L) L.st.d,        'double',             'stD'
    'c',           @(L) L.c,           'cell',               ''
    'c{1}',        @(L) L.c{1},        'double',             'c1'
    'c{2}',        @(L) L.c{2},        'double',             'c2'
  };
end

function M = dd_only_catalog()
  % Rows the dictionaries hold and the .mat and the model workspace do not: values a
  % binary dictionary writes as hex for a reason other than sparsity, and their
  % control. See the header.
  M = {
    'fhAlias',     @(L) L.fhAlias,     'dexsparse.FhAlias',  'fhAlias'
    'numAlias',    @(L) L.numAlias,    'dexsparse.NumAlias', 'numAlias'
  };
end

function v = build(key)
  % One value per key, a fresh one on every call.
  switch key
    case 'spDiag'
      % 10x10, 1..10 on the diagonal.
      v = sparse(1:10, 1:10, 1:10);
    case 'spComplex'
      % 3x4. One non-zero with a zero imaginary part (0.5) and one with a zero real part
      % (-3i): the array is complex, those two elements are not.
      v = sparse([1 3 2 1], [1 1 3 4], [1+2i, 0.5, -3i, 4-0.25i], 3, 4);
    case 'spLogical'
      v = sparse(logical([1 0 0; 0 0 1]));
    case 'spSingle'
      % Sparse single: exact in single.
      v = sparse(single([0 1.5; 2.5 0; 0 -4]));
    case 'spAllZero'
      v = sparse(3, 4);
    case 'spEmpty'
      v = sparse(0, 0);
    case 'spRow'
      v = sparse([0 2 0 4 0]);
    case 'spCol'
      v = sparse([0; 3; 0; 0; 5]);
    case 'spNonFinite'
      % A NaN is a non-zero to a sparse array, so it is stored.
      v = sparse([1 2 2], [1 1 2], [Inf -Inf NaN], 2, 2);
    case 'spBig'
      % 1000x1000, five non-zeros. (2,999) is 2 and (999,2) is 4, so a reader that
      % swapped rows and columns shows.
      v = sparse([1 2 500 999 1000], [1 999 500 2 1000], [1 2 3 4 5], 1000, 1000);
    case 'spTall'
      % 10000000x2 with two non-zeros: a declared size of 2e7 elements in a few
      % dozen bytes.
      v = sparse([1 9999999], [1 2], [7 8], 10000000, 2);
    case 'dDiag'
      v = full(build('spDiag'));
    case 'dComplex'
      v = full(build('spComplex'));
    case 'dLogical'
      v = full(build('spLogical'));
    case 'dSingle'
      v = full(build('spSingle'));
    case 'dAllZero'
      v = zeros(3, 4);
    case 'dEmpty'
      v = zeros(0, 0);
    case 'dRow'
      v = full(build('spRow'));
    case 'dCol'
      v = full(build('spCol'));
    case 'dNonFinite'
      v = full(build('spNonFinite'));
    case 'pSp'
      v = Simulink.Parameter(sparse([1 3], [2 1], [5 6], 3, 3));
    case 'pSpLogical'
      v = Simulink.Parameter(sparse(logical([0 1; 1 0])));
    case 'pSpComplex'
      v = Simulink.Parameter(sparse([1 2], [2 1], [1+1i 2-2i], 2, 2));
    case 'pDense'
      v = Simulink.Parameter(full(sparse([1 3], [2 1], [5 6], 3, 3)));
    case 'stSp'
      v = sparse([0 7; 8 0]);
    case 'stD'
      v = [7 8];
    case 'c1'
      v = sparse([0 0 9]);
    case 'c2'
      v = [9 10];
    case 'fhAlias'
      % Fh set away from the classdef default, so that a text dictionary, which writes
      % only non-default properties, has to spell it.
      v = dexsparse.FhAlias;
      v.Fh = @sin;
    case 'numAlias'
      v = dexsparse.NumAlias;
    otherwise
      error('make_sparse_fixtures:build', 'no value for key %s', key);
  end
end

function vars = add_top_levels(vars, M)
  for i = 1:size(M, 1)
    if isvarname(M{i, 1}) && ~isempty(M{i, 4})
      vars.(M{i, 1}) = build(M{i, 4});
    end
  end
end

function vars = mat_vars()
  vars = struct();
  vars = add_top_levels(vars, mat_catalog());
  st = struct();
  st.sp = build('stSp');
  st.d = build('stD');
  vars.st = st;
  % Assigned, not passed to struct(): struct('c', {...}) would make a struct ARRAY.
  vars.c = {build('c1'), build('c2')};
end

function vars = dd_vars()
  vars = add_top_levels(mat_vars(), dd_only_catalog());
end

function x = built_value(path)
  % The value a path was built as, from a fresh set: what a read-back is compared to.
  persistent B
  if isempty(B), B = dd_vars(); end
  x = getfield_path(B, path);
end

function x = getfield_path(B, path)
  M = [mat_catalog(); dd_only_catalog()];
  row = find(strcmp(M(:, 1), path), 1);
  x = M{row, 2}(B);
end

% ---------------------------------------------------------------------------
% The .mat
% ---------------------------------------------------------------------------

function [T, failures] = write_mat(here, failures)
  matPath = fullfile(here, 'sparse_values.mat');
  if isfile(matPath), delete(matPath); end

  vars = mat_vars();
  % No version flag: the default, which is what a user's `save` writes.
  save(matPath, '-struct', 'vars');
  clear vars

  fid = fopen(matPath, 'r');
  hdr = fread(fid, [1 116], 'char=>char');
  fclose(fid);
  want = 'MATLAB 5.0 MAT-file';
  if ~startsWith(hdr, want)
    failures{end + 1} = sprintf('sparse_values.mat header is "%s", expected "%s..."', ...
      strtrim(hdr(1:min(end, 40))), want);
  end
  failures = check_no_user(failures, matPath);
  fprintf('WROTE sparse_values.mat bytes=%d\n', dir(matPath).bytes);

  L = load(matPath);
  [paths, failures] = measure(mat_catalog(), L, failures, 'mat');

  w = whos('-file', matPath);
  variables = arrayfun(@(e) struct('name', e.name, 'class', e.class, 'size', e.size, ...
    'bytes', e.bytes, 'sparse', e.sparse, 'complex', e.complex), w(:)', 'UniformOutput', false);

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.file = 'sparse_values.mat';
  T.header = hdr(1:numel(want));
  T.variables = variables;
  T.paths = paths;
  T.venueDifferences = venue_differences('mat');
  T.notes = struct('parameterProbes', {parameter_probes()});
end

function P = parameter_probes()
  % MATLAB's answer to "will a Simulink.Parameter hold a sparse Value?": 'ACCEPTED' with
  % what it stored, or MATLAB's own error message.
  cases = {
    'Simulink.Parameter(sparse double)',          @() Simulink.Parameter(sparse([1 0; 0 2]))
    'Simulink.Parameter(sparse logical)',         @() Simulink.Parameter(sparse(logical([1 0; 0 1])))
    'Simulink.Parameter(sparse complex double)',  @() Simulink.Parameter(sparse([1+1i 0; 0 2]))
    'Simulink.Parameter(sparse single)',          @() Simulink.Parameter(sparse(single([1 0; 0 2])))
    'Simulink.Parameter, Value set to sparse',    @() set_prop(Simulink.Parameter, 'Value', sparse([1 0; 0 2]))
    'Simulink.Parameter(struct with a sparse field)', @() Simulink.Parameter(struct('a', sparse([1 0; 0 2])))
    'mpt.Parameter, Value set to sparse',         @() set_prop(mpt.Parameter, 'Value', sparse([1 0; 0 2]))
  };
  P = cell(1, size(cases, 1));
  for i = 1:size(cases, 1)
    r = struct('target', cases{i, 1});
    try
      o = cases{i, 2}();
      x = o.Value;
      r.answer = 'ACCEPTED';
      r.storedClass = class(x);
      r.storedIssparse = issparse(x);
      r.storedIsreal = isreal(x);
      r.DataType = o.DataType;
      r.Complexity = o.Complexity;
      r.Dimensions = o.Dimensions;
    catch err
      r.answer = err.message;
    end
    P{i} = r;
  end
end

function o = set_prop(o, name, v)
  o.(name) = v;
end

% ---------------------------------------------------------------------------
% The .slx
% ---------------------------------------------------------------------------

function [T, failures] = write_slx(here, failures)
  mdl = 'sparse_ws';
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
  vars = mat_vars();
  names = fieldnames(vars);
  for i = 1:numel(names)
    assignin(ws, names{i}, vars.(names{i}));
  end
  save_system(mdl, slxPath);
  close_system(mdl, 0);
  clear vars ws
  fprintf('WROTE %s.slx bytes=%d\n', mdl, dir(slxPath).bytes);

  [parts, failures, heads] = zip_parts(slxPath, [mdl '.slx'], failures, getenv('USER'));
  fprintf('  part %s\n', parts{:});
  wsParts = parts(contains(parts, 'modelworkspace', 'IgnoreCase', true));
  if isempty(wsParts)
    failures{end + 1} = 'sparse_ws.slx holds no model-workspace part';
  end

  load_system(slxPath);
  ws = get_param(mdl, 'ModelWorkspace');
  names = workspace_names(ws);
  V = struct();
  for i = 1:numel(names)
    V.(names{i}) = getVariable(ws, names{i});
  end
  [paths, failures] = measure(mat_catalog(), V, failures, 'slx');

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.file = [mdl '.slx'];
  T.model = mdl;
  T.dataSource = ws.DataSource;
  T.variables = names;
  T.workspaceParts = wsParts;
  T.workspacePartHeads = heads(contains(parts, 'modelworkspace', 'IgnoreCase', true));
  T.parts = parts;
  T.paths = paths;
  T.venueDifferences = venue_differences('slx');
  close_system(mdl, 0);
end

function names = workspace_names(ws)
  try
    w = whos(ws);
    names = {w.name};
  catch
    names = evalin(ws, 'who');
  end
  names = sort(names(:)');
end

function close_if_loaded(mdl)
  if bdIsLoaded(mdl), close_system(mdl, 0); end
end

function [parts, failures, heads, files_text] = zip_parts(zipPath, label, failures, user)
  % The package's member names, read by unzipping it into a scratch folder that is
  % removed again before this returns. Every part is searched for the account name
  % while it is unpacked. heads{k} is the first 16 bytes of part k, as hex; files_text
  % is the concatenated text of the data/ parts (a binary dictionary's XML).
  tmp = tempname;
  mkdir(tmp);
  cleanup = onCleanup(@() rmdir(tmp, 's')); %#ok<NASGU>
  files = unzip(zipPath, tmp);
  [~, tag] = fileparts(tmp);
  rel = regexprep(strrep(files(:)', filesep, '/'), ['^.*/' tag '/'], '');
  [parts, order] = sort(rel);
  files = files(order);
  heads = cell(1, numel(files));
  files_text = '';
  for k = 1:numel(files)
    if isfile(files{k})
      failures = check_no_user(failures, files{k}, sprintf('%s part %s', label, parts{k}), user);
      fid = fopen(files{k}, 'r');
      b = fread(fid, [1 16], 'uint8=>uint8');
      fclose(fid);
      heads{k} = sprintf('%02X', b);
      if startsWith(parts{k}, 'data/') && endsWith(parts{k}, '.xml')
        files_text = [files_text fileread(files{k})]; %#ok<AGROW>
      end
    end
  end
end

% ---------------------------------------------------------------------------
% The .sldd
% ---------------------------------------------------------------------------

function [T, failures] = write_sldd(here, failures, ddName, format)
  % MATLAB keys open dictionaries by FILE NAME alone, so everything is closed first, and
  % the section handle is cleared before close() because holding it counts as
  % referencing the dictionary.
  ddPath = fullfile(here, ddName);
  Simulink.data.dictionary.closeAll('-discard');
  if isfile(ddPath), delete(ddPath); end

  oldUser = getenv('USER');
  setenv('USER', 'fixture');
  restoreUser = onCleanup(@() setenv('USER', oldUser));

  vars = dd_vars();
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
  dd.FileFormat = format;
  saveChanges(dd);
  clear ds
  close(dd);
  clear dd
  Simulink.data.dictionary.closeAll('-discard');
  clear restoreUser
  if ~strcmp(getenv('USER'), oldUser)
    failures{end + 1} = 'USER was not restored after the dictionary was written';
  end
  if strcmp(format, 'compressed-binary')
    scrub_matlabroot(ddPath);
  end

  if strcmp(format, 'compressed-binary')
    [parts, failures, ~, xml] = zip_parts(ddPath, ddName, failures, oldUser);
    [encodings, failures] = binary_encodings(xml, vars, ddName, failures, oldUser);
  else
    parts = {};
    failures = check_no_user(failures, ddPath, ddName, oldUser);
    [encodings, failures] = text_encodings(ddPath, vars, ddName, failures, oldUser);
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

  [paths, failures] = measure([mat_catalog(); dd_only_catalog()], V, failures, format);

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.file = ddName;
  T.fileFormat = fileFormat;
  T.section = 'Design Data';
  T.entries = entries;
  T.lastModifiedBy = modifiedBy;
  if ~isempty(parts), T.parts = parts; end
  T.encodings = encodings;
  if strcmp(format, 'compressed-binary')
    T.hexEntries = hex_summary(encodings);
    T.notes = struct('probes', {section_probes()});
  end
  T.paths = paths;
  T.venueDifferences = venue_differences(format);
end

function [E, failures] = binary_encodings(xml, vars, ddName, failures, user)
  % One record per DD.ENTRY: the attributes of its Value <P>, and for a hex value what
  % its bytes are. An entry's Value is the FIRST <P Name="Value"> after its Name: the
  % metadata properties (UUID, Namespace, LastMod, LastModBy, IsDerived) come between,
  % and a nested Value belongs to an object inside it.
  E = containers.Map('KeyType', 'char', 'ValueType', 'any');
  starts = strfind(xml, '<Object Class="DD.ENTRY">');
  ends = [starts(2:end) - 1, numel(xml)];
  for k = 1:numel(starts)
    chunk = xml(starts(k):ends(k));
    name = regexp(chunk, '<P Name="Name" Class="char">([^<]*)</P>', 'tokens', 'once');
    name = name{1};
    [tagStart, tagEnd, tok] = regexp(chunk, '<P Name="Value"([^>]*)>', 'start', 'end', 'tokens', 'once');
    r = struct();
    r.name = name;
    r.valueTag = chunk(tagStart:tagEnd);
    r.attributes = attributes_of(tok{1});
    r.isHex = isfield(r.attributes, 'Encoding') && strcmp(r.attributes.Encoding, 'hex');
    x = vars.(name);
    r.builtClass = class(x);
    r.containsSparse = contains_kind(x, @(v) (isnumeric(v) || islogical(v)) && issparse(v), 0);
    r.containsFunctionHandle = contains_kind(x, @(v) isa(v, 'function_handle'), 0);
    if r.isHex
      body = chunk(tagEnd + 1:end);
      close = strfind(body, '</P>');
      body = body(1:close(1) - 1);
      lines = regexp(body, '\r?\n', 'split');
      trimmed = strtrim(lines);
      data = trimmed(~cellfun(@isempty, trimmed));
      hex = [data{:}];
      r.hexLineCount = numel(data);
      r.hexLineLengths = num2cell(unique(cellfun(@numel, data)));
      r.hexStartsOnNewLine = isempty(strtrim(lines{1}));
      leading = regexp(lines{find(~cellfun(@isempty, trimmed), 1)}, '^\s*', 'match', 'once');
      r.hexIndent = numel(leading);
      r.hexUppercase = strcmp(hex, upper(hex));
      r.hexClosesOnDataLine = ~isempty(strtrim(lines{end}));
      bytes = uint8(hex2dec(reshape(hex, 2, [])'))';
      r.hexByteCount = numel(bytes);
      r.encodedLengthIsByteCount = isfield(r.attributes, 'EncodedLength') && ...
        str2double(r.attributes.EncodedLength) == numel(bytes);
      r.hexHead = hex(1:min(end, 32));
      r = mat_flags(r, bytes);
      ref = scrub_matlabroot(getByteStreamFromArray(x));
      r.isGetByteStreamFromArray = isequal(bytes, ref);
      try
        y = getArrayFromByteStream(bytes);
        r.decodedClass = class(y);
        r.decodedIssparse = issparse(y);
        r.decodedSize = size(y);
        r.decodedIsequaln = isequaln(y, x);
      catch err
        r.decodeError = err.message;
      end
      if ~isempty(user) && contains(char(bytes), user)
        failures{end + 1} = sprintf('%s entry %s: the hex value names the account that saved it', ddName, name); %#ok<AGROW>
      end
      failures = check_no_path(failures, char(bytes), sprintf('%s entry %s hex', ddName, name));
      if ~r.isGetByteStreamFromArray
        failures{end + 1} = sprintf('%s entry %s: the hex bytes are not getByteStreamFromArray of the value', ddName, name); %#ok<AGROW>
      end
      if ~r.encodedLengthIsByteCount
        failures{end + 1} = sprintf('%s entry %s: EncodedLength is not the byte count', ddName, name); %#ok<AGROW>
      end
      if ~strcmp(r.attributes.Class, class(x))
        failures{end + 1} = sprintf('%s entry %s: hex Class="%s", the value is %s', ddName, name, r.attributes.Class, class(x)); %#ok<AGROW>
      end
    end
    % The rule the header states: a value is hex exactly when it holds a sparse array or
    % a function handle somewhere inside it.
    if r.isHex ~= (r.containsSparse || r.containsFunctionHandle)
      failures{end + 1} = sprintf('%s entry %s: isHex=%d but containsSparse=%d containsFunctionHandle=%d', ...
        ddName, name, r.isHex, r.containsSparse, r.containsFunctionHandle); %#ok<AGROW>
    end
    fprintf('  ENC %-12s %s\n', name, r.valueTag);
    E(name) = r;
  end
end

function r = mat_flags(r, bytes)
  % The top-level miMATRIX's array flags, read off the stream's own bytes: after the
  % 8-byte preamble and the 8-byte miMATRIX tag comes an miUINT32 sub-element of 8
  % bytes whose first byte is the class code and second the flags byte, then nzmax.
  if numel(bytes) >= 32 && isequal(bytes(17:24), uint8([6 0 0 0 8 0 0 0]))
    r.matClassCode = double(bytes(25));
    r.matFlags = sprintf('0x%02X', bytes(26));
    r.matNzmax = double(typecast(bytes(29:32), 'uint32'));
  end
end

function H = hex_summary(E)
  names = sort(keys(E));
  H = {};
  for k = 1:numel(names)
    r = E(names{k});
    if r.isHex
      H{end + 1} = struct('name', r.name, 'Class', r.attributes.Class, ...
        'EncodedLength', str2double(r.attributes.EncodedLength), ...
        'matClassCode', r.matClassCode, 'matFlags', r.matFlags, ...
        'containsSparse', r.containsSparse, ...
        'containsFunctionHandle', r.containsFunctionHandle); %#ok<AGROW>
    end
  end
end

function a = attributes_of(text)
  a = struct();
  toks = regexp(text, '(\w+)="([^"]*)"', 'tokens');
  for k = 1:numel(toks)
    a.(toks{k}{1}) = toks{k}{2};
  end
end

function [E, failures] = text_encodings(ddPath, vars, ddName, failures, user)
  % One record per entry: the form its "value" takes in the JSON, and every cdata
  % anywhere inside it with what its characters decode to.
  J = jsondecode(fileread(ddPath));
  partsField = pick_field(J, 'PARTS');
  P = J.(partsField);
  chunkField = pick_field(P, 'chunk');
  C = P.(chunkField);
  content = C.(pick_field(C, 'content'));
  entries = content.entries;
  if isstruct(entries), entries = num2cell(entries); end
  E = containers.Map('KeyType', 'char', 'ValueType', 'any');
  for k = 1:numel(entries)
    e = entries{k};
    name = e.name;
    val = e.value;
    r = struct();
    r.name = name;
    if isstruct(val)
      r.form = 'object';
      r.keys = cellfun(@json_key, fieldnames(val)', 'UniformOutput', false);
      if isfield(val, 'x_type'), r.type = val.x_type; end
    else
      r.form = 'literal';
      r.literalClass = class(val);
      r.literal = jsonencode(val);
    end
    found = {};
    found = find_cdata(val, '', found);
    r.cdata = cell(1, numel(found));
    for j = 1:numel(found)
      [where, chars] = found{j}{:};
      c = struct('at', where, 'chars', numel(chars));
      bytes = uudecode(chars);
      c.isMatStream = numel(bytes) >= 4 && isequal(bytes(1:4), uint8([0 1 73 77]));
      if c.isMatStream && numel(bytes) >= 16
        n = 16 + double(typecast(bytes(13:16), 'uint32'));
        c.declaredBytes = n;
        bytes = bytes(1:min(end, n));
        c = mat_flags(c, bytes);
        try
          y = getArrayFromByteStream(bytes);
          c.decodedClass = class(y);
          c.decodedIssparse = issparse(y);
          c.decodedSize = size(y);
        catch err
          c.decodeError = err.message;
        end
        if isempty(where)
          c.isGetByteStreamFromArray = isequal(bytes, getByteStreamFromArray(vars.(name)));
        end
      end
      if ~isempty(user) && contains(char(bytes), user)
        failures{end + 1} = sprintf('%s entry %s: a cdata value names the account that saved it', ddName, name); %#ok<AGROW>
      end
      failures = check_no_path(failures, char(bytes), sprintf('%s entry %s cdata', ddName, name));
      r.cdata{j} = c;
    end
    if isfield(r, 'type')
      fprintf('  ENC %-12s %s _type=%s cdata=%d\n', name, r.form, r.type, numel(found));
    else
      fprintf('  ENC %-12s %s cdata=%d\n', name, r.form, numel(found));
    end
    E(name) = r;
  end
end

function f = pick_field(S, needle)
  names = fieldnames(S);
  f = names{find(contains(names, needle), 1)};
end

function k = json_key(f)
  % jsondecode's field name back to the JSON key: makeValidName prefixes 'x' to a key
  % that starts with an underscore.
  if startsWith(f, 'x_'), k = f(2:end); else, k = f; end
end

function found = find_cdata(v, where, found)
  if isstruct(v) && isscalar(v)
    if isfield(v, 'x_type') && strcmp(v.x_type, 'cdata') && isfield(v, 'x_value')
      found{end + 1} = {where, v.x_value};
      return
    end
    f = fieldnames(v);
    for k = 1:numel(f)
      found = find_cdata(v.(f{k}), [where '.' json_key(f{k})], found);
    end
  elseif isstruct(v)
    for k = 1:numel(v)
      found = find_cdata(v(k), sprintf('%s[%d]', where, k - 1), found);
    end
  elseif iscell(v)
    for k = 1:numel(v)
      found = find_cdata(v{k}, sprintf('%s[%d]', where, k - 1), found);
    end
  end
end

function bytes = uudecode(chars)
  % CdataCodec.ts's rule: six bits per character, most significant first, offset by
  % 0x20; MATLAB's trailing NUL padding is dropped first, and a partial byte at the end
  % is discarded.
  chars = chars(chars ~= char(0));
  v = double(chars) - 32;
  bits = reshape(dec2bin(v, 6)' - '0', 1, []);
  n = floor(numel(bits) / 8);
  bits = reshape(bits(1:n * 8), 8, n)';
  bytes = uint8(bits * (2 .^ (7:-1:0))')';
end

function D = expected_differences()
  % {venue, path, what}: a read-back that is NOT the value built, by MATLAB's own doing,
  % recorded rather than failed. Each must happen: one that does not is a FAIL too, so
  % this list is exactly the set observed.
  D = {
    'uncompressed-text', 'spEmpty', 'issparse'
  };
end

function V = venue_differences(venue)
  D = expected_differences();
  V = {};
  for k = 1:size(D, 1)
    if strcmp(D{k, 1}, venue)
      V{end + 1} = struct('path', D{k, 2}, 'what', D{k, 3}, ...
        'built', describe(built_value(D{k, 2}))); %#ok<AGROW>
    end
  end
end

function s = describe(x)
  s = sprintf('%s %s issparse=%d', class(x), mat2str(size(x)), issparse(x));
end

function P = section_probes()
  % What a binary dictionary does with values outside the catalog: refused (MATLAB's
  % message) or written (the Value tag MATLAB wrote), one throwaway dictionary per
  % section, in tempdir, removed again.
  cases = {
    'function_handle',                        'Design Data', @() @sin
    'struct with a function_handle field',    'Design Data', @() struct('f', @sin)
    'cell holding a function_handle',         'Design Data', @() {@sin}
    'Simulink.Parameter array',               'Design Data', @() [Simulink.Parameter(1) Simulink.Parameter(2)]
    'dexsparse.NumAlias array',               'Design Data', @() [dexsparse.NumAlias dexsparse.NumAlias]
    'struct holding a Simulink.Parameter array', 'Design Data', @() struct('p', [Simulink.Parameter(1) Simulink.Parameter(2)])
    'dexsparse.FhHolder (plain class with a function handle)', 'Design Data', @() dexsparse.FhHolder
    'dexsparse.FhHolder (plain class with a function handle)', 'Other Data',  @() dexsparse.FhHolder
    'sparse double',                          'Other Data',  @() sparse([1 0; 0 2])
  };
  P = cell(1, size(cases, 1));
  sections = unique(cases(:, 2));
  oldUser = getenv('USER');
  setenv('USER', 'fixture');
  restoreUser = onCleanup(@() setenv('USER', oldUser)); %#ok<NASGU>
  for s = 1:numel(sections)
    probe = [tempname '_probe.sldd'];
    Simulink.data.dictionary.closeAll('-discard');
    dd = Simulink.data.dictionary.create(probe);
    ds = getSection(dd, sections{s});
    added = {};
    for i = find(strcmp(cases(:, 2), sections{s}))'
      r = struct('target', cases{i, 1}, 'section', sections{s});
      entry = sprintf('probe%d', i);
      try
        addEntry(ds, entry, cases{i, 3}());
        r.answer = 'ACCEPTED';
        added{end + 1} = {i, entry}; %#ok<AGROW>
      catch err
        r.answer = err.message;
      end
      P{i} = r;
    end
    dd.FileFormat = 'compressed-binary';
    saveChanges(dd);
    clear ds
    close(dd);
    clear dd
    Simulink.data.dictionary.closeAll('-discard');
    [~, ~, ~, xml] = zip_parts(probe, 'probe', {}, '');
    delete(probe);
    for a = 1:numel(added)
      [i, entry] = added{a}{:};
      m = regexp(xml, ['<Object Class="DD.ENTRY">\s*<P Name="Name" Class="char">' entry '</P>.*?(<P Name="Value"[^>]*>)'], 'tokens', 'once');
      P{i}.valueTag = m{1};
    end
  end
end

% ---------------------------------------------------------------------------
% Measuring
% ---------------------------------------------------------------------------

function [paths, failures] = measure(M, L, failures, venue)
  paths = containers.Map('KeyType', 'char', 'ValueType', 'any');
  D = expected_differences();
  for i = 1:size(M, 1)
    [path, getter, cls] = M{i, 1:3};
    y = getter(L);
    paths(path) = truth_of(y);
    if ~strcmp(class(y), cls)
      failures{end + 1} = sprintf('%s %s reads back as %s, expected %s', venue, path, class(y), cls); %#ok<AGROW>
    end
    x = built_value(path);
    expect = D(strcmp(D(:, 1), venue) & strcmp(D(:, 2), path), 3);
    [same, why] = same_value(x, y);
    if same && ~isempty(expect)
      failures{end + 1} = sprintf('%s %s was expected to differ (%s) and did not', venue, path, strjoin(expect, ', ')); %#ok<AGROW>
    elseif ~same && ~isequal(sort(why), sort(expect(:)'))
      failures{end + 1} = sprintf('%s %s reads back different from the value built: %s', venue, path, strjoin(why, ', ')); %#ok<AGROW>
    end
    fprintf('  %-6s %-12s %-20s %-12s sparse=%d\n', venue, path, class(y), mat2str(size(y)), issparse_any(y));
  end
end

function tf = issparse_any(y)
  tf = (isnumeric(y) || islogical(y)) && issparse(y);
end

function [same, why] = same_value(x, y)
  why = {};
  if ~strcmp(class(x), class(y)), why{end + 1} = 'class'; end
  if ~isequal(size(x), size(y)), why{end + 1} = 'size'; end
  % isequaln does not see storage — isequaln(sparse(1), 1) is true — so sparsity is
  % compared on its own, at every level: a Parameter's Value, a field, an element.
  if ~strcmp(sparse_profile(x, 0), sparse_profile(y, 0)), why{end + 1} = 'issparse'; end
  if (isnumeric(x) || islogical(x)) && isreal(x) ~= isreal(y), why{end + 1} = 'isreal'; end
  if ~isequaln(x, y), why{end + 1} = 'value'; end
  same = isempty(why);
end

function s = sparse_profile(v, depth)
  % 'S' or 'D' for every numeric or logical value inside v, in a shape that keeps where
  % each one sits: '{sp:S,d:D}' for st, '{S,D}' for c, 'P(S)' for pSp.
  s = '';
  if depth > 4, return, end
  if isnumeric(v) || islogical(v)
    if issparse(v), s = 'S'; else, s = 'D'; end
  elseif isstruct(v)
    f = fieldnames(v);
    parts = {};
    for e = 1:numel(v)
      for k = 1:numel(f)
        parts{end + 1} = [f{k} ':' sparse_profile(v(e).(f{k}), depth + 1)]; %#ok<AGROW>
      end
    end
    s = ['{' strjoin(parts, ',') '}'];
  elseif iscell(v)
    parts = cellfun(@(e) sparse_profile(e, depth + 1), reshape(v, 1, []), 'UniformOutput', false);
    s = ['{' strjoin(parts, ',') '}'];
  elseif isobject(v) && isscalar(v) && isprop(v, 'Value')
    s = ['P(' sparse_profile(v.Value, depth + 1) ')'];
  end
end

function tf = contains_kind(v, pred, depth)
  % Does pred hold of v or of anything inside it (struct fields, cell elements, object
  % properties), to a depth that covers every value here.
  tf = false;
  if depth > 4, return, end
  try
    if pred(v), tf = true; return, end
  catch
  end
  if isstruct(v)
    f = fieldnames(v);
    for e = 1:numel(v)
      for k = 1:numel(f)
        if contains_kind(v(e).(f{k}), pred, depth + 1), tf = true; return, end
      end
    end
  elseif iscell(v)
    for k = 1:numel(v)
      if contains_kind(v{k}, pred, depth + 1), tf = true; return, end
    end
  elseif isobject(v) && isscalar(v)
    p = properties(v);
    for k = 1:numel(p)
      try
        if contains_kind(v.(p{k}), pred, depth + 1), tf = true; return, end
      catch
      end
    end
  end
end

function failures = check_no_user(failures, path, label, user)
  if nargin < 3, label = ''; end
  if nargin < 4, user = getenv('USER'); end
  if isempty(label)
    [~, name, ext] = fileparts(path);
    label = [name ext];
  end
  fid = fopen(path, 'r');
  bytes = fread(fid, Inf, 'uint8=>char')';
  fclose(fid);
  failures = check_no_path(failures, bytes, label);
  if isempty(user), return, end
  if contains(bytes, user)
    failures{end + 1} = sprintf('%s names the account that saved it', label);
  end
end

function failures = check_no_path(failures, text, label)
  % This MATLAB's matlabroot (scrub_matlabroot) and any absolute path.
  if contains(text, matlabroot)
    failures{end + 1} = sprintf('%s holds the matlabroot of the MATLAB that saved it', label);
  end
  hit = regexp(text, '/System/Volume[s]|/User[s]/|mathworks/deve[l]|jobarchiv[e]|sandbo[x]', 'match', 'once');
  if ~isempty(hit)
    failures{end + 1} = sprintf('%s holds a path (%s)', label, hit);
  end
end

function t = truth_of(x)
  t = struct();
  t.class = class(x);
  t.size = size(x);
  t.numel = numel(x);
  t.isobject = isobject(x);
  t.isempty = isempty(x);
  t.issparse = issparse_any(x);
  t.isreal = isreal(x);
  t.disp = strtrim(formattedDisplayText(x, 'SuppressMarkup', true));
  if isstruct(x)
    t.fields = fieldnames(x)';
  elseif iscell(x)
    t.elementClasses = cellfun(@class, x(:)', 'UniformOutput', false);
    t.elementIssparse = cellfun(@issparse_any, x(:)', 'UniformOutput', false);
  elseif isobject(x)
    t = class_fields(t, x);
    t.properties = prop_truth(x);
  elseif isnumeric(x) || islogical(x)
    v = value_truth(x);
    names = fieldnames(v);
    for k = 1:numel(names)
      t.(names{k}) = v.(names{k});
    end
  end
end

function n = full_limit()
  % Past this many elements the full() values are not written out; the non-zeros are
  % the whole value.
  n = 10000;
end

function v = value_truth(x)
  % A numeric or logical value, sparse or not, spelled out so that no complex number
  % and no sparse array reaches jsonencode.
  v = struct();
  v.class = class(x);
  v.issparse = issparse(x);
  v.isreal = isreal(x);
  v.size = size(x);
  v.numel = numel(x);
  v.nnz = nnz(x);
  if issparse(x)
    v.nzmax = nzmax(x);
  end
  v.disp = strtrim(formattedDisplayText(x, 'SuppressMarkup', true));
  % MATLAB's own one-line summary of the value, as a struct field and as a cell
  % element display it.
  v.fieldDisp = field_disp(x);
  v.cellDisp = strtrim(formattedDisplayText({x}, 'SuppressMarkup', true));
  try
    v.mat2str = mat2str(x);
  catch err
    v.mat2str_error = err.message;
  end
  try
    v.mat2strClass = mat2str(x, 'class');
  catch err
    v.mat2strClass_error = err.message;
  end
  if numel(x) <= full_limit()
    % reshape, never x(:)': `'` is the CONJUGATE transpose.
    lin = reshape(full(x), 1, []);
    if islogical(lin), lin = double(lin); end
    v.real = parts_of(real(lin));
    v.imag = parts_of(imag(lin));
  else
    v.fullOmitted = sprintf('numel %d is over %d: the non-zeros are the whole value', numel(x), full_limit());
  end
  % The non-zeros in MATLAB's own (column-major) order, 1-based. For a dense value too,
  % so a test reads one shape whatever the storage.
  [i, j, nz] = find(x);
  nz = reshape(nz, 1, []);
  if islogical(nz), nz = double(nz); end
  v.nonzeros = struct('rows', {num2cell(reshape(i, 1, []))}, 'cols', {num2cell(reshape(j, 1, []))}, ...
    'real', {parts_of(real(nz))}, 'imag', {parts_of(imag(nz))});
end

function s = field_disp(x)
  t = formattedDisplayText(struct('v', x), 'SuppressMarkup', true);
  m = regexp(t, '^\s*v:\s?(.*?)\s*$', 'tokens', 'once', 'lineanchors');
  if isempty(m), s = strtrim(t); else, s = m{1}; end
end

function c = parts_of(p)
  % One JSON value per element: the number itself, or 'Inf', '-Inf' or 'NaN', for which
  % jsonencode would write null.
  c = cell(1, numel(p));
  for k = 1:numel(p)
    e = p(k);
    if isnan(e)
      c{k} = 'NaN';
    elseif isinf(e)
      if e > 0, c{k} = 'Inf'; else, c{k} = '-Inf'; end
    else
      c{k} = double(e);
    end
  end
end

function t = class_fields(t, x)
  names = {};
  if isa(x, 'Simulink.Parameter')
    names = {'Value', 'DataType', 'Min', 'Max', 'Unit', 'Description', 'Dimensions', 'Complexity'};
  elseif isa(x, 'dexsparse.FhAlias')
    names = {'BaseType', 'Description', 'DataScope', 'HeaderFile', 'Fh'};
  elseif isa(x, 'dexsparse.NumAlias')
    names = {'BaseType', 'Description', 'DataScope', 'HeaderFile', 'K'};
  end
  for k = 1:numel(names)
    if isprop(x, names{k})
      val = x.(names{k});
      if strcmp(names{k}, 'Value')
        t.(names{k}) = field_truth(val);
      elseif isa(val, 'function_handle')
        t.(names{k}) = struct('class', class(val), 'func2str', func2str(val));
      else
        t.(names{k}) = val;
      end
    end
  end
end

function t = field_truth(val)
  if isnumeric(val) || islogical(val)
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
