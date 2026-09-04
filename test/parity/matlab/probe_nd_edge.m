% Copyright 2026 The MathWorks, Inc.
%
% The two N-D edge shapes probe_ndarray.m does not cover, in BOTH dictionary
% formats. Both exist because a rank-2 reading of them is not merely wrong, it
% crashes MATLAB or silently drops data:
%
%   1*1*3  d(1) and d(2) are BOTH 1, so a rank-2 writer drops the Dimension
%          attribute altogether and treats a three-element array as a scalar
%          struct — MATLAB answers the resulting nested <Element><Element> with
%          a segmentation violation in ElementPart.cpp.
%   2*3*2 complex
%          MATLAB spells a complex array as IsComplex="1" with a flat
%          column-major text body, which a rows x cols loop reads six values of.
%
% Writes /tmp/ndedge/{nd11,ndz}_{binary,text}.sldd. The binary pair is committed
% as test/fixtures/nd_1x1x3.sldd and test/fixtures/nd_complex.sldd:
%
%   mw -using Bmain matlab -nodesktop -batch "run('<repo>/test/parity/matlab/probe_nd_edge.m')"
%   cp /tmp/ndedge/nd11_binary.sldd test/fixtures/nd_1x1x3.sldd
%   cp /tmp/ndedge/ndz_binary.sldd  test/fixtures/nd_complex.sldd

outdir = '/tmp/ndedge';
if ~exist(outdir, 'dir'), mkdir(outdir); end

clear s113
for k = 1:3, s113(k).a = k; end
s113 = reshape(s113, [1 1 3]);
A113 = reshape(1:3, [1 1 3]);
Z = complex(reshape(1:12, [2 3 2]), reshape(1:12, [2 3 2]));

disp(['size(s113) = ' mat2str(size(s113))]);
disp(['size(A113) = ' mat2str(size(A113))]);
disp(['size(Z)    = ' mat2str(size(Z)) ' isreal=' num2str(isreal(Z))]);

FORMATS = {'compressed-binary', 'binary'; 'uncompressed-text', 'text'};
SPECS = {'nd11', {'s113', s113, 'A113', A113}; 'ndz', {'Z', Z}};
for fi = 1:size(FORMATS, 1)
    f = FORMATS{fi, 1};
    tag = FORMATS{fi, 2};
    for si = 1:size(SPECS, 1)
        base = SPECS{si, 1};
        pairs = SPECS{si, 2};
        fn = fullfile(outdir, [base '_' tag '.sldd']);
        if exist(fn, 'file'), delete(fn); end
        dd = Simulink.data.dictionary.create(fn);
        dd.FileFormat = f;
        ds = dd.getSection('Design Data');
        for k = 1:2:numel(pairs)
            try
                ds.addEntry(pairs{k}, pairs{k+1});
                disp([fn ' <- ' pairs{k} ' OK']);
            catch e
                disp([fn ' <- ' pairs{k} ' FAIL: ' e.message]);
            end
        end
        dd.saveChanges();
        dd.close();
    end
end
Simulink.data.dictionary.closeAll('-discard');
disp('ND_EDGE OK');
