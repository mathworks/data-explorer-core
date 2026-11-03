% Copyright 2026 The MathWorks, Inc.
%
% How MATLAB frames a model workspace part's struct: the field-name length getByteStreamFromArray
% writes for a 1x1 struct, by its longest field name, and the bytes of a 1x1 struct with no fields,
% an empty workspace. A model workspace part (`simulink/modelWorkspace.mxarray`, R2019b+) is that
% stream of the struct of its variables; ModelWorkspaceStream writes the struct anew where an edit
% changed its names, and does so by this.
%
% Measured on R2027a (2026-11-03): the length is the longest name plus one, but never under 3 (a
% MAT-file's own rule, MatWriter's struct, is never under 5); a struct with no fields says 1, and
% holds an empty table.
%
% Run: env WORKSPACE_STREAM_OUT=/tmp/wsstream mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_workspace_stream.m')"
% then: cp /tmp/wsstream/workspace_stream.truth.json test/parity/matlab/
% Prints WORKSPACE_STREAM OK on its last line.

outdir = getenv('WORKSPACE_STREAM_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'wsstream'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end
lens = [1 2 3 4 5 6 8 9 16 31 32 63];
strides = struct('longest', {}, 'stride', {});
for L = lens
  s = struct();
  s.(repmat('a', 1, L)) = 1;
  s.b = 2;
  b = getByteStreamFromArray(s);
  % The preamble (8), the struct's tag (8), its flags (16), dims (16) and name (8), then the
  % field-name length in the small form: its value is the second word.
  stride = typecast(uint8(b(8+8+16+16+8+5 : 8+8+16+16+8+8)), 'int32');
  strides(end+1) = struct('longest', L, 'stride', double(stride)); %#ok<SAGROW>
end
e = getByteStreamFromArray(struct());
truth = struct('version', version, 'release', version('-release'), 'date', char(datetime('today', 'Format', 'yyyy-MM-dd')), ...
               'strides', strides, 'emptyStruct', lower(reshape(dec2hex(e)', 1, [])));
fid = fopen(fullfile(outdir, 'workspace_stream.truth.json'), 'w');
fwrite(fid, jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
disp('WORKSPACE_STREAM OK');
