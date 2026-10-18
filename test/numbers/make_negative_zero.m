function make_negative_zero(outDir, phase)
  % Copyright 2026 The MathWorks, Inc.
  % Authors the -0 fixtures: how MATLAB writes a negative zero into each flavour of data
  % dictionary, and which text spellings of one it reads back as -0.
  % test/negativeZero.test.ts holds this package's text literals to them. Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_negative_zero"
  %
  % (One line: mw splits a -batch argument on newlines. Verify by the WROTE lines and the
  % trailing MAKE_NEGATIVE_ZERO_DONE; any FAIL line means a file says something other than
  % this header promises.) `outDir` defaults to this folder. `phase` is 'write', 'read' or
  % (the default) both: 'read' alone re-reads the dictionaries in a fresh MATLAB.
  %
  % Writes:
  %   negzero_binary.sldd    the values below, FileFormat 'compressed-binary'
  %   negzero_text.sldd      the same values, FileFormat 'uncompressed-text'
  %   negzero_spelled.sldd   negzero_text.sldd with each single literal respelled the way
  %                          this package writes one (XmlUtils.formatNumLiteral): `-0.0F`
  %                          as `-0F` and `1.0F` as `1F`. Nothing else in it changes.
  %   negzero.truth.json     MATLAB's reading of each of the three, entry by entry
  %
  % THE VALUES (Design Data): a double -0 bare, in a row, a column, a 2x2 matrix, a row
  % beside Inf, a cell and a struct field, and as a Parameter's Value; a single -0 bare, in
  % a row, a column and a cell; and a +0 double and single as the controls.
  %
  % THE TRUTH, per file and entry: the class and size MATLAB reads, `negative`, which
  % elements (column-major) are -0 by their sign bit, and `same`, whether the value is the
  % one written, -0 compared as +0 (so a lost sign is not a different value here). Each file
  % is read from a copy at a path MATLAB has not opened, after closeAll: a dictionary
  % reopened at its own path can be answered from what MATLAB already holds, which once
  % read a `0` it had just written back as the -0 it was given. The +0 controls and the
  % bare -0 a text file spells `0` are what show a read came from the file.
  %
  % NO ACCOUNT NAME IN ANY FILE: USER is set to 'fixture' while a dictionary is written (it
  % is the entry's LastModBy, and `modifiedby` in text), and the files and the binary zip's
  % parts are searched for the account name; a hit is a FAIL.
  if nargin < 1 || isempty(outDir)
    outDir = fileparts(mfilename('fullpath'));
  end
  if nargin < 2 || isempty(phase)
    phase = 'both';
  end
  failures = {};
  user = getenv('USER');
  if strcmp(user, 'fixture')
    user = '';
  end

  p = Simulink.Parameter(-0);
  V = {'negz', -0; 'negzRow', [-0 1]; 'negzCol', [-0; 1]; 'negzMat', [-0 1; 2 3]; ...
       'negzInfRow', [-0 Inf]; 'negzCell', {-0}; 'negzStruct', struct('a', -0); 'negzP', p; ...
       'negzS', single(-0); 'negzSRow', single([-0 1]); 'negzSCol', single([-0; 1]); ...
       'negzSCell', {single(-0)}; 'posz', 0; 'poszS', single(0)};
  files = {'negzero_binary.sldd', 'compressed-binary'; 'negzero_text.sldd', 'uncompressed-text'};

  if any(strcmp(phase, {'write', 'both'}))
    Simulink.data.dictionary.closeAll('-discard');
    setenv('USER', 'fixture');
    restoreUser = onCleanup(@() setenv('USER', user));
    for f = 1:size(files, 1)
      ddPath = fullfile(outDir, files{f, 1});
      if exist(ddPath, 'file'), delete(ddPath); end
      dd = Simulink.data.dictionary.create(ddPath);
      dd.FileFormat = files{f, 2};
      ds = getSection(dd, 'Design Data');
      for i = 1:size(V, 1)
        addEntry(ds, V{i, 1}, V{i, 2});
      end
      saveChanges(dd); close(dd);
      Simulink.data.dictionary.closeAll('-discard');
      fprintf('WROTE %s bytes=%d\n', files{f, 1}, dir(ddPath).bytes);
    end
    clear restoreUser;

    % This package's spelling of a single literal, in MATLAB's own file.
    txt = fileread(fullfile(outDir, 'negzero_text.sldd'));
    spelled = regexprep(txt, '(-?\d+)\.0F\>', '$1F');
    if strcmp(spelled, txt) || contains(spelled, '.0F')
      failures{end + 1} = 'negzero_spelled.sldd: the single literals were not respelled';
    end
    fid = fopen(fullfile(outDir, 'negzero_spelled.sldd'), 'w', 'n', 'UTF-8');
    fwrite(fid, spelled, 'char');
    fclose(fid);
    fprintf('WROTE negzero_spelled.sldd bytes=%d\n', dir(fullfile(outDir, 'negzero_spelled.sldd')).bytes);
  end

  if ~any(strcmp(phase, {'read', 'both'}))
    report(failures);
    return;
  end

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.files = struct('file', {}, 'entries', {});
  names = [files(:, 1); {'negzero_spelled.sldd'}];
  for f = 1:numel(names)
    Simulink.data.dictionary.closeAll('-discard');
    copyDir = tempname; mkdir(copyDir);
    copyPath = fullfile(copyDir, ['fresh_' names{f}]);
    copyfile(fullfile(outDir, names{f}), copyPath);
    dd = Simulink.data.dictionary.open(copyPath);
    ds = getSection(dd, 'Design Data');
    E = struct('name', {}, 'class', {}, 'size', {}, 'negative', {}, 'same', {});
    for i = 1:size(V, 1)
      v = getValue(getEntry(ds, V{i, 1}));
      w = V{i, 2};
      [x, y] = deal(numbersOf(v), numbersOf(w));
      e = struct('name', V{i, 1}, 'class', class(v), 'size', size(v), ...
                 'negative', {num2cell(x == 0 & 1 ./ x < 0)}, ...
                 'same', strcmp(class(v), class(w)) && isequal(size(v), size(w)) && isequal(x, y));
      if ~e.same
        failures{end + 1} = sprintf('%s: %s read back as another value than was written', names{f}, V{i, 1}); %#ok<AGROW>
      end
      E(end + 1) = e; %#ok<AGROW>
    end
    close(dd);
    Simulink.data.dictionary.closeAll('-discard');
    rmdir(copyDir, 's');
    T.files(end + 1) = struct('file', names{f}, 'entries', E);
    fprintf('READ %s: %s\n', names{f}, strjoin(arrayfun(@(e) sprintf('%s=%s', e.name, ...
            mat2str([e.negative{:}])), E, 'UniformOutput', false), ' '));
  end

  % The controls: a +0 is +0 everywhere, and a text file's bare `0` for -0 reads back +0
  % (were it -0, the read did not come from the file).
  for f = 1:numel(T.files)
    for e = T.files(f).entries
      if startsWith(e.name, 'posz') && any([e.negative{:}])
        failures{end + 1} = sprintf('%s: %s, a +0, read back as -0', T.files(f).file, e.name); %#ok<AGROW>
      end
    end
  end
  textNegz = T.files(2).entries(strcmp({T.files(2).entries.name}, 'negz'));
  if textNegz.negative{1}
    failures{end + 1} = 'negzero_text.sldd: the bare -0 read back as -0, so the read was not fresh';
  end

  % No account name in any file, nor in any part of the binary zip.
  texts = {fileread(fullfile(outDir, 'negzero_text.sldd')), fileread(fullfile(outDir, 'negzero_spelled.sldd'))};
  tmp = tempname; mkdir(tmp);
  unzip(fullfile(outDir, 'negzero_binary.sldd'), tmp);
  parts = dir(fullfile(tmp, '**', '*'));
  for i = 1:numel(parts)
    if ~parts(i).isdir
      texts{end + 1} = fileread(fullfile(parts(i).folder, parts(i).name)); %#ok<AGROW>
    end
  end
  rmdir(tmp, 's');
  if ~isempty(user) && any(cellfun(@(t) contains(t, user), texts))
    failures{end + 1} = 'a file holds the account name';
  end

  fid = fopen(fullfile(outDir, 'negzero.truth.json'), 'w', 'n', 'UTF-8');
  fwrite(fid, jsonencode(T, 'PrettyPrint', true), 'char');
  fclose(fid);
  fprintf('WROTE negzero.truth.json\n');
  report(failures);
end

function report(failures)
  if isempty(failures)
    fprintf('MAKE_NEGATIVE_ZERO_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_NEGATIVE_ZERO_FAILED %d\n', numel(failures));
  end
end

function x = numbersOf(v)
  % The numbers a value holds, column-major, as doubles: a cell's elements, a struct's
  % field, a Parameter's Value.
  if iscell(v)
    x = cell2mat(cellfun(@numbersOf, v(:)', 'UniformOutput', false));
  elseif isstruct(v)
    x = numbersOf(v(1).a);
  elseif isa(v, 'Simulink.Parameter')
    x = numbersOf(v.Value);
  else
    x = double(v(:)');
  end
end
