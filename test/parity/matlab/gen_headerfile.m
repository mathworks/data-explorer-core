% Copyright 2026 The MathWorks, Inc.
%
% The Header File fixtures: one dictionary, in each format, whose Parameter and Signal carry a
% Header File, for test/parity/fidelity/schemaColumns.fidelity.test.ts.
%
% A Header File is not a property of a Parameter or a Signal. It is CoderInfo.CustomAttributes.
% HeaderFile, which only a file-based custom storage class has (ExportToFile here). Design Data:
%
%   hdrParam    Simulink.Parameter(3.14), ExportToFile, HeaderFile 'params_hdr.h'
%   hdrSignal   Simulink.Signal, ExportToFile, HeaderFile 'signals_hdr.h'
%   plainParam  Simulink.Parameter(1.0), StorageClass Auto: no CustomAttributes at all
%
% Writes ../artifacts/text/headerfile.sldd (FileFormat 'uncompressed-text') and
% ../artifacts/binary/headerfile.sldd ('compressed-binary'). The committed text one is this
% script's, run under R2027a on 2026-11-01. The committed binary one is data-explorer-view's
% test/parity/artifacts/binary/headerfile.sldd, byte for byte, written on 2026-08-13 by the
% generator this one follows (view's "text" one is a compressed-binary dictionary too, so it was
% not brought). A re-run gives new UUIDs and timestamps and the same values; a new binary one
% needs its M9 rows asked again (test/parity/m9MergedSaves.truth.test.ts).
%
% Run:  mw -using Bmain matlab -nodesktop -batch "run('<abs path>/gen_headerfile.m')"
%
% Prints `GEN_HEADERFILE OK`. Honours an `outdir` set by the caller, like gen_slx.m.

here = fileparts(mfilename('fullpath'));
if ~exist('outdir', 'var') || isempty(outdir)
    outdir = fullfile(here, '..', 'artifacts');
end

hp = Simulink.Parameter(3.14);
hp.DataType = 'double';
hp.Description = 'param with header file';
hp.CoderInfo.StorageClass = 'Custom';
hp.CoderInfo.CustomStorageClass = 'ExportToFile';
hp.CoderInfo.CustomAttributes.HeaderFile = 'params_hdr.h';

hs = Simulink.Signal;
hs.DataType = 'double';
hs.Description = 'signal with header file';
hs.CoderInfo.StorageClass = 'Custom';
hs.CoderInfo.CustomStorageClass = 'ExportToFile';
hs.CoderInfo.CustomAttributes.HeaderFile = 'signals_hdr.h';

plainP = Simulink.Parameter(1.0);
plainP.DataType = 'double';

Simulink.data.dictionary.closeAll('-discard');
formats = {'uncompressed-text', 'text'; 'compressed-binary', 'binary'};
for i = 1:size(formats, 1)
    dir_ = fullfile(outdir, formats{i, 2});
    if ~exist(dir_, 'dir'), mkdir(dir_); end
    fn = fullfile(dir_, 'headerfile.sldd');
    if exist(fn, 'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = formats{i, 1};
    ds = dd.getSection('Design Data');
    ds.addEntry('hdrParam', hp);
    ds.addEntry('hdrSignal', hs);
    ds.addEntry('plainParam', plainP);
    clear ds
    dd.saveChanges();
    dd.close();
    fprintf('WROTE %s\n', fn);
end
Simulink.data.dictionary.closeAll('-discard');
fprintf('%s\n', version);
fprintf('GEN_HEADERFILE OK\n');
