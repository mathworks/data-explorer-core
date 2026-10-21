function make_stream_objects(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors the fixtures for editing an object INSIDE a dictionary entry's MAT stream: a
  % compressed-binary dictionary writes an entry's whole Value as Encoding="hex"
  % (getByteStreamFromArray of it) when the value holds something its XML cannot spell, a
  % sparse array or a function handle, and every Simulink.Parameter or Simulink.Signal in
  % the value rides in the stream's subsystem. Run:
  %
  %   matlab -nodesktop -batch "cd('<repo>/test/fixtures/sldd-stream-objects'); make_stream_objects"
  %
  % Writes, in `outDir` (default: this folder):
  %   stream_objects_binary.sldd  the entries below, FileFormat 'compressed-binary'
  %   stream_objects_text.sldd    plainP and plainS only, FileFormat 'uncompressed-text': what
  %                               the tests paste the binary's stream entries into, as this
  %                               package pastes one (the cdata of the same stream)
  %   stream_objects.truth.json   each binary entry's Value tag, and what MATLAB reads back
  %
  % THE ENTRIES (Design Data). Each stream entry holds a sparse array beside its objects, so
  % MATLAB writes it as hex (Design Data refuses a function handle, the other value that forces
  % it, at the top of an entry); the properties the tests edit are set away from their class
  % defaults, so MATLAB stores a value for each.
  %   sPh      struct: p (Parameter 5: Description 'd', Min 0, Max 10, DocUnits 'm'), q 5, sp sparse
  %   cPh      cell: {Parameter [1 2 3] (Description 'c'), sparse}
  %   sTh      struct: t (Parameter single(2.5), DataType 'single', Max 100), sp sparse
  %   pSp      Parameter whose Value is sparse: Description 'd', Min -1, Max 10
  %   sigH     struct: sig (Signal: Description 's', DocUnits 'V', Min -5, Max 5, DataType 'double'), sp
  %   shared   struct: a and b the one Parameter handle (4, Description 'shared'), sp
  %   arr      struct: ps a 1x2 Parameter array (1 and 2, Descriptions 'one' and 'two'), sp
  %   nested   struct: inner.p (Parameter int16(3), Description 'n'), sp
  %   pStruct  struct: p (Parameter whose Value is struct('a', 1, 'b', [2 3])), sp
  %   plainP   Parameter 9, Description 'plain': no sparse, so native XML (a control)
  %   plainS   struct('x', 1): native XML (a control)
  %
  % NO ACCOUNT NAME AND NO PATH IN ANY FILE: USER is 'fixture' while a dictionary is written,
  % and every zip part and every hex value, decoded, is searched for the account name,
  % matlabroot and an absolute path; a hit is a FAIL.
  if nargin < 1 || isempty(outDir)
    outDir = fileparts(mfilename('fullpath'));
  end
  fprintf('VERSION %s\n', version);
  failures = {};
  user = getenv('USER');

  V = build_values();
  T = struct('version', version, 'release', version('-release'));
  [T.binary, failures] = write_dd(outDir, 'stream_objects_binary.sldd', 'compressed-binary', V, fieldnames(V)', failures, user);
  P = struct('plainP', V.plainP, 'plainS', V.plainS);
  [T.text, failures] = write_dd(outDir, 'stream_objects_text.sldd', 'uncompressed-text', P, fieldnames(P)', failures, user);
  fid = fopen(fullfile(outDir, 'stream_objects.truth.json'), 'w');
  fwrite(fid, jsonencode(T, 'PrettyPrint', true), 'char');
  fclose(fid);
  fprintf('WROTE stream_objects.truth.json\n');
  if isempty(failures)
    fprintf('MAKE_STREAM_OBJECTS_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_STREAM_OBJECTS_FAILED %d\n', numel(failures));
  end
end

function V = build_values()
  V = struct();
  p = Simulink.Parameter(5); p.Description = 'd'; p.Min = 0; p.Max = 10; p.DocUnits = 'm';
  V.sPh = struct('p', p, 'q', 5, 'sp', sparse([0 7]));
  c = Simulink.Parameter([1 2 3]); c.Description = 'c';
  V.cPh = {c, sparse([0 1 0])};
  t = Simulink.Parameter; t.Value = single(2.5); t.DataType = 'single'; t.Max = 100;
  V.sTh = struct('t', t, 'sp', sparse([0 1]));
  ps = Simulink.Parameter(sparse([0 7])); ps.Description = 'd'; ps.Min = -1; ps.Max = 10;
  V.pSp = ps;
  g = Simulink.Signal; g.Description = 's'; g.DocUnits = 'V'; g.Min = -5; g.Max = 5; g.DataType = 'double';
  V.sigH = struct('sig', g, 'sp', sparse([0 1]));
  h = Simulink.Parameter(4); h.Description = 'shared';
  V.shared = struct('a', h, 'b', h, 'sp', sparse([0 1]));
  a1 = Simulink.Parameter(1); a1.Description = 'one';
  a2 = Simulink.Parameter(2); a2.Description = 'two';
  V.arr = struct('ps', [a1 a2], 'sp', sparse([0 1]));
  n = Simulink.Parameter(int16(3)); n.Description = 'n';
  V.nested = struct('inner', struct('p', n), 'sp', sparse([0 1]));
  V.pStruct = struct('p', Simulink.Parameter(struct('a', 1, 'b', [2 3])), 'sp', sparse([0 1]));
  q = Simulink.Parameter(9); q.Description = 'plain';
  V.plainP = q;
  V.plainS = struct('x', 1);
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
    [R.valueTags, failures] = value_tags(ddPath, ddName, failures, user);
  else
    failures = check_no_user(failures, fileread(ddPath), ddName, user);
  end
  fprintf('WROTE %s bytes=%d\n', ddName, dir(ddPath).bytes);

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

function d = describe(x)
  % Class and size, and per object the properties the tests edit.
  d = struct('class', class(x), 'size', size(x));
  if isa(x, 'Simulink.Parameter') || isa(x, 'Simulink.Signal')
    for k = 1:numel(x)
      e = struct('Description', x(k).Description, 'DocUnits', x(k).DocUnits, 'Min', x(k).Min, 'Max', x(k).Max, ...
        'DataType', x(k).DataType);
      if isa(x, 'Simulink.Parameter')
        e.ValueClass = class(x(k).Value);
        e.ValueIssparse = issparse(x(k).Value);
      end
      d.objects(k) = e;
    end
  elseif isstruct(x)
    for f = fieldnames(x)'
      d.fields.(f{1}) = describe(x.(f{1}));
    end
  elseif iscell(x)
    d.elements = cellfun(@describe, x, 'UniformOutput', false);
  else
    d.issparse = issparse(x);
  end
end

function [tags, failures] = value_tags(ddPath, ddName, failures, user)
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
      bytes = uint8(sscanf(regexprep(body{1}, '\s', ''), '%2x'));
      failures = check_no_user(failures, char(bytes'), [ddName ' hex of ' name{1}], user);
    end
  end
end

function failures = check_no_user(failures, text, label, user)
  if ~isempty(user) && contains(text, user)
    failures{end + 1} = sprintf('%s names the account that saved it', label);
  end
  if contains(text, matlabroot)
    failures{end + 1} = sprintf('%s holds the matlabroot of the MATLAB that saved it', label);
  end
  hit = regexp(text, '/System/Volume[s]|/User[s]/|/hom[e]/|mathworks/deve[l]|jobarchiv[e]|sandbo[x]', 'match', 'once');
  if ~isempty(hit)
    failures{end + 1} = sprintf('%s holds a path (%s)', label, hit);
  end
end
