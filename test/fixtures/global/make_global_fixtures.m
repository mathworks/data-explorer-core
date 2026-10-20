function make_global_fixtures(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors global_v7.mat and global_v6.mat: variables declared global, saved by MATLAB's own
  % `save`, beside one that is not. test/matGlobal.test.ts and the MAT-file gate
  % (test/parity/matlab/probe_mat_writeback) read them. Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "make_global_fixtures('/tmp/globals')"
  %
  % with this folder on the path, then copy the two files here. `outDir` must be a temp folder:
  % the function cds there before it writes anything.
  %
  % WHAT IT MEASURES. `save` marks a variable declared global by bit 0x04 of its array flags'
  % flags byte (the flags word 0x0406 for a global double), on the top-level element alone; it
  % prints the -v6 file's every element's flags as it finds them (FLAGS lines: depth, class,
  % flags byte; the -v7 file's records are compressed, and test/matGlobal.test.ts reads them),
  % and what MATLAB reads back of both: `whos -file`'s global attribute, and the globals a
  % `load` inside a function declares (GLOBAL lines). Measured on R2027a: 04 on every global
  % top-level element, 00 on every element nested in one.
  cd(outDir);
  clear global
  global gD gS gC gI %#ok<GVMIS>
  gD = [1 2 3];
  gS = struct('a', 1, 'b', {{2, 'x'}});
  gC = {4, int8(5), struct('q', 6)};
  gI = int16(-7);
  plain = 9; %#ok<NASGU>
  save('global_v7.mat', 'gD', 'gS', 'gC', 'gI', 'plain', '-v7');
  save('global_v6.mat', 'gD', 'gS', 'gC', 'gI', 'plain', '-v6');
  clear global
  for f = {'global_v7.mat', 'global_v6.mat'}
    w = whos('-file', f{1});
    fprintf('GLOBAL whos %s %s\n', f{1}, strjoin(arrayfun(@(x) sprintf('%s=%d', x.name, x.global), w, 'UniformOutput', false), ' '));
    fprintf('GLOBAL load %s %s\n', f{1}, strjoin(globalsLoaded(f{1}), ' '));
  end
  fprintf('FLAGS global_v6.mat %s\n', strjoin(flagsOf('global_v6.mat'), ' '));
  fprintf('MAKE_GLOBAL_FIXTURES_DONE %s\n', version);
end

% The globals `load` declares inside a function: every variable the file marks global.
function names = globalsLoaded(fixtureFile__)
  clear global
  load(fixtureFile__); %#ok<LOAD>
  w__ = whos('global');
  names = sort({w__.name});
  clear global
end

% The flags byte of every miMATRIX element of an uncompressed (-v6) file, nested ones included,
% as `d<depth>/c<class>:<flags>` in file order.
function out = flagsOf(f)
  out = {};
  fid = fopen(f, 'r');
  b = fread(fid, Inf, '*uint8')';
  fclose(fid);
  at = 129;
  while at + 7 <= numel(b)
    n = double(typecast(b(at+4:at+7), 'uint32'));
    out = [out, walk(b(at:at+7+n), 1, 0)]; %#ok<AGROW>
    at = at + 8 + n + mod(8 - mod(n, 8), 8);
  end
end

function out = walk(el, at, depth)
  out = {};
  n = double(typecast(el(at+4:at+7), 'uint32'));
  flags = el(at+17);
  cls = el(at+16);
  out{end+1} = sprintf('d%d/c%d:%02x', depth, cls, flags);
  % Members: past flags (16), dims, name; a cell's members follow, a struct's after its two
  % name sub-elements.
  p = at + 8 + 16;
  for k = 1:2
    [len, small] = subLen(el, p);
    if small, p = p + 8; else, p = p + 8 + len + mod(8 - mod(len, 8), 8); end
  end
  if cls == 2
    for k = 1:2
      [len, small] = subLen(el, p);
      if small, p = p + 8; else, p = p + 8 + len + mod(8 - mod(len, 8), 8); end
    end
  end
  if cls == 1 || cls == 2
    stop = at + 8 + n;
    while p < stop
      out = [out, walk(el, p, depth + 1)]; %#ok<AGROW>
      p = p + 8 + double(typecast(el(p+4:p+7), 'uint32'));
    end
  end
end

function [len, small] = subLen(el, p)
  w = typecast(el(p:p+3), 'uint32');
  small = bitshift(w, -16) ~= 0;
  if small
    len = double(bitshift(w, -16));
  else
    len = double(typecast(el(p+4:p+7), 'uint32'));
  end
end
