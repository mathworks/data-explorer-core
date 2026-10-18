function make_dag_fixtures()
  % Copyright 2026 The MathWorks, Inc.
  % Authors the shared-object fixtures: a chain of DagNode handles in which every node's
  % Kids is [cur cur], ONE handle held twice. Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<repo>/test/fixtures/mcos/shared'); make_dag_fixtures"
  %
  % (One line, for the reason make_class_fixtures.m gives. Verify by the WROTE lines and
  % the trailing MAKE_DAG_FIXTURES_DONE, not by the exit code.)
  %
  % Writes dag4.mat, dag12.mat, dag16.mat and dag24.mat into this folder, MATLAB's default
  % `save` format (Level 5, not -v7.3), each holding one variable, `root`, at that depth.
  %
  % WHY A HANDLE. MATLAB writes a handle once and refers to it by id from every place that
  % holds it, so the file stays small: the depth-24 file is about 1 KB, and holds 25
  % objects. Laid out once per path, as a reader that expands every reference does, it is
  % 2^25 - 1 objects. A value class (the same chain with `classdef ValNode`) is stored
  % expanded instead, about 123 KB at depth 12, so only a handle graph is this compact.
  %
  % These files are in a folder of their own, not in mcos/, because mcos/ is swept for
  % "opens with no MCOS warning" and dag16 and dag24 warn by design.
  here = fileparts(mfilename('fullpath'));
  failures = {};
  for d = [4 12 16 24]
    cur = DagNode; cur.Tag = -1;
    for i = 1:d
      n = DagNode; n.Tag = i; n.Kids = [cur cur]; cur = n;
    end
    root = cur; %#ok<NASGU>
    matPath = fullfile(here, sprintf('dag%d.mat', d));
    save(matPath, 'root');
    fprintf('WROTE dag%d.mat bytes=%d\n', d, dir(matPath).bytes);

    % Read back: the depth, the tags, and that the two kids are still one handle.
    L = load(matPath);
    k = L.root; depth = 0; ok = true;
    while ~isempty(k.Kids)
      ok = ok && isequal(size(k.Kids), [1 2]) && k.Kids(1) == k.Kids(2) && k.Tag == d - depth;
      k = k.Kids(1); depth = depth + 1;
    end
    ok = ok && k.Tag == -1;
    fprintf('READ dag%d.mat depth=%d shared=%d\n', d, depth, ok);
    if depth ~= d || ~ok
      failures{end + 1} = sprintf('dag%d.mat', d); %#ok<AGROW>
    end
  end
  if isempty(failures)
    fprintf('MAKE_DAG_FIXTURES_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_DAG_FIXTURES_FAILED %d\n', numel(failures));
  end
end
