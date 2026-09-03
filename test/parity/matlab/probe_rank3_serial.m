% Is there ANY literal spelling for a rank>=3 value in an uncompressed-text
% .sldd, or is the cdata MAT byte stream the only form MATLAB reads?
%
% Why this exists: Phase 6 widened the serial header to `Matrix(d1,...,dn)` on the
% strength of probe_matrix_serial.m, whose table has no rank-3 row. Asked directly,
% MATLAB reads `Matrix(2,3,2)` as a 1x0 empty -- so the widened header silently
% destroyed every N-D value written to a text dictionary. MATLAB's own file stores
% nd2x3x2, cellNd and structNd as {"_type":"cdata"} instead, which is the clue this
% probe chases: `_value` for a typed entry looks like a MATLAB expression
% (i16Vec is stored as the bare literal "[1, 2, 3]"), so an expression that
% CONSTRUCTS a rank-3 array might be legal where a widened header is not.
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('test/parity/matlab/probe_rank3_serial.m')"
%
% Target: MATLAB's own nd2x3x2, A(:,:,1) = [1 2 3; 4 5 6], A(:,:,2) = [7 8 9; 10 11 12],
% so size [2 3 2] and A(:)' = [1 4 2 5 3 6 7 10 8 11 9 12].

here = fileparts(mfilename('fullpath'));
src = fullfile(here, '..', 'artifacts', 'text', 'cases.sldd');
outdir = fullfile(tempdir, 'rank3_serial_probe');
if ~exist(outdir, 'dir'), mkdir(outdir); end

want = [1 4 2 5 3 6 7 10 8 11 9 12];
colMajorList = '1.0, 4.0, 2.0, 5.0, 3.0, 6.0, 7.0, 10.0, 8.0, 11.0, 9.0, 12.0';
rowsList = '[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]; [7.0, 8.0, 9.0]; [10.0, 11.0, 12.0]]';

probes = { ...
    'R1_header_pagerows', ['Matrix(2,3,2)\n' rowsList]; ...
    'R2_reshape_expr',    ['reshape([' colMajorList '], 2, 3, 2)']; ...
    'R3_cat3_expr',       'cat(3, [[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]], [[7.0, 8.0, 9.0]; [10.0, 11.0, 12.0]])'; ...
    'R4_header_flatcol',  ['Matrix(2,3,2)\n[' colMajorList ']']; ...
    'R5_header_nested',   'Matrix(2,3,2)\n[[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]], [[7.0, 8.0, 9.0]; [10.0, 11.0, 12.0]]]'; ...
    'R6_header_reshape',  ['Matrix(2,3,2)\nreshape([' colMajorList '], 2, 3, 2)']};

% The carrier must be an entry MATLAB stored as a SHORT typed literal. nd2x3x2
% itself is stored as cdata, and uuencode's alphabet (0x20-0x5F) includes the
% double-quote, so a regex patch of that body truncates at an escaped quote and
% corrupts the JSON -- which shows up as every candidate "failing to open",
% an artifact of the probe rather than an answer from MATLAB.
CARRIER = 'mat2x3';
txt0 = fileread(src);
fprintf('TARGET size=[2 3 2] colmajor=%s\n', mat2str(want));
for k = 1:size(probes, 1)
    tag = probes{k,1};
    f = fullfile(outdir, [tag '.sldd']);
    fid = fopen(f, 'w');
    fwrite(fid, patchEntry(txt0, CARRIER, 'double', probes{k,2}));
    fclose(fid);
    fprintf('##### %s\n   sent: %s\n', tag, probes{k,2});
    try
        d = Simulink.data.dictionary.open(f);
        v = d.getSection('Design Data').getEntry(CARRIER).getValue();
        got = double(v(:)).';
        ok = isequal(size(v), [2 3 2]) && isequal(got, want);
        fprintf('   class=%s size=%s colmajor=%s  ==> %s\n', ...
            class(v), mat2str(size(v)), mat2str(got), string(ok));
        d.close();
    catch ME
        fprintf('   ERROR %s | %s\n', ME.identifier, ME.message);
    end
end
disp('RANK3DONE');

function txt = patchEntry(txt, ent, newType, newBody)
    at = strfind(txt, ['"name": "' ent '"']);
    assert(~isempty(at), 'entry %s not found', ent);
    rest = txt(at(1):end);
    [ts, te] = regexp(rest, '"_type": "[^"]*"', 'start', 'end', 'once');
    [vs, ve] = regexp(rest, '"_value": "[^"]*"', 'start', 'end', 'once');
    assert(~isempty(ts) && ~isempty(vs) && vs > te, '%s is not a typed literal', ent);
    rest = [rest(1:ts-1) '"_type": "' newType '"' rest(te+1:vs-1) ...
        '"_value": "' newBody '"' rest(ve+1:end)];
    txt = [txt(1:at(1)-1) rest];
end
