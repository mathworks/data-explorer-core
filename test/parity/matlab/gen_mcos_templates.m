% Copyright 2026 The MathWorks, Inc.
%
% The MCOS templates core creates an object in a MAT-file from: one small MAT-file per class
% core can create (McosTemplateMerge.ts, CREATABLE_MCOS_CLASSES), each holding ONE
% default-constructed instance in the variable `obj`, and mcos_templates.truth.json with what
% MATLAB says of each: its property values, recursively, and every class's saved-property
% order (metaclass PropertyList order without Transient, Dependent and Constant properties,
% the order MATLAB writes a property list in).
%
% RUN IT IN MATLAB R2023b. A template is what its release's own `save -append` writes for a
% new object, so an object core merges from it is one that release would have written, and a
% file core adds it to loads in that release and every later one. Measured: objects merged
% from the R2023b templates load equal in R2023b, R2024b and R2027a, into files each of them
% wrote; objects R2027a writes do not load in R2024b (its Simulink.CoderInfo is refused, and
% a Simulink.LookupTable makes R2024b fail outright). R2023b is the oldest release this was
% run in. The committed templates are from 23.2.0.3186351 (R2023b) Update 11.
%
%   matlab -nodesktop -batch "outdir='/tmp/mcos_templates'; run('<abs path>/gen_mcos_templates.m')"
%   node test/parity/matlab/mcos_templates_module.mjs /tmp/mcos_templates
%
% The second line writes src/datamodel/parser/mcosTemplates.ts and copies the truth next to
% this script (README.md, "The MCOS template corpus"). Two runs of one release write the same
% bytes after each file's 128-byte header, the only part that carries a date. The files hold
% no name and no path; the module script refuses ones that do.

if ~exist('outdir', 'var') || isempty(outdir)
    outdir = fullfile(tempdir, 'mcos_templates');
end
if ~exist(outdir, 'dir'), mkdir(outdir); end
cd(outdir);

% {template file stem, MATLAB expression}. Every one is the class's default
% constructor: what MATLAB itself creates for a new entry of the class.
T = {
    'Simulink.Parameter',   'Simulink.Parameter'
    'Simulink.Signal',      'Simulink.Signal'
    'Simulink.Bus',         'Simulink.Bus'
    'Simulink.BusElement',  'Simulink.BusElement'
    'Simulink.LookupTable', 'Simulink.LookupTable'
    'Simulink.Breakpoint',  'Simulink.Breakpoint'
    'Simulink.NumericType', 'Simulink.NumericType'
    'Simulink.AliasType',   'Simulink.AliasType'
    'Simulink.ValueType',   'Simulink.ValueType'
    'string',               'string("")'
    };

truth = struct();
truth.version = version;
truth.release = version('-release');
truth.templates = {};
order = containers.Map();
for i = 1:size(T, 1)
    stem = T{i, 1};
    lastwarn('');
    obj = eval(T{i, 2});
    [w, wid] = lastwarn;
    if ~isempty(w), fprintf('WARN building %s: %s (%s)\n', stem, w, wid); end
    file = [stem '.mat'];
    save(file, 'obj', '-v7');
    t = struct();
    t.file = file;
    t.variable = 'obj';
    t.expression = T{i, 2};
    t.class = class(obj);
    t.isHandle = isa(obj, 'handle');
    t.value = describe(obj, order, 0);
    truth.templates{end + 1} = t;
    info = dir(file);
    fprintf('TEMPLATE %s %s %d bytes\n', stem, class(obj), info.bytes);
end

% The saved-property order of every class the templates hold, nested ones too.
truth.savedOrder = struct();
names = sort(keys(order));
for i = 1:numel(names)
    mc = meta.class.fromName(names{i});
    if isempty(mc), continue; end
    saved = {};
    for k = 1:numel(mc.PropertyList)
        pr = mc.PropertyList(k);
        if pr.Transient || pr.Dependent || pr.Constant, continue; end
        saved{end + 1} = pr.Name; %#ok<SAGROW>
    end
    truth.savedOrder.(strrep(names{i}, '.', '__')) = saved;
end

fid = fopen('mcos_templates.truth.json', 'w');
fprintf(fid, '%s', jsonencode(truth, 'PrettyPrint', true));
fclose(fid);
fprintf('GEN_MCOS_TEMPLATES DONE %s templates=%d\n', truth.release, size(T, 1));

% A value as JSON: its class and size, then numbers (column-major) and text as
% they are, an object's public properties recursively (per element of an
% array), an enumeration member by name.
function d = describe(v, order, depth)
d = struct('class', class(v), 'size', size(v));
if depth > 8
    d.truncated = true;
    return;
end
try
    mc = metaclass(v);
catch
    mc = [];
end
if ~isempty(mc) && mc.Enumeration
    d.value = arrayfun(@char, v(:)', 'UniformOutput', false);
elseif isstring(v)
    d.value = cellstr(v(:)');
    d.missing = num2cell(ismissing(v(:)'));
elseif isobject(v)
    if isa(mc, 'meta.class') && ~isempty(mc), order(mc.Name) = true; end
    d.elements = cell(1, numel(v));
    for e = 1:numel(v)
        % (some classes refuse v(1) on a scalar: CustomAttributes errors ObjectMustBeScalar)
        if isscalar(v), o = v; else, o = v(e); end
        p = properties(o);
        s = struct();
        for k = 1:numel(p)
            try
                s.(p{k}) = describe(o.(p{k}), order, depth + 1);
            catch err
                s.(p{k}) = struct('error', err.identifier);
            end
        end
        d.elements{e} = s;
    end
elseif ischar(v)
    d.value = v;
elseif isnumeric(v) || islogical(v)
    if isreal(v)
        d.value = num2cell(v(:)');
    else
        d.value = num2cell(real(v(:)'));
        d.imag = num2cell(imag(v(:)'));
    end
elseif isstruct(v)
    f = fieldnames(v);
    d.fields = f';
    d.elements = cell(1, numel(v));
    for e = 1:numel(v)
        s = struct();
        for k = 1:numel(f)
            s.(f{k}) = describe(v(e).(f{k}), order, depth + 1);
        end
        d.elements{e} = s;
    end
elseif iscell(v)
    d.elements = cellfun(@(x) describe(x, order, depth + 1), v(:)', 'UniformOutput', false);
else
    % An object of the class system before MCOS (R2023b and R2024b's Simulink.CoderInfo,
    % which they save as a 'handle' opaque): get() lists its properties.
    try
        g = get(v);
        f = fieldnames(g);
        s = struct();
        for k = 1:numel(f)
            s.(f{k}) = describe(g.(f{k}), order, depth + 1);
        end
        d.elements = {s};
    catch
        d.value = '<not described>';
    end
end
end

