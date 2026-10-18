% Copyright 2026 The MathWorks, Inc.
% Which uncompressed sizes does MATLAB write as a v7 (compressed) variable?
%
% Half of the generator of v7_record_limit.truth.json, with v7struct.m. Run (one line: mw
% splits -batch on newlines):
%
%   mw -using Bmain matlab -nodesktop -batch "run('<this folder>/v7limit.m')"
%
% It writes v7limit.txt and one .mat per size into `d`, a scratch folder: the files are
% 7.6 MB each and are not fixtures. Run on R2027a (Bmain) on 2026-10-17 with `d` a scratch
% folder under /tmp; this copy differs from that run only in its paths (the folder is named
% once, as `d`, so the listing `dir` returns is `dd`). The inflated size of each written
% record is not something MATLAB reports: it was read out of each file's one compressed
% record, as its inner tag's size plus that tag's 8 bytes (every corpus record inflates to
% exactly that), and is in the truth file as `recordInflatesTo`.
d = fullfile(tempdir, 'v7limit');
if ~exist(d, 'dir'), mkdir(d); end
out = fopen(fullfile(d, 'v7limit.txt'), 'w');
sizes = [2^31 - 1024, 2^31 - 64, 2^31 - 48, 2^31, 2^31 + 1024];
for s = sizes
    x = zeros(s, 1, 'uint8'); %#ok<NASGU>
    f = fullfile(d, sprintf('v7_%d.mat', s));
    lastwarn('');
    try
        save(f, 'x', '-v7');
        [msg, id] = lastwarn;
        dd = dir(f);
        if isempty(dd), b = -1; else, b = dd.bytes; end
        fprintf(out, 'bytes=%d saved_file=%d warn=[%s] id=[%s]\n', s, b, msg, id);
    catch e
        fprintf(out, 'bytes=%d error=[%s] id=[%s]\n', s, e.message, e.identifier);
    end
    clear x
end
fclose(out);
