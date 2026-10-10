function [out, n] = scrub_matlabroot(x, root)
  % Copyright 2026 The MathWorks, Inc.
  % Takes the saving MATLAB's matlabroot out of a fixture. MATLAB writes it into every
  % function handle it serializes — the handle's `matlabroot` field, beside its
  % `function`, `type` and `file` — so a value holding a handle carries the install path
  % of the MATLAB that saved it, and for these fixtures that is an internal build-archive
  % path. Every occurrence (as UTF-8 and as UTF-16LE bytes) is replaced by a token of the
  % same length that is not a path, so no element's declared size moves and the file is
  % still MATLAB's in every other byte. The token is only ever compared with the loading
  % MATLAB's own matlabroot, to relocate a handle's file: a built-in or an anonymous
  % handle has none, and MATLAB reads both back as they were (the generators read every
  % scrubbed file back and record what MATLAB says it holds).
  %
  %   [path, n] = scrub_matlabroot(path)        a .mat saved -nocompression, or a
  %                                             compressed-binary .sldd: its hex values,
  %                                             the zip re-written part for part, in its
  %                                             own order
  %   [bytes, n] = scrub_matlabroot(bytes)      a uint8 stream (getByteStreamFromArray)
  %
  % `root` defaults to this MATLAB's matlabroot. A text dictionary needs nothing: it
  % spells a handle as JSON text, and the stream it carries for a sparse array holds none.
  if nargin < 2 || isempty(root)
    root = matlabroot;
  end
  root = char(root);
  if isnumeric(x)
    [out, n] = scrub_bytes(uint8(x(:)'), root);
    return
  end
  path = char(x);
  out = path;
  fid = fopen(path, 'r');
  head = fread(fid, [1 2], 'uint8=>uint8');
  fclose(fid);
  if isequal(head, uint8('PK'))
    n = scrub_zip(path, root);
  elseif endsWith(path, '.mat')
    n = scrub_mat(path, root);
  else
    error('scrub_matlabroot:format', '%s is neither a .mat nor a zip package', path);
  end
end

function [bytes, n] = scrub_bytes(bytes, root)
  token = uint8(token_for(numel(root)));
  n = 0;
  % UTF-8 (a stream's char data, and the uint8 blob of an MCOS subsystem), then UTF-16LE.
  forms = {uint8(root), reshape([uint8(root); zeros(1, numel(root), 'uint8')], 1, [])};
  swaps = {token, reshape([token; zeros(1, numel(token), 'uint8')], 1, [])};
  for f = 1:2
    at = strfind(char(bytes), char(forms{f}));
    for k = at
      bytes(k:k + numel(forms{f}) - 1) = swaps{f};
    end
    n = n + numel(at);
  end
end

function t = token_for(len)
  % '<matlabroot>' and underscores: no separator, so no path of any kind.
  t = ['<matlabroot>' repmat('_', 1, max(0, len - 12))];
  t = t(1:len);
end

function n = scrub_mat(path, root)
  fid = fopen(path, 'r');
  bytes = fread(fid, Inf, 'uint8=>uint8')';
  fclose(fid);
  % A compressed record would hide the path from this search: refuse rather than miss it.
  at = 129;
  while at + 7 <= numel(bytes)
    type = typecast(bytes(at:at + 3), 'uint32');
    if type == 15
      error('scrub_matlabroot:compressed', '%s is compressed; save it -nocompression', path);
    end
    at = at + 8 + double(typecast(bytes(at + 4:at + 7), 'uint32'));
  end
  [bytes, n] = scrub_bytes(bytes, root);
  fid = fopen(path, 'w');
  fwrite(fid, bytes, 'uint8');
  fclose(fid);
end

function n = scrub_zip(path, root)
  % The part names in the package's own order, read through Java, which MATLAB's unzip
  % does not keep.
  zf = java.util.zip.ZipFile(path);
  names = {};
  e = zf.entries();
  while e.hasMoreElements()
    names{end + 1} = char(e.nextElement().getName()); %#ok<AGROW>
  end
  zf.close();
  tmp = tempname;
  mkdir(tmp);
  cleanup = onCleanup(@() rmdir(tmp, 's'));
  unzip(path, tmp);
  n = 0;
  parts = cell(size(names));
  for k = 1:numel(names)
    fid = fopen(fullfile(tmp, names{k}), 'r');
    parts{k} = fread(fid, Inf, 'uint8=>uint8')';
    fclose(fid);
    if endsWith(names{k}, '.xml')
      [parts{k}, m] = scrub_hex_values(parts{k}, root);
      n = n + m;
    end
  end
  out = [tempname '.zip'];
  zos = java.util.zip.ZipOutputStream(java.io.FileOutputStream(out));
  for k = 1:numel(names)
    entry = java.util.zip.ZipEntry(names{k});
    % One fixed time for every part, as the package MATLAB wrote has (1980-01-01), so a
    % rerun writes the same bytes.
    entry.setTime(java.util.GregorianCalendar(1980, 0, 1).getTimeInMillis());
    zos.putNextEntry(entry);
    zos.write(typecast(parts{k}, 'int8'));
    zos.closeEntry();
  end
  zos.close();
  movefile(out, path, 'f');
end

function [xml, n] = scrub_hex_values(xml, root)
  % Every Encoding="hex" element's digits, decoded, scrubbed and written back in place:
  % the layout (MATLAB's line breaks and indentation) is untouched, only digits change.
  text = char(xml);
  n = 0;
  extents = regexp(text, '<(?:P|Element)\s[^>]*Encoding="hex"[^>]*>([^<]*)<', 'tokenExtents');
  for k = 1:numel(extents)
    s = extents{k}(1);
    e = extents{k}(2);
    body = text(s:e);
    at = find(isstrprop(body, 'xdigit'));
    digits = body(at);
    bytes = uint8(hex2dec(reshape(digits, 2, [])'))';
    [bytes, m] = scrub_bytes(bytes, root);
    if m > 0
      body(at) = reshape(dec2hex(bytes, 2)', 1, []);
      text(s:e) = body;
      n = n + m;
    end
  end
  xml = uint8(text);
end
