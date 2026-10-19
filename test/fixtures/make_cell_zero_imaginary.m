function make_cell_zero_imaginary(outDir, phase, oursDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors cell_zero_imaginary_binary.sldd and cell_zero_imaginary_text.sldd: cells holding a
  % complex member whose imaginary part is 0, as MATLAB writes them, and reads back core's saves
  % of them. test/cellZeroImaginaryMember.test.ts holds core to them. Run (one line: mw splits a
  % -batch argument on newlines):
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_cell_zero_imaginary('<out dir>', 'write')"
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_cell_zero_imaginary('<out dir>', 'read', '<core saves dir>')"
  %
  % Verify by the WROTE and READ lines and the trailing MAKE_CELL_ZERO_IMAGINARY_DONE; any FAIL
  % line means a file says something other than this header promises. `outDir` defaults to this
  % folder. 'write' writes the two dictionaries; 'read' reads them back and, from `oursDir`, the
  % two dictionaries core saved after the edits below (make_cell_zero_imaginary_core.mjs makes
  % them), and writes cell_zero_imaginary.truth.json. Each file is read from a copy, under
  % `outDir`, at a path MATLAB has not opened, after closeAll.
  %
  % WHAT IT MEASURES. A cell's literal shows a complex member whose imaginary part is 0 as
  % `1+0i`, and MATLAB makes a real double of that text in a cell: `{1+0i, 5}` is {1, 5}. So a
  % save of the cell's whole literal, with only the 5 retyped, would write the member real. The
  % member is edited alone instead, and these are what is read back:
  %
  %   cZero      {complex(1,0), 5}     core's save: the 5 set to 6, as an element
  %   cZeroNeg   {complex(2,-0), 5}    the same; MATLAB keeps the imaginary part's -0
  %   cZeroNest  {{complex(1,0)}, 5}   the same; the complex member is in the nested cell
  %   cTwoI      {complex(1,2), 5}     control: core's save sets the whole literal {1+2i, 6}
  %
  % THE TRUTH, per file and entry: the class and size read, and each member as `describe`
  % spells it (its class, `complex` or `real`, and its parts, -0 kept), a nested cell's in braces.
  %
  % NO ACCOUNT NAME IN THE FILE: USER is set to 'fixture' while the dictionaries are written (it
  % is each entry's LastModBy), and every part of each is searched for the account name.
  here = fileparts(mfilename('fullpath'));
  if nargin < 1 || isempty(outDir)
    outDir = here;
  end
  if nargin < 2 || isempty(phase)
    phase = 'write';
  end
  if nargin < 3
    oursDir = '';
  end
  failures = {};
  user = getenv('USER');
  if strcmp(user, 'fixture')
    user = '';
  end

  V = {'cZero', {complex(1, 0), 5}; 'cZeroNeg', {complex(2, -0), 5}; ...
       'cZeroNest', {{complex(1, 0)}, 5}; 'cTwoI', {complex(1, 2), 5}};
  formats = {'compressed-binary', 'cell_zero_imaginary_binary.sldd'; 'uncompressed-text', 'cell_zero_imaginary_text.sldd'};

  if strcmp(phase, 'write')
    setenv('USER', 'fixture');
    restoreUser = onCleanup(@() setenv('USER', user));
    for f = 1:size(formats, 1)
      Simulink.data.dictionary.closeAll('-discard');
      p = fullfile(outDir, formats{f, 2});
      if exist(p, 'file'), delete(p); end
      dd = Simulink.data.dictionary.create(p);
      dd.FileFormat = formats{f, 1};
      for i = 1:size(V, 1)
        addEntry(getSection(dd, 'Design Data'), V{i, 1}, V{i, 2});
      end
      saveChanges(dd); close(dd);
      Simulink.data.dictionary.closeAll('-discard');
      fprintf('WROTE %s bytes=%d\n', formats{f, 2}, dir(p).bytes);
    end
    clear restoreUser;
    for f = 1:size(formats, 1)
      if ~isempty(user) && holdsText(fullfile(outDir, formats{f, 2}), user, f == 1, outDir)
        failures{end + 1} = sprintf('%s holds the account name', formats{f, 2}); %#ok<AGROW>
      end
    end
    report(failures);
    return;
  end

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.files = struct('file', {}, 'entries', {});
  sources = {fullfile(outDir, formats{1, 2}), formats{1, 2}; fullfile(outDir, formats{2, 2}), formats{2, 2}};
  if ~isempty(oursDir)
    sources(end + 1, :) = {fullfile(oursDir, 'cell_zero_imaginary_core_binary.sldd'), 'cell_zero_imaginary_core_binary.sldd'};
    sources(end + 1, :) = {fullfile(oursDir, 'cell_zero_imaginary_core_text.sldd'), 'cell_zero_imaginary_core_text.sldd'};
  end
  for f = 1:size(sources, 1)
    Simulink.data.dictionary.closeAll('-discard');
    copyDir = fullfile(outDir, sprintf('fresh_%d_%d', f, round(rand * 1e9)));
    mkdir(copyDir);
    copyPath = fullfile(copyDir, ['fresh_' sources{f, 2}]);
    copyfile(sources{f, 1}, copyPath);
    dd = Simulink.data.dictionary.open(copyPath);
    E = struct('name', {}, 'class', {}, 'size', {}, 'members', {});
    for i = 1:size(V, 1)
      try
        v = getValue(getEntry(getSection(dd, 'Design Data'), V{i, 1}));
      catch err
        failures{end + 1} = sprintf('%s: %s not read: %s', sources{f, 2}, V{i, 1}, err.message); %#ok<AGROW>
        continue;
      end
      members = {};
      if iscell(v)
        members = cellfun(@describe, v(:)', 'UniformOutput', false);
      end
      E(end + 1) = struct('name', V{i, 1}, 'class', class(v), 'size', size(v), 'members', {members}); %#ok<AGROW>
    end
    close(dd);
    Simulink.data.dictionary.closeAll('-discard');
    rmdir(copyDir, 's');
    T.files(end + 1) = struct('file', sources{f, 2}, 'entries', E);
    fprintf('READ %s: %s\n', sources{f, 2}, strjoin(arrayfun(@(t) sprintf('%s={%s}', t.name, ...
            strjoin(t.members, ', ')), E, 'UniformOutput', false), ' '));
  end

  fid = fopen(fullfile(outDir, 'cell_zero_imaginary.truth.json'), 'w', 'n', 'UTF-8');
  fwrite(fid, jsonencode(T, 'PrettyPrint', true), 'char');
  fclose(fid);
  fprintf('WROTE cell_zero_imaginary.truth.json\n');
  report(failures);
end

function s = describe(v)
  % `double complex 1 +0i`: the class, the complexity, and the parts by %g, which keeps a -0.
  if iscell(v)
    s = ['{' strjoin(cellfun(@describe, v(:)', 'UniformOutput', false), ', ') '}'];
    return;
  end
  if ~isnumeric(v) || ~isscalar(v)
    s = sprintf('%s %s', class(v), mat2str(size(v)));
    return;
  end
  if isreal(v)
    s = sprintf('%s real %g', class(v), v);
  else
    im = imag(v);
    sgn = '+';
    if im < 0 || (im == 0 && 1 / im < 0)
      sgn = '-';
    end
    s = sprintf('%s complex %g %s%gi', class(v), real(v), sgn, abs(im));
  end
end

function hit = holdsText(p, text, zipped, outDir)
  if zipped
    tmp = fullfile(outDir, sprintf('unz_%d', round(rand * 1e9)));
    mkdir(tmp);
    unzip(p, tmp);
    parts = dir(fullfile(tmp, '**', '*'));
    hit = false;
    for i = 1:numel(parts)
      if ~parts(i).isdir && contains(fileread(fullfile(parts(i).folder, parts(i).name)), text)
        hit = true;
      end
    end
    rmdir(tmp, 's');
  else
    hit = contains(fileread(p), text);
  end
end

function report(failures)
  if isempty(failures)
    fprintf('MAKE_CELL_ZERO_IMAGINARY_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_CELL_ZERO_IMAGINARY_FAILED %d\n', numel(failures));
  end
end
