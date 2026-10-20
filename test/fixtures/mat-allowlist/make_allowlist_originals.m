function make_allowlist_originals(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors the originals of the allow-list cases (allowlist.truth.json): MAT-files holding
  % Simulink.Parameter and Simulink.Signal objects with the properties the cases edit stored the
  % way MATLAB stores them. Run:
  %
  %   matlab -nodesktop -batch "cd('<repo>/test/fixtures/mat-allowlist'); make_allowlist_originals"
  %
  % An optional argument names another folder to write into. Writes six files:
  %   al_minmax.mat  pm: Value 5, Min 0, Max 10; pmi: the same, int16-typed
  %   al_dtype.mat   a Parameter per DataType (single, int16, uint8, boolean, double, auto,
  %                  fixdt(1,16,4), an alias), each with a Value of its class and one double
  %   al_shape.mat   sp: 5; spI: int16 [1 2 3]; spB: a struct under 'Bus: MyBus'; spN: [1 2 3]
  %                  with a symbolic Dimensions; spC: [1+2i 3]
  %   al_signal.mat  sg: a Signal with Description, Unit, Min, Max, InitialValue, DataType and
  %                  Dimensions set; sg0: one with a Description only
  %   al_text.mat    Parameters with a long, an emptied, a short and a non-ASCII Description and Unit
  %   al_nested.mat  Parameters in a struct field, in a cell, and as a 1x3 array
  if nargin < 1
    outDir = fileparts(mfilename('fullpath'));
  end
  fprintf('VERSION %s\n', version);
  MyNT = fixdt(1, 16, 4); %#ok<NASGU> the alias tN's DataType names

  pm = Simulink.Parameter(5); pm.Min = 0; pm.Max = 10;
  pmi = Simulink.Parameter; pmi.DataType = 'int16'; pmi.Value = int16(5); pmi.Min = 0; pmi.Max = 10;
  save(fullfile(outDir, 'al_minmax.mat'), 'pm', 'pmi');

  tS = typed(single(2.5), 'single');  tSd = typed(2.5, 'single');
  tI = typed(int16(5), 'int16');      tId = typed(5, 'int16');
  tU = typed(uint8(5), 'uint8');      tUd = typed(5, 'uint8');
  tB = typed(true, 'boolean');        tBd = typed(1, 'boolean');
  tD = typed(5, 'double');
  tA = Simulink.Parameter(5);
  tAi = Simulink.Parameter(int16(5));
  tF = typed(2.5, 'fixdt(1,16,4)');
  tN = typed(2.5, 'MyNT');
  save(fullfile(outDir, 'al_dtype.mat'), 'tS', 'tSd', 'tI', 'tId', 'tU', 'tUd', 'tB', 'tBd', 'tD', 'tA', 'tAi', 'tF', 'tN');

  sp = Simulink.Parameter(5);
  spI = Simulink.Parameter; spI.DataType = 'int16'; spI.Value = int16([1 2 3]);
  spB = Simulink.Parameter; spB.Value = struct('a', 1, 'b', [1 2]); spB.DataType = 'Bus: MyBus';
  spN = Simulink.Parameter([1 2 3]); spN.Dimensions = '[1,N]';
  spC = Simulink.Parameter([1+2i 3]);
  save(fullfile(outDir, 'al_shape.mat'), 'sp', 'spI', 'spB', 'spN', 'spC');

  sg = Simulink.Signal;
  sg.Description = 'a signal'; sg.Unit = 'm'; sg.Min = 0; sg.Max = 10;
  sg.InitialValue = '3'; sg.DataType = 'int16'; sg.Dimensions = 3;
  sg0 = Simulink.Signal; sg0.Description = 'only';
  save(fullfile(outDir, 'al_signal.mat'), 'sg', 'sg0');

  xl = Simulink.Parameter(1); xl.Description = repmat('abcdefghij', 1, 30); xl.Unit = 'm/s^2';
  xe = Simulink.Parameter(1); xe.Description = 'x'; xe.Description = ''; xe.Unit = 'm'; xe.Unit = '';
  xa = Simulink.Parameter(1); xa.Description = 'short'; xa.Unit = 'm';
  xu = Simulink.Parameter(1);
  xu.Description = char([84 101 109 112 233 114 97 116 117 114 101 32 8212 32 220 98 101 114 119 97 99 104 117 110 103 32 28201 24230 32 181]);
  xu.Unit = char([176 67]);
  save(fullfile(outDir, 'al_text.mat'), 'xl', 'xe', 'xa', 'xu');

  s.p = typed(int16(5), 'int16'); s.k = 1;
  c = {Simulink.Parameter(6), 2, typed(single(2.5), 'single')};
  arr = [Simulink.Parameter(1), Simulink.Parameter(2), Simulink.Parameter(3)];
  arr(2).Value = single(2); arr(2).DataType = 'single';
  arr(3).Description = 'three';
  save(fullfile(outDir, 'al_nested.mat'), 's', 'c', 'arr');

  fprintf('MAKE_ALLOWLIST_ORIGINALS_DONE\n');
end

function p = typed(value, dataType)
  p = Simulink.Parameter;
  p.Value = value;
  p.DataType = dataType;
end
