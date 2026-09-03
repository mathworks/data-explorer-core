% The MATLAB half of the BINARY write-path acceptance gate. Open every dictionary
% probe_writeback_bin.mjs rebuilt with our serializer and report what MATLAB
% actually sees.
%
% Run the JS half first, with the SAME absolute PROBE_OUT (and `npm run build`
% before it — the JS half reads dist/, so a stale build is a stale verdict):
%   env PROBE_OUT=/tmp/wbbin node test/parity/matlab/probe_writeback_bin.mjs
%   env PROBE_OUT=/tmp/wbbin mw -using Bmain matlab -nodesktop \
%       -batch "run('$PWD/test/parity/matlab/probe_writeback_bin.m')"
%
% Two control sets, both of which must pass for any verdict to mean anything:
% `control_copy_*` is MATLAB's own file byte for byte, and `control_zip_*` is
% MATLAB's own chunk0.xml repacked by fflate — which separates a zip MATLAB cannot
% read from XML MATLAB cannot read, since the two fail identically at the API.
%
% Last line: `WRITEBACK FAILURES n of m`. Zero is the only acceptable result. The
% comparison engine is wbcompare.m, shared with the text gate.
outdir = getenv('PROBE_OUT');
if isempty(outdir)
    error('PROBE_OUT is not set. It must be the same ABSOLUTE path the .mjs half used.');
end
% `run(...)` starts in whatever directory the launcher did, so the shared engine has
% to be put on the path explicitly.
addpath(fileparts(mfilename('fullpath')));
% PROBE_SHOWSIG=1 prints both signatures for every case, not only for failures —
% which is how you check that a PASS on an object entry is not vacuous.
wbcompare(outdir, ~isempty(getenv('PROBE_SHOWSIG')));
disp('WRITEBACKBINDONE');
