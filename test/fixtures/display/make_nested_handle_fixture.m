function make_nested_handle_fixture(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors nested_handles.mat: function handles a .mat holds INSIDE a struct field or a
  % cell element, which the display catalog (probe_display.m) holds only at top level
  % (fh_sin, fh_anon, e_func_handle_none). Run (one line: mw splits -batch on newlines):
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_nested_handle_fixture"
  %
  % Verify by the WROTE lines and the trailing MAKE_NESTED_HANDLE_FIXTURE_DONE; any FAIL
  % line means the file says something other than this header promises. `outDir` defaults
  % to this folder.
  %
  % Writes two files:
  %   nested_handles.mat         the variables below, saved -v7 -nocompression
  %   nested_handles.truth.json  MATLAB's answers about every member, read back from the
  %                              scrubbed file: its class(), size(), func2str, and the
  %                              Workspace browser's Class and Value columns for it
  %                              (FieldColumns.ClassCol / ValueCol, as probe_display.m
  %                              reads them)
  %
  % THE VALUES:
  %   s_fh     a 1x1 struct: named = @sin, anon = @(x)x.^2+1, none = an empty
  %            function_handle (0x0), num = 3 (a control: no handle)
  %   c_fh     a 1x4 cell of the same four values
  %   deep_fh  a struct holding a struct (inner.h = @cos) and a cell in a cell
  %            (list = {{@tan}}): a handle two levels down
  %   sa_fh    a 1x2 struct array, h = @sin and @cos: a handle in a struct array's element
  %
  % No dictionary twin: R2027a refuses each of these values as a Design Data entry ("Unable
  % to import variable 's_fh'. Function handle data type not supported for data
  % dictionaries.", addEntry, 2026-10-16).
  %
  % Every anonymous handle is made with str2func, so that it records no file: one made in
  % this file would carry this file's path into the .mat. MATLAB writes its own matlabroot
  % into every function handle it serializes; scrub_matlabroot replaces it with a token of
  % the same length, and the truth is MATLAB's reading of the scrubbed file. The file is
  % then searched for this MATLAB's matlabroot, the account name and an absolute path; a
  % hit is a FAIL.
  if nargin < 1 || isempty(outDir)
    outDir = fileparts(mfilename('fullpath'));
  end
  here = fileparts(mfilename('fullpath'));
  addpath(fullfile(here, '..', 'sparse'));
  failures = {};

  anon = str2func('@(x)x.^2+1');
  none = function_handle.empty;
  s_fh = struct('named', @sin, 'anon', anon, 'none', none, 'num', 3);
  c_fh = {@sin, anon, none, 3};
  deep_fh = struct('inner', struct('h', @cos), 'list', {{{@tan}}});
  sa_fh = struct('h', {@sin, @cos});

  matPath = fullfile(outDir, 'nested_handles.mat');
  save(matPath, 's_fh', 'c_fh', 'deep_fh', 'sa_fh', '-v7', '-nocompression');
  [~, n] = scrub_matlabroot(matPath);
  fprintf('WROTE %s (%d matlabroot occurrences scrubbed)\n', matPath, n);

  fid = fopen(matPath, 'r');
  bytes = fread(fid, Inf, 'uint8=>char')';
  fclose(fid);
  user = getenv('USER');
  needles = {matlabroot, '/Users/', '/home/', '/mathworks/'};
  if ~isempty(user), needles{end+1} = user; end
  for k = 1:numel(needles)
    if contains(bytes, needles{k}) || contains(bytes, char(reshape([double(needles{k}); zeros(1, numel(needles{k}))], 1, [])))
      failures{end+1} = sprintf('FAIL %s holds %s', matPath, needles{k}); %#ok<AGROW>
    end
  end

  L = load(matPath);
  rows = {};
  rows = member(rows, 's_fh.named', L.s_fh.named);
  rows = member(rows, 's_fh.anon', L.s_fh.anon);
  rows = member(rows, 's_fh.none', L.s_fh.none);
  rows = member(rows, 's_fh.num', L.s_fh.num);
  rows = member(rows, 'c_fh{1}', L.c_fh{1});
  rows = member(rows, 'c_fh{2}', L.c_fh{2});
  rows = member(rows, 'c_fh{3}', L.c_fh{3});
  rows = member(rows, 'c_fh{4}', L.c_fh{4});
  rows = member(rows, 'deep_fh.inner.h', L.deep_fh.inner.h);
  rows = member(rows, 'deep_fh.list{1}{1}', L.deep_fh.list{1}{1});
  rows = member(rows, 'sa_fh(1).h', L.sa_fh(1).h);
  rows = member(rows, 'sa_fh(2).h', L.sa_fh(2).h);

  T = struct();
  T.version = version;
  T.release = version('-release');
  T.members = rows;
  truthPath = fullfile(outDir, 'nested_handles.truth.json');
  fid = fopen(truthPath, 'w', 'n', 'UTF-8');
  fwrite(fid, jsonencode(T, 'PrettyPrint', true), 'char');
  fprintf(fid, '\n');
  fclose(fid);
  fprintf('WROTE %s\n', truthPath);

  for k = 1:numel(failures)
    fprintf('%s\n', failures{k});
  end
  fprintf('MAKE_NESTED_HANDLE_FIXTURE_DONE failures=%d\n', numel(failures));
end

function rows = member(rows, path, v)
  r = struct('path', path, 'class', class(v), 'size', size(v), 'func2str', '', 'Class', '', 'Value', '');
  if isa(v, 'function_handle') && ~isempty(v)
    r.func2str = func2str(v);
  end
  r.Class = char(string(internal.matlab.variableeditor.FieldColumns.ClassCol.getClass(v, 'v', false, [])));
  val = internal.matlab.variableeditor.FieldColumns.ValueCol.getValue(v, 'v', false, [], 'short');
  if iscell(val), val = val{1}; end
  r.Value = char(string(val));
  rows{end+1} = r;
end
