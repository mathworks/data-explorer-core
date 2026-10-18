function make_number_battery(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors the number-spelling battery: how MATLAB spells a double and a single in a
  % compressed-binary dictionary's XML, for a few thousand values, beside the exact bits of
  % each. test/numberSpellingMatlab.test.ts holds XmlUtils.formatFloatXml to every token.
  % It lives in test/numbers rather than test/fixtures, whose binary dictionaries are each
  % walked edit by edit (binarySaveKeepsUnedited.test.ts), which 4,000 element nodes take past
  % its budget. Run:
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_number_battery"
  %
  % (One line: mw splits a -batch argument on newlines. Verify by the WROTE lines and the
  % trailing MAKE_NUMBER_BATTERY_DONE; any FAIL line means a file says something other
  % than this header promises.) `outDir` defaults to this folder.
  %
  % Writes:
  %   battery_binary.sldd   a data dictionary, FileFormat 'compressed-binary'
  %   battery_d.bin         battery_d's elements, IEEE little-endian doubles, in order
  %   battery_s.bin         battery_s's elements, IEEE little-endian singles, in order
  %   edge_d.bin            edge_d's elements, doubles
  %   edge_s.bin            edge_s's elements, singles
  %   edge_c.bin            edge_c's elements, doubles, real then imaginary part of each
  %   edge_cs.bin           edge_cs's elements, singles, real then imaginary part of each
  %   battery.truth.json    MATLAB's reading of the dictionary it wrote, entry by entry
  %
  % THE VALUES (Design Data), rng(20261018):
  %   battery_d   2,109 doubles: 1,500 of random magnitude 1e-308..1e308 and random sign,
  %               200 random multiples of 0.001, 200 random integers below 1e9, 2.^(0:60),
  %               10.^(-20:22), 1./(1:50), realmin*(1:5) and 50 multiples of the smallest
  %               subnormal.
  %   battery_s   1,807 singles: 1,500 of random magnitude 1e-38..1e38 and random sign,
  %               200 multiples of 0.001, 2.^(0:30), 10.^(-10:10), +-realmax('single'),
  %               the six singles below it, 3.4e38, 3.40282e38, realmin('single')*(1:5)
  %               and 40 multiples of the smallest subnormal.
  %   edge_d      doubles chosen one by one: both zeros, the non-finites, +-realmax,
  %               realmin and a subnormal, eps, 2^53 and 2^53+2, each power of ten where
  %               the layout changes, and values whose 15 digits are not the double.
  %   edge_s      the same for singles.
  %   edge_c      a complex double vector: parts that need an exponent, a -0 part.
  %   edge_cs     the same as a complex single.
  %   edge_p      a Simulink.Parameter of 1e-5 whose Min is -0 and Max 1e6 (C-062).
  % battery_d and battery_s are the values of the scoping probe of 2026-10-18 (the same
  % seed and the same expressions); the edges were added when the battery was committed.
  %
  % The truth records, per entry, MATLAB's class and size of the value read back from the
  % saved dictionary, and whether its bits are those of the .bin (`bitsEqual`), NaN
  % compared as NaN. So every token in battery_binary.sldd is MATLAB's spelling of the
  % value whose bits sit at the same place in the .bin, by MATLAB's own reading.
  %
  % NO ACCOUNT NAME IN ANY FILE: USER is set to 'fixture' while the dictionary is written
  % (it is LastModBy), and the zip's parts are searched for the account name; a hit is a
  % FAIL.
  if nargin < 1 || isempty(outDir)
    outDir = fileparts(mfilename('fullpath'));
  end
  failures = {};
  user = getenv('USER');
  rng(20261018);

  mag = 10 .^ (rand(1, 1500) * 616 - 308);
  d = [mag .* sign(rand(1, 1500) - 0.5), round(rand(1, 200) * 1e6) / 1000, round(rand(1, 200) * 1e9), ...
       2 .^ (0:60), 10 .^ (-20:22), 1 ./ (1:50), realmin * (1:5), 4.9406564584124654e-324 * (1:50)];
  smag = single(10 .^ (rand(1, 1500) * 76 - 38));
  s = [smag .* single(sign(rand(1, 1500) - 0.5)), single(round(rand(1, 200) * 1e6) / 1000), ...
       single(2 .^ (0:30)), single(10 .^ (-10:10)), realmax('single') * single([1 -1]), ...
       realmax('single') - eps(realmax('single')) * single(0:5), single(3.4e38), single(3.40282e38), ...
       realmin('single') * single(1:5), single(1.4e-45) * single(1:40)];

  ed = [0, -0, Inf, -Inf, NaN, 1, -1.5, 0.1, 1/3, pi, 0.1 + 0.2, eps, realmax, -realmax, realmin, ...
        realmin / 2, 4.9406564584124654e-324, 2^53, 2^53 + 2, -2^53, 1e-5, 5e-7, 1e-6, 1e-4, ...
        1.5e-4, 1e-3, 100, 1e5, 1e6, 1e7, 123456789, 999999999999999, 1e15, 1e16, 1e17, 1e21, ...
        1e22, 1e300, 1e-300, 12345.678, 999999.5, 1234567.25, 0.001234, 123.456e10, ...
        1125899906842624.25, 4503599627370495.5, 0.3, 2/3, 1e23, 5e-324 * 3];
  es = single([0, -0, Inf, -Inf, NaN, 1, -1.5, 0.1, 1/3, pi, eps('single'), 1e-5, 1e-4, ...
        1.5e-4, 1e5, 1e6, 1e7, 2^24, 2^24 + 2, 123456789, 1000000.125, 3.4e38, 1.4e-45, 0.3]);
  es = [es, realmax('single'), -realmax('single'), realmin('single'), realmin('single') / 2];
  ec = [complex(1e-7, 2e-8), complex(1e6, -0), complex(-0, 1), complex(pi, -1/3), ...
        complex(1e15, 1e16), complex(2^53, -5e-324)];
  ecs = single([complex(1e-7, 2e-8), complex(1e6, -0), complex(-0, 1), complex(pi, -1/3), ...
        complex(1e6, 1e7)]);
  p = Simulink.Parameter(1e-5); p.Min = -0; p.Max = 1e6;

  V = {'battery_d', d; 'battery_s', s; 'edge_d', ed; 'edge_s', es; 'edge_c', ec; 'edge_cs', ecs; ...
       'edge_p', p};

  ddName = 'battery_binary.sldd';
  ddPath = fullfile(outDir, ddName);
  Simulink.data.dictionary.closeAll('-discard');
  if exist(ddPath, 'file'), delete(ddPath); end
  setenv('USER', 'fixture');
  restoreUser = onCleanup(@() setenv('USER', user));
  dd = Simulink.data.dictionary.create(ddPath);
  dd.FileFormat = 'compressed-binary';
  ds = getSection(dd, 'Design Data');
  for i = 1:size(V, 1)
    addEntry(ds, V{i, 1}, V{i, 2});
  end
  saveChanges(dd); close(dd);
  clear restoreUser;
  Simulink.data.dictionary.closeAll('-discard');
  fprintf('WROTE %s bytes=%d\n', ddName, dir(ddPath).bytes);

  bins = {'battery_d', 'battery_d.bin', d, 'double'; 'battery_s', 'battery_s.bin', s, 'single'; ...
          'edge_d', 'edge_d.bin', ed, 'double'; 'edge_s', 'edge_s.bin', es, 'single'; ...
          'edge_c', 'edge_c.bin', interleave(ec), 'double'; 'edge_cs', 'edge_cs.bin', interleave(ecs), 'single'};
  for i = 1:size(bins, 1)
    fid = fopen(fullfile(outDir, bins{i, 2}), 'w', 'ieee-le');
    fwrite(fid, bins{i, 3}, bins{i, 4});
    fclose(fid);
    fprintf('WROTE %s bytes=%d\n', bins{i, 2}, dir(fullfile(outDir, bins{i, 2})).bytes);
  end

  % MATLAB's reading of what it wrote.
  T = struct();
  T.version = version;
  T.release = version('-release');
  T.seed = 20261018;
  T.dictionary = ddName;
  T.entries = struct('name', {}, 'class', {}, 'isComplex', {}, 'size', {}, 'bin', {}, 'bitsEqual', {});
  dd = Simulink.data.dictionary.open(ddPath);
  ds = getSection(dd, 'Design Data');
  for i = 1:size(V, 1)
    v = getValue(getEntry(ds, V{i, 1}));
    bin = '';
    k = find(strcmp(bins(:, 1), V{i, 1}));
    if isa(v, 'Simulink.Parameter')
      same = isequal(bitsOf(v.Value), bitsOf(p.Value)) && isequal(bitsOf(v.Min), bitsOf(-0)) ...
             && isequal(bitsOf(v.Max), bitsOf(1e6));
      e = struct('name', V{i, 1}, 'class', class(v), 'isComplex', false, 'size', size(v), ...
                 'bin', bin, 'bitsEqual', same);
      e.minSignbit = bitsOf(v.Min) == bitsOf(-0);
    else
      written = V{i, 2};
      same = isequal(class(v), class(written)) && isequal(size(v), size(written)) && ...
             isequal(isreal(v), isreal(written)) && sameBits(v, written);
      bin = bins{k, 2};
      e = struct('name', V{i, 1}, 'class', class(v), 'isComplex', ~isreal(v), 'size', size(v), ...
                 'bin', bin, 'bitsEqual', same);
    end
    if ~same
      failures{end + 1} = sprintf('%s read back as other bits than were written', V{i, 1}); %#ok<AGROW>
    end
    if isfield(e, 'minSignbit')
      T.edgeP = e;
    else
      T.entries(end + 1) = e;
    end
  end
  close(dd);
  Simulink.data.dictionary.closeAll('-discard');

  % No account name in any part of the zip.
  tmp = tempname; mkdir(tmp);
  unzip(ddPath, tmp);
  parts = dir(fullfile(tmp, '**', '*'));
  for i = 1:numel(parts)
    if parts(i).isdir, continue; end
    txt = fileread(fullfile(parts(i).folder, parts(i).name));
    if ~isempty(user) && contains(txt, user)
      failures{end + 1} = sprintf('%s holds the account name', parts(i).name); %#ok<AGROW>
    end
  end
  rmdir(tmp, 's');

  fid = fopen(fullfile(outDir, 'battery.truth.json'), 'w', 'n', 'UTF-8');
  fwrite(fid, jsonencode(T, 'PrettyPrint', true), 'char');
  fclose(fid);
  fprintf('WROTE battery.truth.json\n');
  if isempty(failures)
    fprintf('MAKE_NUMBER_BATTERY_DONE\n');
  else
    fprintf('FAIL %s\n', failures{:});
    fprintf('MAKE_NUMBER_BATTERY_FAILED %d\n', numel(failures));
  end
end

function x = interleave(c)
  x = reshape([real(c); imag(c)], 1, []);
end

function b = bitsOf(x)
  if isa(x, 'single')
    b = typecast(x(:)', 'uint32');
  else
    b = typecast(double(x(:)'), 'uint64');
  end
end

function same = sameBits(a, b)
  ra = real(a); rb = real(b);
  ia = imag(a); ib = imag(b);
  same = bitsAlike(ra, rb) && bitsAlike(ia, ib);
end

function same = bitsAlike(a, b)
  % NaN's payload is not a value, so a NaN matches a NaN; every other element is compared
  % by its bits, so -0 matches only -0.
  na = isnan(a); nb = isnan(b);
  same = isequal(na, nb) && isequal(bitsOf(a(~na)), bitsOf(b(~nb)));
end
