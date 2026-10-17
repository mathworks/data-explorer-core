function make_typed_fixtures(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors the typed-MCOS fixtures: Simulink.Parameters whose Value is a REAL number of a
  % class other than double (intN, uintN, logical, single), beside double controls and
  % plain single variables, written by MATLAB into the four venues that can hold them.
  % Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<repo>/test/fixtures/mcos'); make_typed_fixtures"
  %
  % (One line, for the reason make_class_fixtures.m gives. Verify by the WROTE lines and
  % the trailing MAKE_TYPED_FIXTURES_DONE, not by the exit code; any FAIL line above it
  % means a fixture says something other than what this header promises.) An optional
  % argument names another folder to write into, so a run can be inspected before it
  % replaces what is committed.
  %
  % Writes five files:
  %   typed_objects.mat          MATLAB's default `save` format (Level 5, not -v7.3)
  %   typed_ws.slx               an empty model whose MODEL WORKSPACE (DataSource 'Model
  %                              File', a part of the .slx itself) holds the same values
  %   typed_mcos.sldd            a data dictionary, FileFormat 'uncompressed-text'
  %   typed_mcos_binary.sldd     the same entries, FileFormat 'compressed-binary', but
  %                              for sSingleSweep (names_in says why)
  %   typed_fixtures.truth.json  MATLAB's answers about each, read back from the file:
  %                              `load`, the model reopened with load_system, and each
  %                              dictionary reopened with Simulink.data.dictionary.open
  %
  % WHY. Inside an MCOS object (a .mat, a model workspace, a binary dictionary's hex) the
  % reader handed a real non-double numeric over as a bare number or list, which the node
  % layer reads as a double: an int32 row Value showed class double, a logical row double,
  % and a single showed the double it widens to, 3.299999952316284 for single(3.3). Both
  % dictionaries hold the same Values typed, and show int32, logical and 3.3. Every name
  % here is in every venue (but for sSingleSweep in the binary dictionary), so a venue that
  % presents a value differently from another is caught by name.
  %
  % The truth, per venue, `paths.<name>`: the class of what was read back, and for its
  % numbers (a Parameter's Value, or the plain variable itself) `value`: class, size,
  % mat2str(v, 'class') and `elements`, column-major, each MATLAB's own exact answer —
  % num2str for an integer or logical element, num2hex for a single or a double,
  % whose bits are the value, as no decimal spelling is. A value of more than 64 elements
  % records its class, size and numel alone. Every venue's value is checked here to be the
  % value written, class, size and bits (a FAIL otherwise).
  %
  % THE DIGITS. A dictionary holds MATLAB's own text for a single, so the sweep below is
  % MATLAB's rule for that text, measured: `%.6g` where that is the same single, otherwise
  % `%.9g`, and `%.10g` for realmax('single'), whose `%.9g` is past it.
  %
  % NO ACCOUNT NAME IN ANY FILE, as make_complex_fixtures.m: the model's Creator and
  % ModifiedByFormat are a fixed word, USER is that word while a dictionary is written,
  % and every file and every part of each package is searched for the account name.
  here = fileparts(mfilename('fullpath'));
  if nargin < 1 || isempty(outDir)
    outDir = here;
  end
  if ~isfolder(outDir)
    mkdir(outDir);
  end
  failures = {};

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.names = catalog()';
  [T.mat, failures] = write_mat(outDir, failures);
  [T.slx, failures] = write_slx(outDir, failures);
  [T.text, failures] = write_sldd(outDir, failures, 'typed_mcos.sldd', 'uncompressed-text');
  [T.binary, failures] = write_sldd(outDir, failures, 'typed_mcos_binary.sldd', 'compressed-binary');
  write_json(fullfile(outDir, 'typed_fixtures.truth.json'), T);

  if isempty(failures)
    fprintf('MAKE_TYPED_FIXTURES_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_TYPED_FIXTURES_FAILED %d\n', numel(failures));
  end
end

% ---------------------------------------------------------------------------
% The catalog: one name per value, the same names in every venue.
% ---------------------------------------------------------------------------

function names = catalog()
  names = fieldnames(values())';
end

% The names a venue holds: all of them, but for the sweep in the binary dictionary.
% binarySaveKeepsUnedited.test.ts edits every element of every binary fixture, one save
% per edit, and 4,082 of them took three minutes; MATLAB's binary text for the same 4,082
% singles is its text one (measured when this was written: every element alike).
function names = names_in(format)
  names = catalog();
  if strcmp(format, 'compressed-binary')
    names = setdiff(names, {'sSingleSweep'}, 'stable');
  end
end

function S = values()
  S = struct();
  % Integers, every shape: scalar, row, column, matrix, N-D, and the two 64-bit
  % extremes no double holds.
  S.pInt8 = param(int8(-42));
  S.pInt32Row = param(int32([100 200 300 400]));
  S.pInt32Col = param(int32([100; 200; 300]));
  S.pUint8Mat = param(uint8([1 2; 3 4]));
  S.pInt16Nd = param(int16(reshape(1:8, 2, 2, 2)));
  S.pUint16Row = param(uint16([0 65535]));
  S.pUint64Max = param(intmax('uint64'));
  S.pInt64Min = param(intmin('int64'));
  % Logical: the scalar was already a boolean everywhere; the row and the column are not.
  S.pLogical = param(true);
  S.pLogicalRow = param([true false true]);
  S.pLogicalCol = param([true; false; true]);
  % Single: decimals with no exact binary form, so the widened double shows, and values
  % that are exact, which must not move.
  S.pSingle = param(single(3.3));
  S.pSingleRow = param(single([1.1 2.2 3.3]));
  S.pSingleCol = param(single([0.1; 0.2]));
  S.pSingleThird = param(single(1/3));
  S.pSingleExact = param(single([0.5 16777216]));
  % Double controls: their presentation must not change.
  S.pDouble = param(3.3);
  S.pDoubleRow = param([1.1 2.2 3.3]);
  S.pDoubleCol = param([1; 2; 3]);
  % Plain singles, no object around them.
  S.sSingle = single(3.3);
  S.sSingleRow = single([1.1 2.2 3.3]);
  S.sSingleThird = single(1/3);
  % Every 1048577th float32 bit pattern from the smallest subnormal to the largest finite
  % one, each with its negation, then realmax and realmin: the digits the text dictionary
  % spells every one of them with are MATLAB's rule for a single's text, which a single
  % read out of MAT bytes is held to.
  sweep = typecast(uint32(1):uint32(1048577):uint32(2139095040), 'single');
  S.sSingleSweep = [sweep, -sweep, realmax('single'), realmin('single')];
  % Singles whose nine-digit spelling is an exact decimal tie: 1000000.125 is halfway
  % between 1000000.12 and 1000000.13.
  S.sSingleTies = single([1000000.125 1000000.375 1000000.625 -1000000.125 2097151.875]);
end

function p = param(v)
  p = Simulink.Parameter;
  p.Value = v;
end

% ---------------------------------------------------------------------------
% The venues
% ---------------------------------------------------------------------------

function [T, failures] = write_mat(outDir, failures)
  matPath = fullfile(outDir, 'typed_objects.mat');
  if isfile(matPath), delete(matPath); end
  vars = values();
  % No version flag: the default, which is what a user's `save` writes. The header is
  % checked below.
  save(matPath, '-struct', 'vars');
  clear vars
  fid = fopen(matPath, 'r');
  hdr = fread(fid, [1 116], 'char=>char');
  fclose(fid);
  want = 'MATLAB 5.0 MAT-file';
  if ~startsWith(hdr, want)
    failures{end + 1} = sprintf('typed_objects.mat header is "%s"', strtrim(hdr(1:min(end, 40))));
  end
  failures = check_no_user(failures, matPath, 'typed_objects.mat', getenv('USER'));
  fprintf('WROTE typed_objects.mat bytes=%d\n', dir(matPath).bytes);
  [T, failures] = measure('typed_objects.mat', load(matPath), failures);
end

function [T, failures] = write_slx(outDir, failures)
  % The model is named for the file it is saved to: save_system to another name renames
  % the block diagram.
  mdl = 'typed_ws';
  slxPath = fullfile(outDir, [mdl '.slx']);
  if bdIsLoaded(mdl), close_system(mdl, 0); end
  if isfile(slxPath), delete(slxPath); end
  closer = onCleanup(@() close_if_loaded(mdl)); %#ok<NASGU>

  new_system(mdl);
  set_param(mdl, 'Creator', 'fixture', 'ModifiedByFormat', 'fixture');
  ws = get_param(mdl, 'ModelWorkspace');
  if ~strcmp(ws.DataSource, 'Model File')
    failures{end + 1} = sprintf('new model workspace DataSource is %s', ws.DataSource);
  end
  vars = values();
  names = fieldnames(vars);
  for i = 1:numel(names)
    assignin(ws, names{i}, vars.(names{i}));
  end
  save_system(mdl, slxPath);
  close_system(mdl, 0);
  clear vars ws
  fprintf('WROTE %s.slx bytes=%d\n', mdl, dir(slxPath).bytes);
  failures = zip_no_user(slxPath, [mdl '.slx'], failures, getenv('USER'));

  load_system(slxPath);
  ws = get_param(mdl, 'ModelWorkspace');
  dataSource = ws.DataSource;
  V = struct();
  for i = 1:numel(names)
    V.(names{i}) = getVariable(ws, names{i});
  end
  clear ws
  close_system(mdl, 0);
  [T, failures] = measure([mdl '.slx'], V, failures);
  T.dataSource = dataSource;
end

function close_if_loaded(mdl)
  if bdIsLoaded(mdl), close_system(mdl, 0); end
end

function [T, failures] = write_sldd(outDir, failures, ddName, format)
  % MATLAB keys open dictionaries by FILE NAME alone, so everything is closed first.
  ddPath = fullfile(outDir, ddName);
  Simulink.data.dictionary.closeAll('-discard');
  if isfile(ddPath), delete(ddPath); end

  oldUser = getenv('USER');
  setenv('USER', 'fixture');
  restoreUser = onCleanup(@() setenv('USER', oldUser));

  vars = values();
  dd = Simulink.data.dictionary.create(ddPath);
  ds = getSection(dd, 'Design Data');
  names = names_in(format);
  for i = 1:numel(names)
    try
      addEntry(ds, names{i}, vars.(names{i}));
    catch err
      failures{end + 1} = sprintf('%s refused entry %s: %s', ddName, names{i}, err.message); %#ok<AGROW>
    end
  end
  % Before saveChanges, which is what decides the bytes.
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
    failures = zip_no_user(ddPath, ddName, failures, oldUser);
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
  V = struct();
  for i = 1:numel(names)
    V.(names{i}) = getValue(getEntry(ds, names{i}));
  end
  clear ds
  close(dd);
  clear dd
  Simulink.data.dictionary.closeAll('-discard');
  [T, failures] = measure(ddName, V, failures, names);
  T.fileFormat = fileFormat;
end

% ---------------------------------------------------------------------------
% Measuring what was read back
% ---------------------------------------------------------------------------

function [T, failures] = measure(file, V, failures, names)
  if nargin < 4
    names = catalog();
  end
  T = struct();
  T.file = file;
  T.paths = struct();
  built = values();
  for i = 1:numel(names)
    n = names{i};
    if ~isfield(V, n)
      failures{end + 1} = sprintf('%s does not hold %s', file, n); %#ok<AGROW>
      continue
    end
    x = V.(n);
    r = struct();
    r.class = class(x);
    if isa(x, 'Simulink.Parameter')
      v = x.Value;
      b = built.(n).Value;
    else
      v = x;
      b = built.(n);
    end
    r.value = value_record(v);
    % What was read back is what was written, class and bits, or the fixture is not
    % the value its name says.
    if ~strcmp(class(v), class(b)) || ~isequal(size(v), size(b)) || ~isequal(v, b)
      failures{end + 1} = sprintf('%s reads %s back as %s %s', file, n, class(v), mat2str(size(v))); %#ok<AGROW>
    end
    T.paths.(n) = r;
  end
end

function r = value_record(v)
  r = struct();
  r.class = class(v);
  r.size = size(v);
  % A long value's elements are its bits in the .mat, which `measure` holds every other
  % venue to; listing them would make this file the size of the sweep.
  if numel(v) > 64
    r.numel = numel(v);
    return
  end
  try
    r.mat2str = mat2str(v, 'class');
  catch e
    r.mat2str_error = e.message;
  end
  flat = v(:)';
  e = cell(1, numel(flat));
  for k = 1:numel(flat)
    x = flat(k);
    if islogical(x) || isinteger(x)
      % num2str, not sprintf('%d'): sprintf answers 1.844674e+19 for intmax('uint64').
      e{k} = num2str(x);
    else
      e{k} = num2hex(x);
    end
  end
  r.elements = e;
end

% ---------------------------------------------------------------------------
% No account name
% ---------------------------------------------------------------------------

function failures = check_no_user(failures, path, label, user)
  if isempty(user), return, end
  fid = fopen(path, 'r');
  bytes = fread(fid, Inf, 'uint8=>char')';
  fclose(fid);
  if contains(bytes, user)
    failures{end + 1} = sprintf('%s names the account that saved it', label);
  end
end

function failures = zip_no_user(zipPath, label, failures, user)
  % A zip: a search of its raw bytes cannot see inside a deflated part, so every part
  % is searched unpacked, in a scratch folder removed again before this returns.
  tmp = tempname;
  mkdir(tmp);
  cleanup = onCleanup(@() rmdir(tmp, 's')); %#ok<NASGU>
  files = unzip(zipPath, tmp);
  for k = 1:numel(files)
    if isfile(files{k})
      [~, partName, partExt] = fileparts(files{k});
      failures = check_no_user(failures, files{k}, sprintf('%s part %s%s', label, partName, partExt), user);
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
