function make_char_rowdim(outDir, phase)
  % Copyright 2026 The MathWorks, Inc.
  % Authors char_rowdim_binary.sldd: when MATLAB states a Dimension on a 1xN char row in a
  % binary dictionary. test/charRowDimension.test.ts holds the binary writers to it. Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_char_rowdim"
  %
  % (One line: mw splits a -batch argument on newlines. Verify by the WROTE lines and the
  % trailing MAKE_CHAR_ROWDIM_DONE; any FAIL line means a file says something other than
  % this header promises.) `outDir` defaults to this folder. `phase` is 'write', 'read' or
  % (the default) both: 'read' alone re-reads the dictionary in a fresh MATLAB.
  %
  % Writes:
  %   char_rowdim_binary.sldd   the values below, FileFormat 'compressed-binary'
  %   char_rowdim.truth.json    MATLAB's reading of it, and of a copy whose chunk has every
  %                             1xN row Dimension taken out and one added to a 100-char row
  %                             (char_rowdim_patched.sldd, left in tempdir, not committed)
  %
  % WHAT IT MEASURES. MATLAB writes `<P Name="Value" Class="char" Dimension="1*513">` on a
  % 1xN char row whose N is over 512, and no Dimension on one of 512 or fewer. N is the
  % count of MATLAB char elements (UTF-16 code units), not of the bytes the file holds. A
  % newline, a CRLF, or an `&` or `<` the file escapes does not change it. The values put
  % that at every place a char row goes: an entry's Value, a cell element, a struct field, a
  % struct in a cell and a cell in a struct, a Simulink.Parameter's Description, a string's
  % element (the saveobj cell of chars a string is written as), and the char, cell, struct
  % and string properties of a plain MCOS object (Widget, in ./mcos; its other properties
  % stay at the sentinel 0, and it is in Other Data, since Design Data refuses it).
  %
  % THE TRUTH, per file and entry: the class and size MATLAB reads, and `same`, whether the
  % value read is the value written (isequal). Each file is read from a copy at a path
  % MATLAB has not opened, after closeAll. The patched copy is the reason the measurement is
  % byte fidelity only: with the Dimension gone from every row that had one, every value
  % still reads back the same, and a Dimension="1*100" on a row of 100 reads as 1x100.
  %
  % NO ACCOUNT NAME IN THE FILE: USER is set to 'fixture' while the dictionary is written
  % (it is each entry's LastModBy), and the zip's parts are searched for the account name;
  % a hit is a FAIL.
  here = fileparts(mfilename('fullpath'));
  if nargin < 1 || isempty(outDir)
    outDir = here;
  end
  if nargin < 2 || isempty(phase)
    phase = 'both';
  end
  addpath(fullfile(here, 'mcos'));
  failures = {};
  user = getenv('USER');
  if strcmp(user, 'fixture')
    user = '';
  end

  a = @(n) repmat('a', 1, n);
  e = @(n) repmat(char(233), 1, n);
  nl600 = [a(299) newline repmat('b', 1, 300)];
  amp512 = repmat('&<', 1, 256);
  amp513 = [amp512 '>'];
  crlf513 = [a(255) char([13 10]) a(256)];
  p512 = Simulink.Parameter(1); p512.Description = repmat('d', 1, 512);
  p513 = Simulink.Parameter(2); p513.Description = repmat('d', 1, 513);
  pnl = Simulink.Parameter(3); pnl.Description = nl600;
  w = Widget;
  w.Padded = a(513);
  w.Str = string(a(513));
  w.Nested = struct('f512', a(512), 'f513', a(513));
  w.Cells = {a(512), a(513), e(513)};
  V = {'rd_1', a(1); 'rd_100', a(100); 'rd_511', a(511); 'rd_512', a(512); ...
       'rd_513', a(513); 'rd_600', a(600); 'rd_4096', a(4096); ...
       'rd_e512', e(512); 'rd_e513', e(513); 'rd_nl100', [a(50) newline a(49)]; ...
       'rd_nl600', nl600; 'rd_amp512', amp512; 'rd_amp513', amp513; 'rd_crlf513', crlf513; ...
       'rd_cell', {a(512), a(513), e(513), nl600, 'short'}; ...
       'rd_struct', struct('f512', a(512), 'f513', a(513), 'fe513', e(513), 'fnl600', nl600); ...
       'rd_cellOfStruct', {struct('f513', a(513))}; ...
       'rd_structOfCell', struct('c', {{a(512), a(513)}}); ...
       'rd_p512', p512; 'rd_p513', p513; 'rd_pnl600', pnl; ...
       'rd_str513', string(a(513)); 'rd_strArr', [string(a(512)) string(a(513))]; ...
       'rd_widget', w};
  ddName = 'char_rowdim_binary.sldd';
  ddPath = fullfile(outDir, ddName);

  if any(strcmp(phase, {'write', 'both'}))
    Simulink.data.dictionary.closeAll('-discard');
    setenv('USER', 'fixture');
    restoreUser = onCleanup(@() setenv('USER', user));
    if exist(ddPath, 'file'), delete(ddPath); end
    dd = Simulink.data.dictionary.create(ddPath);
    dd.FileFormat = 'compressed-binary';
    for i = 1:size(V, 1)
      try
        addEntry(getSection(dd, sectionOf(V{i, 1})), V{i, 1}, V{i, 2});
      catch err
        failures{end + 1} = sprintf('%s refused: %s', V{i, 1}, strrep(err.message, newline, ' ')); %#ok<AGROW>
      end
    end
    saveChanges(dd); close(dd);
    Simulink.data.dictionary.closeAll('-discard');
    clear restoreUser;
    fprintf('WROTE %s bytes=%d\n', ddName, dir(ddPath).bytes);
  end

  if ~any(strcmp(phase, {'read', 'both'}))
    report(failures);
    return;
  end

  % The patched copy: every 1xN row Dimension of a text char out, one on rd_100 in.
  tmp = tempname; mkdir(tmp);
  unzip(ddPath, tmp);
  chunk = fullfile(tmp, 'data', 'chunk0.xml');
  x = fileread(chunk);
  removed = numel(regexp(x, 'Class="char" Dimension="1\*\d+"(?! Format)', 'match'));
  x2 = regexprep(x, '(Class="char") Dimension="1\*\d+"(?! Format)', '$1');
  x2 = regexprep(x2, '(<P Name="Value" Class="char")>(a{100})<', '$1 Dimension="1*100">$2<');
  if removed == 0 || isempty(regexp(x2, 'Dimension="1\*100"', 'once'))
    failures{end + 1} = 'the patched copy did not change as intended';
  end
  fid = fopen(chunk, 'w', 'n', 'UTF-8'); fwrite(fid, x2, 'char'); fclose(fid);
  patched = fullfile(tempdir, 'char_rowdim_patched.sldd');
  rezip(tmp, patched);
  rmdir(tmp, 's');
  fprintf('PATCHED removed=%d added100=1 -> %s\n', removed, patched);

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.patchedRemoved = removed;
  T.files = struct('file', {}, 'entries', {});
  sources = {ddPath, 'char_rowdim_binary.sldd'; patched, 'char_rowdim_patched.sldd'};
  for f = 1:size(sources, 1)
    Simulink.data.dictionary.closeAll('-discard');
    copyDir = tempname; mkdir(copyDir);
    copyPath = fullfile(copyDir, ['fresh_' sources{f, 2}]);
    copyfile(sources{f, 1}, copyPath);
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
    T.files(end + 1) = struct('file', sources{f, 2}, 'entries', E);
    fprintf('READ %s: %s\n', sources{f, 2}, strjoin(arrayfun(@(t) sprintf('%s=%s%s', t.name, ...
            mat2str(t.size), mark(t.same)), E, 'UniformOutput', false), ' '));
  end

  % No account name in any part of the zip.
  tmp = tempname; mkdir(tmp);
  unzip(ddPath, tmp);
  parts = dir(fullfile(tmp, '**', '*'));
  texts = {};
  for i = 1:numel(parts)
    if ~parts(i).isdir
      texts{end + 1} = fileread(fullfile(parts(i).folder, parts(i).name)); %#ok<AGROW>
    end
  end
  rmdir(tmp, 's');
  if ~isempty(user) && any(cellfun(@(t) contains(t, user), texts))
    failures{end + 1} = 'a file holds the account name';
  end

  fid = fopen(fullfile(outDir, 'char_rowdim.truth.json'), 'w', 'n', 'UTF-8');
  fwrite(fid, jsonencode(T, 'PrettyPrint', true), 'char');
  fclose(fid);
  fprintf('WROTE char_rowdim.truth.json\n');
  report(failures);
end

function report(failures)
  if isempty(failures)
    fprintf('MAKE_CHAR_ROWDIM_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_CHAR_ROWDIM_FAILED %d\n', numel(failures));
  end
end

function s = sectionOf(name)
  % Design Data refuses a plain MCOS object, so the Widget goes where MATLAB takes one.
  s = 'Design Data';
  if strcmp(name, 'rd_widget')
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
