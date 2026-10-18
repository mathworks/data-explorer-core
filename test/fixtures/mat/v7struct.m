% Copyright 2026 The MathWorks, Inc.
% Does MATLAB's 2 GB v7 limit bound the SERIALIZED record, or the in-memory size?
% A struct array of empty fields: ~8 bytes per element in memory, ~48 serialized.
%
% The other half of the generator of v7_record_limit.truth.json (see v7limit.m, which says
% how it was run). It writes v7struct.txt into the same scratch folder.
d = fullfile(tempdir, 'v7limit');
if ~exist(d, 'dir'), mkdir(d); end
out = fopen(fullfile(d, 'v7struct.txt'), 'w');
for n = [2^25, 2^26]
    s = repmat(struct('a', []), 1, n); %#ok<NASGU>
    w = whos('s');
    f = fullfile(d, sprintf('v7s_%d.mat', n));
    lastwarn('');
    t = tic;
    try
        save(f, 's', '-v7');
        [msg, id] = lastwarn;
        dd = dir(f);
        fprintf(out, 'n=%d whos_bytes=%d saved_file=%d warn=[%s] id=[%s] t=%.1f\n', n, w.bytes, dd.bytes, msg, id, toc(t));
    catch e
        fprintf(out, 'n=%d whos_bytes=%d error=[%s] id=[%s]\n', n, w.bytes, e.message, e.identifier);
    end
    clear s
end
fclose(out);
