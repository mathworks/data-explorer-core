function make_cellswap_fixtures(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors the originals of the cell-swap fixtures: MAT-files holding Simulink.Parameter and
  % Simulink.Signal objects, each with the properties cellswap.truth.json edits stored the
  % way MATLAB stores them. Run:
  %
  %   matlab -nodesktop -batch "cd('<repo>/test/fixtures/mat-cellswap'); make_cellswap_fixtures"
  %
  % An optional argument names another folder to write into.
  %
  % Writes seven files:
  %   pv_basic.mat     p = Parameter(5), q = Parameter(5), a double row and a string
  %   pv_basic_v6.mat  the same, saved -v6 (an uncompressed subsystem)
  %   pv_typed.mat     t: a single Value under DataType 'single', Min, Max, Description, Unit
  %   pv_nested.mat    a Parameter in a struct field, in a cell, and a 1x2 Parameter array
  %   pv_default.mat   d: Value at its default ([]), which MATLAB saves no value for; e: Value 0
  %   pv_shared.mat    h and r, one Parameter (a handle) held by two variables
  %   pv_signal.mat    sig: a Signal with InitialValue, Description and DataType set
  %
  % The mutants mut_*.mat are these files with one value cell replaced by an independent
  % writer, and exp_*.mat MATLAB's own save of the same edit applied to a fresh load; the
  % truth file says what MATLAB made of each.
  if nargin < 1
    outDir = fileparts(mfilename('fullpath'));
  end
  fprintf('VERSION %s\n', version);

  p = Simulink.Parameter(5);
  q = Simulink.Parameter(5);
  x = 1:3;
  str = "hello";
  save(fullfile(outDir, 'pv_basic.mat'), 'p', 'q', 'x', 'str');
  save(fullfile(outDir, 'pv_basic_v6.mat'), 'p', 'q', 'x', 'str', '-v6');

  t = Simulink.Parameter;
  t.Value = single(2.5);
  t.DataType = 'single';
  t.Min = 0;
  t.Max = 10;
  t.Description = 'desc';
  t.Unit = 'm';
  save(fullfile(outDir, 'pv_typed.mat'), 't');

  s.p = Simulink.Parameter(5);
  s.k = 1;
  c = {Simulink.Parameter(6), 2};
  arr = [Simulink.Parameter(1), Simulink.Parameter(2)];
  save(fullfile(outDir, 'pv_nested.mat'), 's', 'c', 'arr');

  d = Simulink.Parameter;
  e = Simulink.Parameter(0);
  save(fullfile(outDir, 'pv_default.mat'), 'd', 'e');

  h = Simulink.Parameter(5);
  r = h;
  save(fullfile(outDir, 'pv_shared.mat'), 'h', 'r');

  sig = Simulink.Signal;
  sig.InitialValue = '3';
  sig.Description = 'a signal';
  sig.DataType = 'int16';
  save(fullfile(outDir, 'pv_signal.mat'), 'sig');

  fprintf('MAKE_CELLSWAP_FIXTURES_DONE\n');
end
