function make_string_cells(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors test/fixtures/string-containers/<release>/cells.mat: cells holding strings of every
  % kind a cell's text spells or does not, which test/matCellStrings.test.ts and its sweep type
  % back into themselves. Run once in each release, into its own folder:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd /tmp; addpath('<this folder>'); make_string_cells('<this folder>/string-containers/r2027a')"
  %   mw -using BR2023bd matlab -nodesktop -batch "cd /tmp; addpath('<this folder>'); make_string_cells('<this folder>/string-containers/r2023b')"
  %
  % (One line: mw splits a -batch argument on newlines.) Verify by the WROTE line and the
  % trailing MAKE_STRING_CELLS_DONE.
  if ~exist(outDir, 'dir')
    mkdir(outDir);
  end
  cPlain = {"plain", "with ""quotes""", "é中😀", ""};
  cControl = {"line" + newline + "break", "tab" + char(9)};
  cMissing = {string(missing), "ok"};
  cEmpty = {strings(0, 3), "x"};
  cMatrix = {["a" "b"; "c" "d"], "e"};
  cNd = {reshape(["a" "b" "c" "d" "e" "f" "g" "h"], 2, 2, 2)};
  cNested = {1, {"in", {2, "deep"}}};
  cColumn = {"a"; "b"};
  cMixed = {true, 'chr', "str", [1 2 3]};
  cInt = {int8(3), "a"};
  cStruct = {struct('f', "s"), "t"};
  cLong = {string(repmat('x', 1, 300))};
  sCell = struct('c', {{"in a struct", 2}});
  save(fullfile(outDir, 'cells.mat'), 'cPlain', 'cControl', 'cMissing', 'cEmpty', 'cMatrix', 'cNd', 'cNested', 'cColumn', 'cMixed', 'cInt', 'cStruct', 'cLong', 'sCell');
  fprintf('WROTE %s\n', fullfile(outDir, 'cells.mat'));
  fprintf('MAKE_STRING_CELLS_DONE %s\n', version);
end
