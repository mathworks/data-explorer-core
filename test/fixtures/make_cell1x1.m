function make_cell1x1(outDir, phase, oursPath)
  % Copyright 2026 The MathWorks, Inc.
  % Authors cell1x1_binary.sldd and cell1x1_text.sldd: where MATLAB states the Dimension of a
  % 1x1 cell. test/cellOneByOneDimension.test.ts holds the writers to it. Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_cell1x1"
  %
  % (One line: mw splits a -batch argument on newlines. Verify by the WROTE lines and the
  % trailing MAKE_CELL1X1_DONE; any FAIL line means a file says something other than this
  % header promises.) `outDir` defaults to this folder. `phase` is 'write', 'read' or (the
  % default) both. 'read' re-reads the dictionaries in a fresh MATLAB, and with `oursPath`
  % it also reads that file: cell1x1_binary.sldd with every entry written by core
  % (cellOneByOneDimension.test.ts says how to make it).
  %
  % Writes:
  %   cell1x1_binary.sldd   the values below, FileFormat 'compressed-binary'
  %   cell1x1_text.sldd     the same values, FileFormat 'uncompressed-text'
  %   cell1x1.truth.json    MATLAB's reading of the binary file, of a copy of it with
  %                         Dimension="1*1" added to every cell that has none (the spelling
  %                         core's writers gave a 1x1 cell before), and of `oursPath`; and
  %                         every cell open tag in the chunk of each
  %
  % WHAT IT MEASURES. A 1x1 cell at each place a cell goes: an entry's Value (holding a
  % double, a char, a string, an object, an empty and a cell), a cell element (nested to two
  % levels), a struct field, a field of each element of a struct array, a field of a struct
  % in a cell, and the cell and struct properties of a plain MCOS object (Widget, in ./mcos;
  % its other properties stay at the sentinel 0, and it is in Other Data, since Design Data
  % refuses it). The controls are a 1x2, a 2x1 and a 0x0 cell. MATLAB writes no Dimension on
  % a 1x1 cell in a binary dictionary, at any of these places, and `_dimensions` [1, 1] on
  % every one in a text dictionary.
  %
  % THE TRUTH, per file and entry: the class and size MATLAB reads, and `same`, whether the
  % value read is the value written (isequal). Each file is read from a copy at a path
  % MATLAB has not opened, after closeAll.
  %
  % NO ACCOUNT NAME IN THE FILE: USER is set to 'fixture' while the dictionaries are written
  % (it is each entry's LastModBy), and the zip's parts are searched for the account name; a
  % hit is a FAIL.
  here = fileparts(mfilename('fullpath'));
  if nargin < 1 || isempty(outDir)
    outDir = here;
  end
  if nargin < 2 || isempty(phase)
    phase = 'both';
  end
  if nargin < 3
    oursPath = '';
  end
  addpath(fullfile(here, 'mcos'));
  failures = {};
  user = getenv('USER');
  if strcmp(user, 'fixture')
    user = '';
  end

  w = Widget;
  w.Cells = {9};
  w.Nested = struct('c', {{10}});
  V = {'c11', {1}; 'c11char', {'ab'}; 'c11str', {"a"}; 'c11obj', {Simulink.Parameter(3)}; ...
       'c11empty', {[]}; 'c11cell', {{2}}; 'cNest', {1, {2, {3}}}; ...
       'c12', {1, 2}; 'c21', {1; 2}; 'c0', {}; ...
       's11', struct('c', {{4}}); 'sNest', struct('a', 1, 'c', {{{5}}}); ...
       'sArr', struct('c', {{7}, {8}}); 'cOfS', {struct('c', {{6}})}; ...
       'widget', w};
  formats = {'compressed-binary', 'cell1x1_binary.sldd'; 'uncompressed-text', 'cell1x1_text.sldd'};
  ddPath = fullfile(outDir, formats{1, 2});

  if any(strcmp(phase, {'write', 'both'}))
    setenv('USER', 'fixture');
    restoreUser = onCleanup(@() setenv('USER', user));
    for f = 1:size(formats, 1)
      Simulink.data.dictionary.closeAll('-discard');
      p = fullfile(outDir, formats{f, 2});
      if exist(p, 'file'), delete(p); end
      dd = Simulink.data.dictionary.create(p);
      dd.FileFormat = formats{f, 1};
      for i = 1:size(V, 1)
        try
          addEntry(getSection(dd, sectionOf(V{i, 1})), V{i, 1}, V{i, 2});
        catch err
          failures{end + 1} = sprintf('%s refused: %s', V{i, 1}, strrep(err.message, newline, ' ')); %#ok<AGROW>
        end
      end
      saveChanges(dd); close(dd);
      Simulink.data.dictionary.closeAll('-discard');
      fprintf('WROTE %s bytes=%d\n', formats{f, 2}, dir(p).bytes);
    end
    clear restoreUser;
  end

  if ~any(strcmp(phase, {'read', 'both'}))
    report(failures);
    return;
  end

  % The patched copy: Dimension="1*1" on every cell MATLAB wrote with none, a string's saveobj
  % cell aside (no writer of core's ever spelled one there).
  tmp = tempname; mkdir(tmp);
  unzip(ddPath, tmp);
  chunk = fullfile(tmp, 'data', 'chunk0.xml');
  x = fileread(chunk);
  pattern = '(<(?:P Name="[^"]*"|Element) Class="cell")>';
  added = numel(regexp(x, pattern, 'match'));
  x2 = regexprep(x, pattern, '$1 Dimension="1*1">');
  if added == 0
    failures{end + 1} = 'the patched copy did not change as intended';
  end
  fid = fopen(chunk, 'w', 'n', 'UTF-8'); fwrite(fid, x2, 'char'); fclose(fid);
  patched = fullfile(tempdir, 'cell1x1_patched.sldd');
  rezip(tmp, patched);
  rmdir(tmp, 's');
  fprintf('PATCHED added=%d -> %s\n', added, patched);

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.patchedAdded = added;
  T.files = struct('file', {}, 'cellTags', {}, 'entries', {});
  sources = {ddPath, 'cell1x1_binary.sldd'; fullfile(outDir, formats{2, 2}), 'cell1x1_text.sldd'; patched, 'cell1x1_patched.sldd'};
  if ~isempty(oursPath)
    sources(end + 1, :) = {oursPath, 'cell1x1_core.sldd'};
  end
  for f = 1:size(sources, 1)
    Simulink.data.dictionary.closeAll('-discard');
    copyDir = tempname; mkdir(copyDir);
    copyPath = fullfile(copyDir, ['fresh_' sources{f, 2}]);
    copyfile(sources{f, 1}, copyPath);
    tags = {};
    if ~contains(sources{f, 2}, '_text')
      unz = tempname; mkdir(unz);
      unzip(copyPath, unz);
      tags = regexp(fileread(fullfile(unz, 'data', 'chunk0.xml')), '<(?:P|Element)\s[^>]*Class="cell"[^>]*>', 'match');
      rmdir(unz, 's');
    end
    dd = Simulink.data.dictionary.open(copyPath);
    E = struct('name', {}, 'class', {}, 'size', {}, 'same', {});
    for i = 1:size(V, 1)
      try
        v = getValue(getEntry(getSection(dd, sectionOf(V{i, 1})), V{i, 1}));
      catch err
        failures{end + 1} = sprintf('%s: %s not read: %s', sources{f, 2}, V{i, 1}, err.message); %#ok<AGROW>
        continue;
      end
      ent = struct('name', V{i, 1}, 'class', class(v), 'size', size(v), 'same', isequal(v, V{i, 2}));
      if ~ent.same
        failures{end + 1} = sprintf('%s: %s read back as another value than was written', sources{f, 2}, V{i, 1}); %#ok<AGROW>
      end
      E(end + 1) = ent; %#ok<AGROW>
    end
    close(dd);
    Simulink.data.dictionary.closeAll('-discard');
    rmdir(copyDir, 's');
    T.files(end + 1) = struct('file', sources{f, 2}, 'cellTags', {tags}, 'entries', E);
    fprintf('READ %s: %s\n', sources{f, 2}, strjoin(arrayfun(@(t) sprintf('%s=%s%s', t.name, ...
            mat2str(t.size), mark(t.same)), E, 'UniformOutput', false), ' '));
  end

  % No account name in any part of either dictionary.
  for f = 1:size(formats, 1)
    p = fullfile(outDir, formats{f, 2});
    texts = {};
    if f == 1
      tmp = tempname; mkdir(tmp);
      unzip(p, tmp);
      parts = dir(fullfile(tmp, '**', '*'));
      for i = 1:numel(parts)
        if ~parts(i).isdir
          texts{end + 1} = fileread(fullfile(parts(i).folder, parts(i).name)); %#ok<AGROW>
        end
      end
      rmdir(tmp, 's');
    else
      texts = {fileread(p)};
    end
    if ~isempty(user) && any(cellfun(@(t) contains(t, user), texts))
      failures{end + 1} = sprintf('%s holds the account name', formats{f, 2}); %#ok<AGROW>
    end
  end

  fid = fopen(fullfile(outDir, 'cell1x1.truth.json'), 'w', 'n', 'UTF-8');
  fwrite(fid, jsonencode(T, 'PrettyPrint', true), 'char');
  fclose(fid);
  fprintf('WROTE cell1x1.truth.json\n');
  report(failures);
end

function report(failures)
  if isempty(failures)
    fprintf('MAKE_CELL1X1_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_CELL1X1_FAILED %d\n', numel(failures));
  end
end

function s = sectionOf(name)
  % Design Data refuses a plain MCOS object, so the Widget goes where MATLAB takes one.
  s = 'Design Data';
  if strcmp(name, 'widget')
    s = 'Other Data';
  end
end

function s = mark(same)
  % A read-back that is not the value written is flagged with a `!` in the READ line.
  s = '';
  if ~same
    s = '!';
  end
end

function rezip(folder, dest)
  % zip() takes the part names relative to `folder`, so the package keeps its layout.
  items = dir(folder); names = {items.name}; names = names(~ismember(names, {'.', '..'}));
  z = [tempname '.zip'];
  zip(z, names, folder);
  movefile(z, dest, 'f');
end
