function make_configset_fixture(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors configset.mat: object arrays whose elements are of more than one class, held by
  % an object's property, as MATLAB saves them in a .mat, with a truth file of what MATLAB
  % says each array and each element is. Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<repo>/test/fixtures/mcos'); make_configset_fixture"
  %
  % (One line, for the reason make_class_fixtures.m gives. The `cd` puts NdHolder.m and the
  % +dexdata package on the path. Verify by the WROTE lines and the trailing
  % MAKE_CONFIGSET_FIXTURE_DONE, not by the exit code; any FAIL line above it means the file
  % says something other than what this header promises.) An optional argument names
  % another folder to write into, so a run can be inspected before it replaces what is
  % committed.
  %
  % Writes two files:
  %   configset.mat              MATLAB's default `save` format (Level 5, not -v7.3), of
  %                              cs     a default Simulink.ConfigSet (grt.tlc), whose
  %                                     Components mixes a dozen component classes and
  %                                     whose RTWCC's Components is a Simulink.CodeAppCC
  %                                     beside a Simulink.GRTTargetCC
  %                              csErt  the same with SystemTargetFile ert.tlc, so its
  %                                     RTWCC's Components holds a Simulink.ERTTargetCC
  %                              mixed  an NdHolder whose Kids is a dexdata.DerivedSignal
  %                                     (a user's subclass of Simulink.Signal) beside a
  %                                     Simulink.Signal, the subclass first
  %   configset.truth.json       MATLAB's answers, read back from the file with `load`:
  %                              for each array, class() of the array and of each element
  %                              in order, and each config component's Name
  %
  % WHY. Inside an MCOS object (a .mat, a model workspace) the reader named such an array
  % after its FIRST element and dropped every other element's class: a config set's
  % Components read as a Simulink.SolverCC array of ten SolverCCs, and a copy of the config
  % set wrote every component as one. A binary dictionary's reader already keeps each
  % element's class, and names the array by the rules MATLAB's text format shows
  % (Simulink.ConfigComponent for a config set's Components, the one MathWorks class beside
  % a user's subclass of it). No fixture held such an array before this one: the two the
  % corpus holds are a customer's.
  here = fileparts(mfilename('fullpath'));
  if nargin < 1 || isempty(outDir)
    outDir = here;
  end
  if ~isfolder(outDir)
    mkdir(outDir);
  end
  failures = {};

  [V, failures] = values(failures);
  matPath = fullfile(outDir, 'configset.mat');
  if isfile(matPath), delete(matPath); end
  % No version flag: the default, which is what a user's `save` writes.
  save(matPath, '-struct', 'V');
  fid = fopen(matPath, 'r');
  hdr = fread(fid, [1 116], 'char=>char');
  fclose(fid);
  if ~startsWith(hdr, 'MATLAB 5.0 MAT-file')
    failures{end + 1} = sprintf('configset.mat header is "%s"', strtrim(hdr(1:min(end, 40))));
  end
  failures = check_uncompressed(failures, V);
  fprintf('WROTE configset.mat bytes=%d\n', dir(matPath).bytes);

  L = load(matPath);
  T = struct();
  T.version = version;
  T.release = version('-release');
  T.file = 'configset.mat';
  T.names = fieldnames(V)';
  T.paths = struct();
  names = fieldnames(V);
  for i = 1:numel(names)
    n = names{i};
    if ~isfield(L, n)
      failures{end + 1} = sprintf('configset.mat does not hold %s', n); %#ok<AGROW>
      continue
    end
    [r, failures] = record(n, L.(n), failures);
    % What was read back is what was written, or the fixture is not what its name says.
    [built, failures] = record(n, V.(n), failures);
    if ~isequal(r, built)
      failures{end + 1} = sprintf('configset.mat reads %s back as another array', n); %#ok<AGROW>
    end
    T.paths.(n) = r;
  end
  write_json(fullfile(outDir, 'configset.truth.json'), T);

  if isempty(failures)
    fprintf('MAKE_CONFIGSET_FIXTURE_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_CONFIGSET_FIXTURE_FAILED %d\n', numel(failures));
  end
end

% ---------------------------------------------------------------------------
% The values
% ---------------------------------------------------------------------------

function [V, failures] = values(failures)
  V = struct();
  V.cs = Simulink.ConfigSet;
  csErt = Simulink.ConfigSet;
  try
    set_param(csErt, 'SystemTargetFile', 'ert.tlc');
  catch err
    failures{end + 1} = sprintf('csErt refused ert.tlc: %s', err.message);
  end
  V.csErt = csErt;
  mixed = NdHolder;
  mixed.Tag = 'mixed';
  try
    mixed.Kids = [dexdata.DerivedSignal, Simulink.Signal];
  catch err
    failures{end + 1} = sprintf('mixed refused [DerivedSignal, Signal]: %s', err.message);
  end
  V.mixed = mixed;
end

% ---------------------------------------------------------------------------
% What MATLAB says each array is
% ---------------------------------------------------------------------------

function [r, failures] = record(name, x, failures)
  r = struct();
  r.class = class(x);
  if isa(x, 'Simulink.ConfigSet')
    [comps, failures] = components_of(name, x, failures);
    r.Components = array_record(comps);
    r.Components.names = arrayfun(@(c) c.Name, comps, 'UniformOutput', false);
    rtw = find(arrayfun(@(c) isa(c, 'Simulink.RTWCC'), comps));
    if numel(rtw) ~= 1
      failures{end + 1} = sprintf('%s holds %d Simulink.RTWCC components', name, numel(rtw));
      return
    end
    r.rtwIndex = rtw;
    [inner, failures] = components_of([name '.RTWCC'], comps(rtw), failures);
    r.RTWComponents = array_record(inner);
    r.RTWComponents.names = arrayfun(@(c) c.Name, inner, 'UniformOutput', false);
  elseif isa(x, 'NdHolder')
    r.Tag = x.Tag;
    r.Kids = array_record(x.Kids);
  end
end

function [comps, failures] = components_of(name, x, failures)
  % The Components property itself, the array MATLAB stores in the file.
  try
    comps = x.Components;
  catch err
    failures{end + 1} = sprintf('%s.Components is not readable: %s', name, err.message);
    comps = [];
  end
end

function r = array_record(a)
  r = struct();
  r.class = class(a);
  r.size = size(a);
  r.elements = arrayfun(@(e) class(e), a(:)', 'UniformOutput', false);
end

% ---------------------------------------------------------------------------
% No account name, no machine path
% ---------------------------------------------------------------------------

function failures = check_uncompressed(failures, V)
  % The default save deflates each variable, so its bytes are searched as an uncompressed
  % -v6 save of the same variables, which holds the same subsystem.
  tmp = [tempname '.mat'];
  cleanup = onCleanup(@() delete(tmp)); %#ok<NASGU>
  save(tmp, '-struct', 'V', '-v6');
  fid = fopen(tmp, 'r');
  bytes = fread(fid, Inf, 'uint8=>char')';
  fclose(fid);
  needles = {getenv('USER'), matlabroot, getenv('HOME')};
  for k = 1:numel(needles)
    if ~isempty(needles{k}) && contains(bytes, needles{k})
      failures{end + 1} = sprintf('configset.mat holds "%s"', needles{k}); %#ok<AGROW>
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
