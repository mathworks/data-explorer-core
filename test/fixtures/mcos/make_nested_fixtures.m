function make_nested_fixtures()
  % Copyright 2026 The MathWorks, Inc.
  % Authors the nested-MCOS fixtures: MCOS objects (Simulink.Parameter, Simulink.Bus, a
  % MATLAB string, ...) held INSIDE a struct field, a struct-array element or a cell
  % element, each beside a TOP-LEVEL TWIN of equal value in the same file. Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<repo>/test/fixtures/mcos'); make_nested_fixtures"
  %
  % (One line, for the reason make_class_fixtures.m gives. Verify by the WROTE lines and
  % the trailing MAKE_NESTED_FIXTURES_DONE, not by the exit code; any FAIL line above it
  % means a fixture says something other than what this header promises.)
  %
  % Writes four files into this folder:
  %   nested_objects.mat         MATLAB's default `save` format — Level 5, not -v7.3
  %   nested_objects.truth.json  MATLAB's answers about it, read back with `load`
  %   nested_ws.slx              an empty model whose MODEL WORKSPACE (DataSource 'Model
  %                              File', so the data is a part of the .slx itself) holds
  %                              a struct of a Simulink.Parameter and a string
  %   nested_ws.truth.json       MATLAB's answers about it, read back out of the
  %                              workspace of the model reopened from disk
  %
  % WHY TWINS. A top-level object already decodes to the right node; what these files
  % ask is whether a NESTED one decodes to the SAME node. So every nested object has a
  % top-level twin in the same file, `twins` in each truth file pairs them, and the two
  % can be compared with each other as well as with MATLAB.
  %
  % WHY EACH TWIN IS BUILT, NOT ASSIGNED. Simulink.Parameter and Simulink.Signal are
  % HANDLE objects: `pTop = s.p` would make both names one object, `save` would write it
  % once, and the twin would share the nested one's heap entry — a comparison that passes
  % whatever the nested path does. Each value is therefore made by build(), called once
  % per copy, and each pair records MATLAB's own `sameHandle` (false) beside `isequal`.
  %
  % WHY THE TRUTH COMES FROM THE FILES. Every entry is measured on what `load`, and a
  % model reopened with load_system, hand back — never on the values built here — so a
  % value MATLAB writes but reads back differently is recorded as MATLAB reads it.
  %
  % The truth files, both:
  %   version, release   version and version('-release') of the MATLAB that wrote them
  %   paths              one record per MATLAB path ('s.sub.q', 'c{4}{1}', 'sa(2).p',
  %                      'pTop', ...), containers included: the design leaves a
  %                      container's own summary for later, so MATLAB's display of it
  %                      is recorded now. Every record has class, size, numel,
  %                      isobject, isempty and disp (formattedDisplayText with
  %                      SuppressMarkup, as gen_truth.m does), and then by kind:
  %                        string        text (column-major, a missing element as
  %                                      null), ismissing, lengths
  %                        struct        fields
  %                        cell          elementClasses (column-major)
  %                        object array  elements: one record per element, column-major
  %                        object        the class's own fields below, and
  %                                      `properties` in gen_truth.m's form — class,
  %                                      size, disp and mat2str of every property
  %                        other         mat2str
  %                      Parameter, Signal: Value (where the class has one), DataType,
  %                      Min, Max, Unit, Description, Dimensions, Complexity.
  %                      ValueType: the same less Value. AliasType: BaseType,
  %                      Description. Bus: Description, and busElements (Name,
  %                      DataType, Dimensions, Complexity per element).
  %   twins              {nested, twin, isHandle, isequal, isequaln, sameHandle,
  %                      recordsEqual} per pair; recordsEqual says the two records in
  %                      `paths` are identical, which this function also asserts.
  %                      isHandle is MATLAB's answer, and it splits these classes:
  %                      Parameter and Signal are handles, Bus, ValueType and
  %                      AliasType are not.
  %   nested_objects.truth.json adds `variables` (`whos -file`: name, class, size) and
  %   `header`; nested_ws.truth.json adds the model name, the workspace DataSource,
  %   `variables`, the package's `parts` and the `workspaceParts` among them.
  %
  % The .slx workspace holds no object array because it cannot: R2027a refuses one
  % there (test/parity/matlab/README.md, "What MATLAB refuses to store").
  %
  % The model's Creator and ModifiedByFormat are set to a fixed word before it is saved.
  % Left at their defaults, both are the account name of whoever ran this, and the .slx
  % carries them into metadata/coreProperties.xml.
  here = fileparts(mfilename('fullpath'));
  failures = {};

  [matTruth, failures] = write_mat(here, failures);
  write_json(fullfile(here, 'nested_objects.truth.json'), matTruth);

  [wsTruth, failures] = write_slx(here, failures);
  write_json(fullfile(here, 'nested_ws.truth.json'), wsTruth);

  if isempty(failures)
    fprintf('MAKE_NESTED_FIXTURES_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_NESTED_FIXTURES_FAILED %d\n', numel(failures));
  end
end

% ---------------------------------------------------------------------------
% The catalogs. A row is {path, getter, expected class, twin name, build key};
% a row with a twin name gets a top-level variable of that name, built by the
% same build key as the nested value.
% ---------------------------------------------------------------------------

function M = mat_catalog()
  M = {
    's',        @(L) L.s,          'struct',             '',          ''
    's.p',      @(L) L.s.p,        'Simulink.Parameter', 'pTop',      'p'
    's.sub',    @(L) L.s.sub,      'struct',             '',          ''
    's.sub.q',  @(L) L.s.sub.q,    'Simulink.Parameter', 'qTop',      'q'
    's.str',    @(L) L.s.str,      'string',             'strTop',    'str'
    's.strs',   @(L) L.s.strs,     'string',             'strsTop',   'strs'
    's.miss',   @(L) L.s.miss,     'string',             'missTop',   'miss'
    's.bus',    @(L) L.s.bus,      'Simulink.Bus',       'busTop',    'bus'
    's.vt',     @(L) L.s.vt,       'Simulink.ValueType', 'vtTop',     'vt'
    's.alias',  @(L) L.s.alias,    'Simulink.AliasType', 'aliasTop',  'alias'
    's.sig',    @(L) L.s.sig,      'Simulink.Signal',    'sigTop',    'sig'
    's.objArr', @(L) L.s.objArr,   'Simulink.Parameter', 'objArrTop', 'objArr'
    'c',        @(L) L.c,          'cell',               '',          ''
    'c{1}',     @(L) L.c{1},       'Simulink.Parameter', 'c1Top',     'c1'
    'c{2}',     @(L) L.c{2},       'string',             'c2Top',     'c2'
    'c{3}',     @(L) L.c{3},       'double',             '',          ''
    'c{4}',     @(L) L.c{4},       'cell',               '',          ''
    'c{4}{1}',  @(L) L.c{4}{1},    'Simulink.Parameter', 'c4_1Top',   'c4_1'
    'sa',       @(L) L.sa,         'struct',             '',          ''
    'sa(1)',    @(L) L.sa(1),      'struct',             '',          ''
    'sa(1).p',  @(L) L.sa(1).p,    'Simulink.Parameter', 'sa1pTop',   'sa1p'
    'sa(2)',    @(L) L.sa(2),      'struct',             '',          ''
    'sa(2).p',  @(L) L.sa(2).p,    'Simulink.Parameter', 'sa2pTop',   'sa2p'
  };
end

function M = mat_catalog_cells()
  % NON-SCALAR values inside cells. mat_catalog's cells hold only scalars, so a change
  % to how a cell summarizes a 1x3 string, a 1x2 object array or a 0x0 string went
  % unseen. A catalog of its own, saved after everything in mat_catalog, so that the
  % variables and paths that existed before it was added keep their records and their
  % order in the file. s2 is a new struct, not a field of s, for the same reason: a
  % field added to s would change the record of s itself.
  M = {
    'cArr',        @(L) L.cArr,        'cell',               '',            ''
    'cArr{1}',     @(L) L.cArr{1},     'string',             'cArr1Top',    'cArr1'
    'cArr{2}',     @(L) L.cArr{2},     'Simulink.Parameter', 'cArr2Top',    'cArr2'
    'cArr{3}',     @(L) L.cArr{3},     'string',             'cArr3Top',    'cArr3'
    'cArr{4}',     @(L) L.cArr{4},     'Simulink.Parameter', 'cArr4Top',    'cArr4'
    'cNest',       @(L) L.cNest,       'cell',               '',            ''
    'cNest{1}',    @(L) L.cNest{1},    'cell',               '',            ''
    'cNest{1}{1}', @(L) L.cNest{1}{1}, 'string',             'cNest1_1Top', 'cNest1_1'
    'cNest{2}',    @(L) L.cNest{2},    'cell',               '',            ''
    'cNest{2}{1}', @(L) L.cNest{2}{1}, 'Simulink.Parameter', 'cNest2_1Top', 'cNest2_1'
    's2',          @(L) L.s2,          'struct',             '',            ''
    's2.cs',       @(L) L.s2.cs,       'cell',               '',            ''
    's2.cs{1}',    @(L) L.s2.cs{1},    'string',             's2cs1Top',    's2cs1'
  };
end

function W = ws_catalog()
  W = {
    'cfg',       @(V) V.cfg,       'struct',             '',         ''
    'cfg.k',     @(V) V.cfg.k,     'Simulink.Parameter', 'kTop',     'k'
    'cfg.label', @(V) V.cfg.label, 'string',             'labelTop', 'label'
  };
end

function v = build(key)
  % One value per key, a FRESH object on every call — see the header for why a twin
  % may not be a second name for the nested object.
  switch key
    case 'p'
      v = Simulink.Parameter(7);
    case 'q'
      % Depth 2, and every scalar property away from its default, so a nested
      % object that lost its property block cannot pass for one at its defaults.
      v = Simulink.Parameter(2.5);
      v.DataType = 'single';
      v.Min = 0;
      v.Max = 10;
      v.Unit = 'm';
      v.Description = 'nested q';
    case 'str'
      v = "hello";
    case 'strs'
      % Square, which the parity corpus avoids — but four distinct elements make the
      % column-major order (a c b d) differ from the row-major one (a b c d).
      v = ["a" "b"; "c" "d"];
    case 'miss'
      v = string(missing);
    case 'bus'
      e1 = Simulink.BusElement;
      e1.Name = 'a';
      e1.DataType = 'double';
      e2 = Simulink.BusElement;
      e2.Name = 'b';
      e2.DataType = 'int8';
      v = Simulink.Bus;
      v.Elements = [e1 e2];
    case 'vt'
      v = Simulink.ValueType;
      v.DataType = 'int16';
      v.Dimensions = [1 3];
    case 'alias'
      v = Simulink.AliasType('uint8');
    case 'sig'
      v = Simulink.Signal;
      v.DataType = 'single';
    case 'objArr'
      v = [Simulink.Parameter(1), Simulink.Parameter(2)];
    case 'c1'
      v = Simulink.Parameter(11);
    case 'c2'
      v = "txt";
    case 'c4_1'
      v = Simulink.Parameter(12);
    case 'sa1p'
      v = Simulink.Parameter(21);
    case 'sa2p'
      v = Simulink.Parameter(22);
    case 'cArr1'
      v = ["a" "b" "c"];
    case 'cArr2'
      v = [Simulink.Parameter(1), Simulink.Parameter(2)];
    case 'cArr3'
      v = strings(0, 0);
    case 'cArr4'
      v = Simulink.Parameter(3);
    case 'cNest1_1'
      v = ["p" "q"];
    case 'cNest2_1'
      v = Simulink.Parameter(4);
    case 's2cs1'
      v = ["x" "y"];
    case 'k'
      v = Simulink.Parameter(5);
    case 'label'
      v = "ws text";
    otherwise
      error('make_nested_fixtures:build', 'no value for key %s', key);
  end
end

% ---------------------------------------------------------------------------
% The .mat
% ---------------------------------------------------------------------------

function [T, failures] = write_mat(here, failures)
  matPath = fullfile(here, 'nested_objects.mat');

  s = struct();
  s.p = build('p');
  s.sub = struct('q', build('q'));
  s.str = build('str');
  s.strs = build('strs');
  s.miss = build('miss');
  s.bus = build('bus');
  s.vt = build('vt');
  s.alias = build('alias');
  s.sig = build('sig');
  s.objArr = build('objArr');

  vars = struct();
  vars.s = s;
  % Assigned, not passed to struct(): struct('c', {...}) would make a struct ARRAY.
  vars.c = {build('c1'), build('c2'), 42, {build('c4_1')}};
  vars.sa = struct('p', {build('sa1p'), build('sa2p')});
  M = mat_catalog();
  vars = add_twins(vars, M);

  vars.cArr = {build('cArr1'), build('cArr2'), build('cArr3'), build('cArr4')};
  vars.cNest = {{build('cNest1_1')}, {build('cNest2_1')}};
  vars.s2 = struct();
  vars.s2.cs = {build('s2cs1')};
  cells = mat_catalog_cells();
  vars = add_twins(vars, cells);
  M = [M; cells];
  % No version flag: the default, which is what a user's `save` writes. The header is
  % checked below, so a machine whose default is -v7.3 fails here rather than writing
  % an HDF5 file under a Level 5 name.
  save(matPath, '-struct', 'vars');
  clear s vars

  fid = fopen(matPath, 'r');
  hdr = fread(fid, [1 116], 'char=>char');
  fclose(fid);
  want = 'MATLAB 5.0 MAT-file';
  if ~startsWith(hdr, want)
    failures{end + 1} = sprintf('nested_objects.mat header is "%s", expected "%s..."', ...
      strtrim(hdr(1:min(end, 40))), want);
  end
  fprintf('WROTE nested_objects.mat bytes=%d\n', dir(matPath).bytes);

  L = load(matPath);
  [paths, twins, failures] = measure(M, L, failures);

  w = whos('-file', matPath);
  variables = arrayfun(@(e) struct('name', e.name, 'class', e.class, 'size', e.size), ...
    w(:)', 'UniformOutput', false);

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.file = 'nested_objects.mat';
  T.header = hdr(1:numel(want));
  T.variables = variables;
  T.paths = paths;
  T.twins = twins;
end

function vars = add_twins(vars, M)
  for i = 1:size(M, 1)
    if ~isempty(M{i, 4})
      vars.(M{i, 4}) = build(M{i, 5});
    end
  end
end

% ---------------------------------------------------------------------------
% The .slx
% ---------------------------------------------------------------------------

function [T, failures] = write_slx(here, failures)
  % The model is named for the file it is saved to: save_system to another name
  % renames the block diagram (gen_truth.m).
  mdl = 'nested_ws';
  slxPath = fullfile(here, [mdl '.slx']);
  if bdIsLoaded(mdl), close_system(mdl, 0); end
  if isfile(slxPath), delete(slxPath); end
  closer = onCleanup(@() close_if_loaded(mdl));

  new_system(mdl);
  set_param(mdl, 'Creator', 'fixture', 'ModifiedByFormat', 'fixture');
  ws = get_param(mdl, 'ModelWorkspace');
  if ~strcmp(ws.DataSource, 'Model File')
    failures{end + 1} = sprintf('new model workspace DataSource is %s', ws.DataSource);
  end
  W = ws_catalog();
  cfg = struct();
  cfg.k = build('k');
  cfg.label = build('label');
  assignin(ws, 'cfg', cfg);
  for i = 1:size(W, 1)
    if ~isempty(W{i, 4})
      assignin(ws, W{i, 4}, build(W{i, 5}));
    end
  end
  save_system(mdl, slxPath);
  close_system(mdl, 0);
  clear cfg ws
  fprintf('WROTE %s.slx bytes=%d\n', mdl, dir(slxPath).bytes);

  [parts, coreProps] = slx_parts(slxPath);
  fprintf('  part %s\n', parts{:});
  wsParts = parts(contains(parts, 'modelworkspace', 'IgnoreCase', true));
  if isempty(wsParts)
    failures{end + 1} = 'nested_ws.slx holds no model-workspace part';
  end
  user = getenv('USER');
  if ~isempty(user) && contains(coreProps, user)
    failures{end + 1} = 'nested_ws.slx metadata/coreProperties.xml names the account that saved it';
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

function [parts, coreProps] = slx_parts(slxPath)
  % The package's member names, read by unzipping it into a scratch folder that is
  % removed again before this returns.
  tmp = tempname;
  mkdir(tmp);
  cleanup = onCleanup(@() rmdir(tmp, 's'));
  files = unzip(slxPath, tmp);
  % By the scratch folder's own name rather than its whole path, which on macOS can come
  % back from unzip under /private.
  [~, tag] = fileparts(tmp);
  parts = sort(regexprep(strrep(files(:)', filesep, '/'), ['^.*/' tag '/'], ''));
  coreProps = '';
  core = fullfile(tmp, 'metadata', 'coreProperties.xml');
  if isfile(core)
    coreProps = fileread(core);
  end
end

function close_if_loaded(mdl)
  if bdIsLoaded(mdl), close_system(mdl, 0); end
end

% ---------------------------------------------------------------------------
% Measuring
% ---------------------------------------------------------------------------

function [paths, twins, failures] = measure(M, L, failures)
  paths = containers.Map('KeyType', 'char', 'ValueType', 'any');
  twins = {};
  for i = 1:size(M, 1)
    [path, getter, cls, twin] = M{i, 1:4};
    v = getter(L);
    paths(path) = truth_of(v);
    failures = check_class(failures, path, v, cls);
    fprintf('  %-10s %-20s %s\n', path, class(v), mat2str(size(v)));
    if isempty(twin), continue, end
    w = L.(twin);
    paths(twin) = truth_of(w);
    failures = check_class(failures, twin, w, cls);
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

function r = twin_truth(path, a, twin, b)
  r = struct();
  r.nested = path;
  r.twin = twin;
  r.isHandle = isa(a, 'handle');
  % Both, because they differ on s.miss: a missing string is not isequal to itself,
  % exactly as NaN is not.
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
  % isequaln for the same reason: s.miss's record holds a missing string and a NaN length.
  r.recordsEqual = isequaln(truth_of(a), truth_of(b));
end

function t = truth_of(x)
  t = struct();
  t.class = class(x);
  t.size = size(x);
  t.numel = numel(x);
  t.isobject = isobject(x);
  t.isempty = isempty(x);
  % SuppressMarkup on every call, for the reasons gen_truth.m gives at t.disp.
  t.disp = strtrim(formattedDisplayText(x, 'SuppressMarkup', true));
  % isstring before isobject: isobject("a") is TRUE.
  if isstring(x)
    lin = x(:)';
    t.text = text_of(lin);
    t.ismissing = num2cell(ismissing(lin));
    t.lengths = num2cell(strlength(lin));
  elseif isstruct(x)
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
  else
    try
      t.mat2str = mat2str(x);
    catch err
      t.mat2str_error = err.message;
    end
  end
end

function c = text_of(lin)
  % A cell, so that one element is still a JSON array; a missing element is held as a
  % missing string, which jsonencode writes as null.
  c = cell(1, numel(lin));
  for k = 1:numel(lin)
    if ismissing(lin(k))
      c{k} = string(missing);
    else
      c{k} = char(lin(k));
    end
  end
end

function t = class_fields(t, x)
  names = {};
  if isa(x, 'Simulink.Parameter') || isa(x, 'Simulink.Signal')
    names = {'Value', 'DataType', 'Min', 'Max', 'Unit', 'Description', 'Dimensions', 'Complexity'};
  elseif isa(x, 'Simulink.ValueType')
    names = {'DataType', 'Dimensions', 'Min', 'Max', 'Unit', 'Description', 'Complexity'};
  elseif isa(x, 'Simulink.AliasType')
    names = {'BaseType', 'Description'};
  elseif isa(x, 'Simulink.Bus')
    names = {'Description'};
    els = x.Elements;
    t.busElements = cell(1, numel(els));
    for k = 1:numel(els)
      e = els(k);
      t.busElements{k} = struct('Name', e.Name, 'DataType', e.DataType, ...
        'Dimensions', e.Dimensions, 'Complexity', e.Complexity);
    end
  end
  for k = 1:numel(names)
    if isprop(x, names{k})
      t.(names{k}) = x.(names{k});
    end
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
