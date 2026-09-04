% What does MATLAB itself write into an uncompressed-text .sldd for a rank >= 3
% value of EVERY kind, and what exactly goes in the cdata byte stream?
%
% Why this exists: defect 22. A text dictionary's `_value` literal grammar stops
% at rank 2 (probe_rank3_serial.m: all six candidate spellings read back empty),
% so the only form MATLAB accepts at rank >= 3 is `{"_type": "cdata"}`, a
% uuencoded MAT byte stream. cases.sldd carries three of those (nd2x3x2, cellNd,
% structNd) and they are all-double, one-field, one-char-name -- too uniform to
% pin down the encoder. This probe widens the corpus so the writer has real
% answers instead of guesses for:
%
%   * the struct field-name STRIDE (structNd shows 5 for a single field 'a';
%     is that maxlen+1 rounded somehow, or a constant? -> field names of
%     length 1, 2 and 8 here settle it)
%   * which MAT class/flags MATLAB picks for a logical, and its payload type
%   * the char payload element type (miUTF8 vs miUINT16) and its declared dims
%   * whether a cell's elements carry names, and what a NESTED cell/struct looks
%     like inside one
%   * whether rank >= 3 forces cdata for every kind, or only for some
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('test/parity/matlab/probe_nd_rich.m')"

outdir = getenv('ND_RICH_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'ndrich'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end

ndDouble  = reshape(1:12, [2 3 2]);
ndSingle  = single(reshape(1:8, [2 2 2]));
ndInt32   = int32(reshape(1:8, [2 2 2]));
ndUint64  = uint64(reshape(1:8, [2 2 2]));
ndLogical = reshape([true false true true false false true false], [2 2 2]);
ndChar    = reshape('abcdefghijkl', [2 3 2]);
ndComplex = complex(reshape(1:8, [2 2 2]), reshape(11:18, [2 2 2]));

% A cell whose slots deliberately disagree in class, so the encoder cannot get
% away with assuming every element is a scalar double (which is all cellNd has).
ndCellMixed = cell(2, 2, 2);
ndCellMixed{1,1,1} = 42;
ndCellMixed{2,1,1} = 'txt';
ndCellMixed{1,2,1} = int32(7);
ndCellMixed{2,2,1} = true;
ndCellMixed{1,1,2} = [1 2 3];
ndCellMixed{2,1,2} = {1, 'in'};
ndCellMixed{1,2,2} = struct('f', 5);
ndCellMixed{2,2,2} = reshape(1:4, [2 1 2]);

% Three field names of different lengths: 1, 2 and 8 characters.
clear ndStructMulti
for k = 1:8
    ndStructMulti(k).a = k;
    ndStructMulti(k).bb = sprintf('e%d', k);
    ndStructMulti(k).cccccccc = int32([k k+1]);
end
ndStructMulti = reshape(ndStructMulti, [2 2 2]);

% One struct per longest-field-name length, to pin the stride rule down. The
% first run gave stride 5 for a 1-char field and 9 for an 8-char one, which
% rules out both maxlen+1 (would be 2) and any 4-byte rounding of maxlen+1
% (would be 13). max(maxlen, 4) + 1 fits both; these settle lengths 3 to 6.
strideCases = {};
for n = 3:6
    fname = repmat('z', 1, n);
    clear s
    for k = 1:4
        s(k).(fname) = k;
    end
    strideCases = [strideCases; {sprintf('ndStride%d', n), reshape(s, [2 1 2])}]; %#ok<AGROW>
end

C = [{ ...
    'ndDouble', ndDouble; 'ndSingle', ndSingle; 'ndInt32', ndInt32; ...
    'ndUint64', ndUint64; 'ndLogical', ndLogical; 'ndChar', ndChar; ...
    'ndComplex', ndComplex; 'ndCellMixed', ndCellMixed; ...
    'ndStructMulti', ndStructMulti}; strideCases];

Simulink.data.dictionary.closeAll('-discard');
fn = fullfile(outdir, 'nd_rich.sldd');
if exist(fn, 'file'), delete(fn); end
dd = Simulink.data.dictionary.create(fn);
dd.FileFormat = 'uncompressed-text';
ds = dd.getSection('Design Data');
for i = 1:size(C, 1)
    try
        ds.addEntry(C{i,1}, C{i,2});
        v = C{i,2};
        fprintf('added %-14s %-8s %s\n', C{i,1}, class(v), mat2str(size(v)));
    catch e
        fprintf('REJECTED %-14s %s\n', C{i,1}, e.message);
    end
end
clear ds
dd.saveChanges();
dd.close();

% Read every entry back from the file MATLAB just wrote, so the probe reports
% what survived a save/open cycle rather than what was handed to addEntry.
dd = Simulink.data.dictionary.open(fn);
ds = dd.getSection('Design Data');
for i = 1:size(C, 1)
    try
        v = ds.getEntry(C{i,1}).getValue();
        fprintf('read  %-14s %-8s %s numel=%d\n', C{i,1}, class(v), mat2str(size(v)), numel(v));
    catch e
        fprintf('READFAIL %-14s %s\n', C{i,1}, e.message);
    end
end
clear ds
dd.close();

fprintf('FILE %s\n', fn);
disp('ND_RICH OK');
