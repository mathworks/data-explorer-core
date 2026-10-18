function make_complex_inf_fixtures()
  % Copyright 2026 The MathWorks, Inc.
  % Authors the fixtures for a complex value with an infinite part, read out of MAT
  % bytes: a plain .mat variable, and a text dictionary, which holds such a value as a
  % MAT stream; with a binary dictionary of the same entries as the twin, whose
  % `<P IsComplex="1">` body is MATLAB's own text. Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<repo>/test/fixtures/complex_inf'); make_complex_inf_fixtures"
  %
  % Verify by the WROTE lines and the trailing MAKE_COMPLEX_INF_FIXTURES_DONE, not by
  % the exit code; a FAIL line above it means a file says something other than this
  % header promises.
  %
  % Writes four files into this folder:
  %   complex_inf.mat          MATLAB's default `save` format, Level 5
  %   complex_inf_text.sldd    the same values as entries, FileFormat 'uncompressed-text'
  %   complex_inf_binary.sldd  the same entries, FileFormat 'compressed-binary'
  %   complex_inf.truth.json   MATLAB's answers: per value, its class, size, disp and
  %                            mat2str (of a cell's element, mat2str refusing a cell;
  %                            of full() of a sparse one), and per venue whether MATLAB
  %                            reads the file back as the value it wrote (readBack,
  %                            isequaln and the same class) and the mat2str of what it
  %                            reads (readBackMat2str)
  %
  % MATLAB does not read its own binary dictionary's zInfRow back as the value it wrote:
  % it writes complex(1, NaN) as `1.0NaNi`, with no sign before the NaN, and its reader
  % takes `1.0NaNi -Inf+2.0i` for two real elements, as it does complex_binary.sldd's
  % pNonFinite (make_complex_fixtures.m). That one is recorded, not a FAIL; any other
  % value read back otherwise is.
  %
  % Each dictionary's entries record `modifiedby` from USER, so USER is set to a fixed
  % word while they are written and restored afterwards, and every file (every part of
  % the binary one) is searched for the account name; a hit is a FAIL.
  here = fileparts(mfilename('fullpath'));
  failures = {};
  V = values();
  names = fieldnames(V)';

  matPath = fullfile(here, 'complex_inf.mat');
  if isfile(matPath), delete(matPath); end
  save(matPath, '-struct', 'V');
  failures = check_no_user(failures, matPath, getenv('USER'));
  fprintf('WROTE complex_inf.mat bytes=%d\n', dir(matPath).bytes);
  L = load(matPath);
  [readBack.mat, readBackMat2str.mat] = read_back(V, L);

  formats = {'complex_inf_text.sldd', 'uncompressed-text', 'text'; 'complex_inf_binary.sldd', 'compressed-binary', 'binary'};
  for f = 1:size(formats, 1)
    [L, failures] = write_sldd(here, formats{f, 1}, formats{f, 2}, V, failures);
    [readBack.(formats{f, 3}), readBackMat2str.(formats{f, 3})] = read_back(V, L);
  end

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.values = struct();
  for i = 1:numel(names)
    v = V.(names{i});
    t = struct('class', class(v), 'size', size(v), 'disp', strtrim(evalc('disp(v)')));
    if iscell(v)
      t.elementMat2str = mat2str(v{1});
    else
      t.mat2str = mat2str(full(v));
    end
    T.values.(names{i}) = t;
    fprintf('VALUE %-10s %s\n', names{i}, t.disp);
  end
  T.readBack = readBack;
  T.readBackMat2str = readBackMat2str;
  fid = fopen(fullfile(here, 'complex_inf.truth.json'), 'w');
  fprintf(fid, '%s\n', jsonencode(T, 'PrettyPrint', true));
  fclose(fid);
  fprintf('WROTE complex_inf.truth.json\n');

  for v = fieldnames(readBack)'
    for n = names
      known = strcmp(v{1}, 'binary') && strcmp(n{1}, 'zInfRow');
      if ~readBack.(v{1}).(n{1}) && ~known
        failures{end + 1} = sprintf('%s: MATLAB reads %s back as another value', v{1}, n{1}); %#ok<AGROW>
      end
    end
  end
  for i = 1:numel(failures)
    fprintf('FAIL %s\n', failures{i});
  end
  fprintf('MAKE_COMPLEX_INF_FIXTURES_DONE failures=%d\n', numel(failures));
end

function V = values()
  % The values, by name. zInfRow is complex.sldd's pNonFinite as a plain value.
  V = struct();
  V.zInf = complex(1, Inf);
  V.zInfRow = [complex(Inf, -Inf) complex(NaN, 1) complex(1, NaN) complex(-Inf, 2)];
  V.zInfCell = {complex(1, Inf)};
  V.zInfSparse = sparse([1 2], [2 1], [complex(1, Inf) complex(-Inf, 2)], 2, 2);
end

function [r, m] = read_back(V, L)
  r = struct();
  m = struct();
  for n = fieldnames(V)'
    r.(n{1}) = isfield(L, n{1}) && isequaln(L.(n{1}), V.(n{1})) && strcmp(class(L.(n{1})), class(V.(n{1})));
    if ~isfield(L, n{1})
      m.(n{1}) = '';
    elseif iscell(L.(n{1}))
      m.(n{1}) = ['{' mat2str(L.(n{1}){1}) '}'];
    else
      m.(n{1}) = mat2str(full(L.(n{1})));
    end
  end
end

function [L, failures] = write_sldd(here, ddName, format, V, failures)
  ddPath = fullfile(here, ddName);
  Simulink.data.dictionary.closeAll('-discard');
  if isfile(ddPath), delete(ddPath); end
  oldUser = getenv('USER');
  setenv('USER', 'fixture');
  restoreUser = onCleanup(@() setenv('USER', oldUser));
  dd = Simulink.data.dictionary.create(ddPath);
  ds = getSection(dd, 'Design Data');
  for n = fieldnames(V)'
    addEntry(ds, n{1}, V.(n{1}));
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
    tmp = tempname;
    unzip(ddPath, tmp);
    parts = dir(fullfile(tmp, '**', '*'));
    for p = parts(~[parts.isdir])'
      failures = check_no_user(failures, fullfile(p.folder, p.name), oldUser, [ddName ' part ' p.name]);
    end
    rmdir(tmp, 's');
  else
    failures = check_no_user(failures, ddPath, oldUser);
  end
  fprintf('WROTE %s bytes=%d\n', ddName, dir(ddPath).bytes);
  dd = Simulink.data.dictionary.open(ddPath);
  if ~strcmp(dd.FileFormat, format)
    failures{end + 1} = sprintf('%s reopens as FileFormat %s', ddName, dd.FileFormat);
  end
  ds = getSection(dd, 'Design Data');
  L = struct();
  for n = fieldnames(V)'
    L.(n{1}) = getValue(getEntry(ds, n{1}));
  end
  clear ds
  close(dd);
  clear dd
  Simulink.data.dictionary.closeAll('-discard');
end

function failures = check_no_user(failures, path, user, label)
  if nargin < 4
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
