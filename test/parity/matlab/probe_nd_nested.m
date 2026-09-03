% Where does a text dictionary put the cdata when the rank >= 3 value is NESTED?
%
% probe_nd_rich.m settled the TOP-LEVEL question: every rank >= 3 entry of every
% kind is written as `{"_type": "cdata"}` (defect 22). That leaves the shape of
% the fix open, because our own `serializeValue()` is one form shared by three
% consumers -- the text .sldd JSON, the .slx/binary-.sldd XML, and cross-format
% paste -- and the answer decides how deep the JSON side has to convert:
%
%   * a Simulink.Parameter whose Value is 2x3x2: is the cdata the whole object,
%     or just the Value property inside the object's _properties bag?
%   * a scalar struct with a 2x3x2 field: cdata per field, or one cdata for the
%     whole struct (which IS rank 2, so its own literal form is available)?
%   * a 1x2 cell holding a 2x3x2: same question one level down.
%   * a Simulink.Signal, to check the answer is about the value and not about
%     Simulink.Parameter in particular.
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('test/parity/matlab/probe_nd_nested.m')"

outdir = getenv('ND_NESTED_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'ndnested'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end

nd = reshape(1:12, [2 3 2]);

p = Simulink.Parameter;
p.Value = nd;

sig = Simulink.Signal;
sig.Dimensions = [2 3 2];

sNested = struct('flat', 7, 'deep', nd);
cNested = {1, nd};
sTwoLevel = struct('inner', struct('deep', nd));

C = { ...
    'ndTop',      nd; ...
    'ndParam',    p; ...
    'ndSignal',   sig; ...
    'ndInStruct', sNested; ...
    'ndInCell',   cNested; ...
    'ndTwoLevel', sTwoLevel};

Simulink.data.dictionary.closeAll('-discard');
fn = fullfile(outdir, 'nd_nested.sldd');
if exist(fn, 'file'), delete(fn); end
dd = Simulink.data.dictionary.create(fn);
dd.FileFormat = 'uncompressed-text';
ds = dd.getSection('Design Data');
for i = 1:size(C, 1)
    try
        ds.addEntry(C{i,1}, C{i,2});
        fprintf('added %-12s %s\n', C{i,1}, class(C{i,2}));
    catch e
        fprintf('REJECTED %-12s %s\n', C{i,1}, e.message);
    end
end
clear ds
dd.saveChanges();
dd.close();

% Report what MATLAB reads back, so a spelling that saves but does not load is
% visible here rather than three phases later.
dd = Simulink.data.dictionary.open(fn);
ds = dd.getSection('Design Data');
for i = 1:size(C, 1)
    try
        v = ds.getEntry(C{i,1}).getValue();
        if isa(v, 'Simulink.Parameter')
            fprintf('read  %-12s Simulink.Parameter Value %-8s %s numel=%d\n', ...
                C{i,1}, class(v.Value), mat2str(size(v.Value)), numel(v.Value));
        elseif isstruct(v) && isfield(v, 'deep')
            fprintf('read  %-12s struct deep %-8s %s numel=%d\n', ...
                C{i,1}, class(v.deep), mat2str(size(v.deep)), numel(v.deep));
        elseif isstruct(v) && isfield(v, 'inner')
            fprintf('read  %-12s struct inner.deep %s numel=%d\n', ...
                C{i,1}, mat2str(size(v.inner.deep)), numel(v.inner.deep));
        elseif iscell(v)
            fprintf('read  %-12s cell{2} %-8s %s numel=%d\n', ...
                C{i,1}, class(v{2}), mat2str(size(v{2})), numel(v{2}));
        else
            fprintf('read  %-12s %-18s %s numel=%d\n', C{i,1}, class(v), mat2str(size(v)), numel(v));
        end
    catch e
        fprintf('READFAIL %-12s %s\n', C{i,1}, e.message);
    end
end
clear ds
dd.close();

% The point of the probe: WHERE in the JSON the cdata sits. Print each entry's
% raw JSON text, trimmed, so a cdata body does not bury the structure.
txt = fileread(fn);
for i = 1:size(C, 1)
    name = C{i,1};
    k = strfind(txt, ['"name": "' name '"']);
    if isempty(k), fprintf('NOJSON %s\n', name); continue; end
    seg = txt(k(1):min(numel(txt), k(1)+3000));
    stop = strfind(seg, '"name": "');
    if numel(stop) > 1, seg = seg(1:stop(2)-1); end
    seg = regexprep(seg, '"_value": "[^\n]{60,}', '"_value": "<CDATA len=?>');
    seg = regexprep(seg, '\s+', ' ');
    fprintf('\nJSON %s\n%s\n', name, seg);
end

fprintf('FILE %s\n', fn);
disp('ND_NESTED OK');
