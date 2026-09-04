% Which Matrix(...) serial spellings can MATLAB's own reader read back?
%
% We write that string in two places (the .sldd reader's output and the node's
% write-back), and they had drifted apart. MATLAB is the only authority on which
% form is legal, so it was asked directly: each probe is a copy of
% test/parity/artifacts/text/cases.sldd -- an uncompressed-text dictionary MATLAB
% itself wrote -- with ONE entry's typed literal replaced by a candidate spelling,
% then opened with Simulink.data.dictionary.open and read back.
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('test/parity/matlab/probe_matrix_serial.m')"
%
% Answers observed (recorded in src/datamodel/parser/XmlUtils.ts formatMatrixSerial
% and test/crossPhaseShape.test.ts):
%
%   A_grouped_dot    double  [2 3]   1 4 2 5 3 6
%   B_grouped_nodot  double  [2 3]           the '.0' is optional
%   C_newline_rows   double  [1 0]   ** EMPTY -- the body is silently discarded **
%   D_row_flat       double  [1 3]
%   E_row_grouped    double  [1 3]
%   F_col_grouped    double  [3 1]
%   G_logical        logical [1 3]
%   H_int16          int16   [2 3]
%   I_uint64         uint64  [1 3]
%
% So bracketed groups joined with '; ' are accepted at every rank and every class,
% and the newline-joined form is read as a 1x0 empty. It does not error: a user who
% edited a multi-row matrix got a file that opened cleanly with the value gone.

here = fileparts(mfilename('fullpath'));
src = fullfile(here, '..', 'artifacts', 'text', 'cases.sldd');
outdir = fullfile(tempdir, 'matrix_serial_probe');
if ~exist(outdir, 'dir'), mkdir(outdir); end

% tag | entry to overwrite | _type | candidate _value. These entries are the ones
% MATLAB stored as typed literals, so each already has a _type/_value pair to
% replace; rowVec and the other plain doubles are bare JSON arrays instead.
% '\n' here is a literal backslash-n, which is how the JSON body spells its newline.
probes = { ...
    'A_grouped_dot',   'mat2x3',  'double',  'Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]'; ...
    'B_grouped_nodot', 'mat2x3',  'double',  'Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]]'; ...
    'C_newline_rows',  'mat2x3',  'double',  'Matrix(2,3)\n[1, 2, 3]\n[4, 5, 6]'; ...
    'D_row_flat',      'colVec',  'double',  'Matrix(1,3)\n[1.0, 2.0, 3.0]'; ...
    'E_row_grouped',   'colVec',  'double',  'Matrix(1,3)\n[[1.0, 2.0, 3.0]]'; ...
    'F_col_grouped',   'colVec',  'double',  'Matrix(3,1)\n[[1.0]; [2.0]; [3.0]]'; ...
    'G_logical',       'boolVec', 'logical', 'Matrix(1,3)\n[1, 0, 1]'; ...
    'H_int16',         'i16Vec',  'int16',   'Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]]'; ...
    'I_uint64',        'u64Vec',  'uint64',  'Matrix(1,3)\n[18446744073709551615U, 1U, 0U]'};

txt0 = fileread(src);
for k = 1:size(probes, 1)
    tag = probes{k,1}; ent = probes{k,2};
    f = fullfile(outdir, [tag '.sldd']);
    fid = fopen(f, 'w');
    fwrite(fid, patchEntry(txt0, ent, probes{k,3}, probes{k,4}));
    fclose(fid);
    fprintf('##### %s (%s <- %s %s)\n', tag, ent, probes{k,3}, probes{k,4});
    try
        d = Simulink.data.dictionary.open(f);
        v = d.getSection('Design Data').getEntry(ent).getValue();
        fprintf('  class=%s size=%s numel=%d values=%s\n', ...
            class(v), mat2str(size(v)), numel(v), mat2str(double(v(:)).'));
        d.close();
    catch ME
        fprintf('  ERROR %s | %s\n', ME.identifier, ME.message);
    end
end
disp('PROBEDONE');

% Replace one entry's _type/_value pair by char surgery rather than
% jsondecode/jsonencode: re-encoding the whole dictionary would reformat every other
% entry too, and the question here is what the reader does with ONE changed body.
% The entry's own value block is the first _type/_value pair after its name -- the
% file lists each entry as name, metadata, value, in that order.
function txt = patchEntry(txt, ent, newType, newBody)
    at = strfind(txt, ['"name": "' ent '"']);
    assert(~isempty(at), 'entry %s not found in the artifact', ent);
    rest = txt(at(1):end);
    [ts, te] = regexp(rest, '"_type": "[^"]*"', 'start', 'end', 'once');
    [vs, ve] = regexp(rest, '"_value": "[^"]*"', 'start', 'end', 'once');
    assert(~isempty(ts) && ~isempty(vs) && vs > te, ...
        'entry %s is not stored as a typed literal', ent);
    rest = [rest(1:ts-1) '"_type": "' newType '"' rest(te+1:vs-1) ...
        '"_value": "' newBody '"' rest(ve+1:end)];
    txt = [txt(1:at(1)-1) rest];
end
