% The MATLAB half of the TEXT write-path acceptance gate. Read back every
% dictionary probe_writeback.mjs spliced our serializer's output into, and report
% what MATLAB actually sees.
%
% Run the JS half first, with the SAME absolute PROBE_OUT (and `npm run build`
% before it — the JS half reads dist/, so a stale build is a stale verdict):
%   env PROBE_OUT=/tmp/wb node test/parity/matlab/probe_writeback.mjs
%   env PROBE_OUT=/tmp/wb mw -using Bmain matlab -nodesktop \
%       -batch "run('$PWD/test/parity/matlab/probe_writeback.m')"
%
% The controls are unedited re-stringifies of MATLAB's own files: if one of those
% does not read cleanly, the probe's JSON handling is at fault and no verdict below
% means anything.
%
% Last line: `WRITEBACK FAILURES n of m`. Zero is the only acceptable result. The
% comparison engine is wbcompare.m, shared with the binary gate.
outdir = getenv('PROBE_OUT');
if isempty(outdir)
    error('PROBE_OUT is not set. It must be the same ABSOLUTE path the .mjs half used.');
end
% `run(...)` starts in whatever directory the launcher did, so the shared engine has
% to be put on the path explicitly.
addpath(fileparts(mfilename('fullpath')));
% PROBE_SHOWSIG=1 prints both signatures for every case, not only for failures —
% which is how you check that a PASS is not vacuous.
wbcompare(outdir, ~isempty(getenv('PROBE_SHOWSIG')));
disp('WRITEBACKDONE');
