function make_hex_object_fixtures(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors the hex-OBJECT fixtures: values a compressed-binary dictionary writes as
  % Encoding="hex" whose decoded tree holds something other than plain arrays — an
  % ANONYMOUS function handle stored as an MCOS property, a struct inside an MCOS object,
  % and Simulink objects (Signal, Bus, ValueType, VariantControl) inside a hex struct and
  % a hex cell — beside their text-dictionary and .mat twins. make_sparse_fixtures.m
  % covers sparse arrays and a NAMED function handle (@sin); this covers what decodes
  % into the other node classes. Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_hex_object_fixtures"
  %
  % (One line, as make_sparse_fixtures.m explains. Verify by the WROTE lines and the
  % trailing MAKE_HEX_OBJECT_FIXTURES_DONE; any FAIL line means a file says something
  % other than this header promises.) `outDir` defaults to this folder.
  %
  % Writes four files:
  %   hexobj_binary.sldd     a data dictionary, FileFormat 'compressed-binary'
  %   hexobj_text.sldd       the same entries, FileFormat 'uncompressed-text'
  %   hexobj_values.mat      the same values as variables, MATLAB's default `save`
  %   hexobj.truth.json      MATLAB's answers about all three, each read back
  %
  % THE VALUES (Design Data, and the same names in the .mat):
  %   anonAlias  a dexsparse.FhAlias whose Fh is the ANONYMOUS @(y) y*2. MATLAB stores an
  %              anonymous handle's text with the prefix of its scope, `sf%0@(y)y*2`,
  %              beside type 'anonymous'; func2str and the text dictionary say
  %              `@(y)y*2`. The handle is made with str2func so that it records no file:
  %              one made in this file would carry this file's path, the account name in
  %              it, into every venue.
  %   holder     a dexsparse.HolderAlias: Fh = @sin (so the binary dictionary writes it
  %              hex) and S, a struct. S is a struct inside an MCOS object inside a hex
  %              stream.
  %   objs       a struct holding a sparse array (so it is hex in a binary dictionary)
  %              and one Simulink.Signal, Simulink.Bus, Simulink.ValueType,
  %              Simulink.VariantControl, Simulink.data.dictionary.EnumTypeDefinition and
  %              Simulink.Parameter. Each object sits in the stream's MCOS subsystem, and
  %              this package decodes each into the node its class has.
  %   objsCell   the same seven values as a 1x7 cell.
  %   pTall      a Simulink.Parameter whose Value is a sparse array too large for this
  %              package to materialize (10000000x2, two non-zeros): an undecoded value
  %              inside an MCOS property.
  %   cTall      the same sparse array, and a 2, as a 1x2 cell: an undecoded cell element.
  %   control    a plain double, written as XML everywhere: what the binary dictionary
  %              writes when no hex is called for.
  %
  % A refused entry is recorded in `refused` with MATLAB's message, not failed: what
  % Design Data accepts is MATLAB's to say. The truth records, per venue and value, what
  % the venue hands back — class, func2str, the struct's fields, every member's class and
  % issparse — and for the binary dictionary each entry's Value tag.
  %
  % NO ACCOUNT NAME AND NO PATH IN ANY FILE: USER is set to 'fixture' while a dictionary
  % is written, and every file — the dictionary's zip parts, and the bytes inside every
  % hex value, decoded — is searched for the account name, this MATLAB's matlabroot and
  % any absolute path (the build-archive, home-folder and sandbox kinds the leak check
  % names);
  % a hit is a FAIL. The .mat is saved -nocompression so that the same search reads it.
  %
  % MATLAB writes its own matlabroot into every function handle it serializes, so the
  % binary dictionary's hex values and the .mat would carry the install path of the
  % MATLAB that wrote them. scrub_matlabroot replaces it with a token of the same length
  % in both files, before they are searched and read back: what the truth records is
  % MATLAB's reading of the scrubbed files.
  if nargin < 1 || isempty(outDir)
    outDir = fileparts(mfilename('fullpath'));
  end
  here = fileparts(mfilename('fullpath'));
  addpath(here);
  failures = {};
  user = getenv('USER');

  V = build_values();
  names = fieldnames(V)';

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.values = describe_built(V);

  [T.binary, failures] = write_dd(outDir, 'hexobj_binary.sldd', 'compressed-binary', V, names, failures, user);
  [T.text, failures] = write_dd(outDir, 'hexobj_text.sldd', 'uncompressed-text', V, names, failures, user);
  [T.mat, failures] = write_mat(outDir, V, names, failures, user);

  write_json(fullfile(outDir, 'hexobj.truth.json'), T);
  fprintf('WROTE hexobj.truth.json\n');
  if isempty(failures)
    fprintf('MAKE_HEX_OBJECT_FIXTURES_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_HEX_OBJECT_FIXTURES_FAILED %d\n', numel(failures));
  end
end

function V = build_values()
  V = struct();
  a = dexsparse.FhAlias;
  a.Fh = str2func('@(y) y*2');
  V.anonAlias = a;
  h = dexsparse.HolderAlias;
  h.S = struct('a', 2, 'b', 'xy');
  V.holder = h;
  sig = Simulink.Signal;
  sig.Min = 1;
  bus = Simulink.Bus;
  el = Simulink.BusElement;
  el.Name = 'e1';
  bus.Elements = el;
  vt = Simulink.ValueType;
  vc = Simulink.VariantControl;
  vc.Value = 1;
  et = Simulink.data.dictionary.EnumTypeDefinition;
  et.appendEnumeral('Red', 2);
  prm = Simulink.Parameter(3);
  V.objs = struct('sp', sparse([0 3]), 'sig', sig, 'bus', bus, 'vt', vt, 'vc', vc, 'et', et, 'prm', prm);
  V.objsCell = {sparse([0 3]), sig, bus, vt, vc, et, prm};
  tall = sparse([1 9999999], [1 2], [7 8], 10000000, 2);
  V.pTall = Simulink.Parameter(tall);
  V.cTall = {tall, 2};
  V.control = 5;
end

function D = describe_built(V)
  D = struct();
  for n = fieldnames(V)'
    D.(n{1}) = describe(V.(n{1}));
  end
end

function d = describe(x)
  % What a venue hands back for one value: its class, and per kind what this package
  % has to show for it.
  d = struct('class', class(x), 'size', size(x), 'issparse', issparse(x));
  if isa(x, 'dexsparse.FhAlias') || isa(x, 'dexsparse.HolderAlias')
    d.Fh = func2str(x.Fh);
    fi = functions(x.Fh);
    d.FhType = fi.type;
    d.BaseType = x.BaseType;
    if isa(x, 'dexsparse.HolderAlias')
      d.S = x.S;
    end
  elseif isa(x, 'Simulink.Parameter')
    d.Value = describe(x.Value);
  elseif isstruct(x)
    f = fieldnames(x)';
    d.fields = f;
    d.fieldClasses = cellfun(@(k) class(x.(k)), f, 'UniformOutput', false);
    d.fieldIssparse = cellfun(@(k) issparse(x.(k)), f);
  elseif iscell(x)
    d.elementClasses = cellfun(@class, x, 'UniformOutput', false);
    d.elementIssparse = cellfun(@issparse, x);
    d.elementSizes = cellfun(@size, x, 'UniformOutput', false);
  elseif issparse(x)
    % Its non-zeros, not its elements: a tall one has twenty million.
    [r, c, v] = find(x);
    d.nonzeros = struct('rows', r', 'cols', c', 'values', full(v)');
  elseif isnumeric(x)
    d.value = full(x);
  end
end

function [R, failures] = write_dd(outDir, ddName, format, V, names, failures, user)
  ddPath = fullfile(outDir, ddName);
  Simulink.data.dictionary.closeAll('-discard');
  if isfile(ddPath), delete(ddPath); end
  setenv('USER', 'fixture');
  restoreUser = onCleanup(@() setenv('USER', user));

  R = struct('file', ddName, 'fileFormat', format);
  refused = cell(0, 2);
  dd = Simulink.data.dictionary.create(ddPath);
  ds = getSection(dd, 'Design Data');
  for i = 1:numel(names)
    try
      addEntry(ds, names{i}, V.(names{i}));
    catch err
      refused(end + 1, :) = {names{i}, err.message}; %#ok<AGROW>
    end
  end
  dd.FileFormat = format;
  saveChanges(dd);
  clear ds
  close(dd);
  clear dd
  Simulink.data.dictionary.closeAll('-discard');
  clear restoreUser
  R.refused = cell2struct(refused, {'name', 'message'}, 2);
  if strcmp(format, 'compressed-binary')
    [~, R.matlabrootScrubbed] = scrub_matlabroot(ddPath);
  end
  fprintf('WROTE %s bytes=%d\n', ddName, dir(ddPath).bytes);

  if strcmp(format, 'compressed-binary')
    [R.valueTags, failures] = binary_value_tags(ddPath, ddName, failures, user);
  else
    failures = check_no_user(failures, fileread(ddPath), ddName, user);
  end

  dd = Simulink.data.dictionary.open(ddPath);
  ds = getSection(dd, 'Design Data');
  es = find(ds);
  R.entries = sort({es.Name});
  got = struct();
  for i = 1:numel(R.entries)
    got.(R.entries{i}) = describe(getValue(getEntry(ds, R.entries{i})));
  end
  R.readBack = got;
  clear ds es
  close(dd);
  clear dd
  Simulink.data.dictionary.closeAll('-discard');
end

function [tags, failures] = binary_value_tags(ddPath, ddName, failures, user)
  % Every entry's Value tag as written, and for a hex one whether its bytes are the
  % value's getByteStreamFromArray (they are MATLAB's; this records that they decode).
  tmp = tempname;
  mkdir(tmp);
  cleanup = onCleanup(@() rmdir(tmp, 's'));
  files = unzip(ddPath, tmp);
  for k = 1:numel(files)
    if ~isfolder(files{k})
      failures = check_no_user(failures, fileread(files{k}), [ddName ':' files{k}(numel(tmp) + 2:end)], user);
    end
  end
  xml = fileread(fullfile(tmp, 'data', 'chunk0.xml'));
  tags = struct('name', {}, 'tag', {}, 'isHex', {});
  objs = regexp(xml, '<Object Class="DD.ENTRY">.*?</Object>', 'match');
  for k = 1:numel(objs)
    name = regexp(objs{k}, '<P Name="Name" Class="char">([^<]*)</P>', 'tokens', 'once');
    tag = regexp(objs{k}, '<P Name="Value"[^>]*>', 'match', 'once');
    isHex = contains(tag, 'Encoding="hex"');
    tags(end + 1) = struct('name', name{1}, 'tag', tag, 'isHex', isHex); %#ok<AGROW>
    if isHex
      body = regexp(objs{k}, '<P Name="Value"[^>]*>([^<]*)</P>', 'tokens', 'once');
      digits = regexprep(body{1}, '\s', '');
      bytes = uint8(sscanf(digits, '%2x'));
      failures = check_no_user(failures, char(bytes'), [ddName ' hex of ' name{1}], user);
      try
        getArrayFromByteStream(bytes);
      catch err
        failures{end + 1} = sprintf('%s: the hex of %s does not decode: %s', ddName, name{1}, err.message); %#ok<AGROW>
      end
    end
  end
end

function [R, failures] = write_mat(outDir, V, names, failures, user)
  matPath = fullfile(outDir, 'hexobj_values.mat');
  if isfile(matPath), delete(matPath); end
  S = V; %#ok<NASGU>
  save(matPath, '-struct', 'S', names{:}, '-nocompression');
  [~, scrubbed] = scrub_matlabroot(matPath);
  fprintf('WROTE hexobj_values.mat bytes=%d\n', dir(matPath).bytes);
  fid = fopen(matPath, 'r');
  bytes = fread(fid, Inf, 'uint8=>char')';
  fclose(fid);
  failures = check_no_user(failures, bytes, 'hexobj_values.mat', user);
  L = load(matPath);
  R = struct('file', 'hexobj_values.mat', 'variables', {sort(fieldnames(L))'}, 'matlabrootScrubbed', scrubbed);
  got = struct();
  for n = fieldnames(L)'
    got.(n{1}) = describe(L.(n{1}));
  end
  R.readBack = got;
end

function failures = check_no_user(failures, text, label, user)
  % The account name, this MATLAB's matlabroot (scrub_matlabroot), and any absolute path.
  if ~isempty(user) && contains(text, user)
    failures{end + 1} = sprintf('%s names the account that saved it', label);
  end
  if contains(text, matlabroot)
    failures{end + 1} = sprintf('%s holds the matlabroot of the MATLAB that saved it', label);
  end
  hit = regexp(text, '/System/Volume[s]|/User[s]/|mathworks/deve[l]|jobarchiv[e]|sandbo[x]', 'match', 'once');
  if ~isempty(hit)
    failures{end + 1} = sprintf('%s holds a path (%s)', label, hit);
  end
end

function write_json(path, T)
  fid = fopen(path, 'w');
  fwrite(fid, jsonencode(T, 'PrettyPrint', true), 'char');
  fclose(fid);
end
