function make_string_containers(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors the MAT-files of test/fixtures/string-containers/<release>/, which
  % test/matStringMember.test.ts types strings into and out of: a struct field, a field of an
  % element of a struct array, a cell element and a member of a nested container, in a file
  % with no objects (no subsystem), one with other objects, and one that holds strings already.
  % Run once in each release, into its own folder:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd /tmp; addpath('<this folder>'); make_string_containers('<this folder>/string-containers/r2027a')"
  %   mw -using BR2023bd matlab -nodesktop -batch "cd /tmp; addpath('<this folder>'); make_string_containers('<this folder>/string-containers/r2023b')"
  %
  % (One line: mw splits a -batch argument on newlines.) Verify by the WROTE lines and the
  % trailing MAKE_STRING_CONTAINERS_DONE.
  if ~exist(outDir, 'dir')
    mkdir(outDir);
  end
  % Plain containers: no object anywhere, so the file has no subsystem.
  st = struct('a', 1, 'b', 'chr');
  sa = struct('f', {1, 2});
  ce = {1, 'two', int8(3)};
  nest = struct('c', {{1, struct('g', 2)}});
  save(fullfile(outDir, 'plain.mat'), 'st', 'sa', 'ce', 'nest');
  fprintf('WROTE %s\n', fullfile(outDir, 'plain.mat'));
  % The same beside an object of another class.
  p = Simulink.Parameter(5);
  save(fullfile(outDir, 'objects.mat'), 'st', 'sa', 'ce', 'nest', 'p');
  fprintf('WROTE %s\n', fullfile(outDir, 'objects.mat'));
  % The same beside strings, top-level and in containers, which a string member can be typed out of.
  s = "top";
  st2 = struct('a', 1, 'b', "inStruct");
  sa2 = struct('f', {"one", 2});
  ce2 = {1, "inCell", ["x" "yz"]};
  nest2 = struct('c', {{1, struct('g', "deep")}});
  save(fullfile(outDir, 'strings.mat'), 'st', 'sa', 'ce', 'nest', 's', 'st2', 'sa2', 'ce2', 'nest2');
  fprintf('WROTE %s\n', fullfile(outDir, 'strings.mat'));
  fprintf('MAKE_STRING_CONTAINERS_DONE %s\n', version);
end
