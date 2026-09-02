% Ground-truth fixture generator for findings C1-C5.
outdir = '/tmp/c4probe';
truth = struct();

%% --- C4: a 2x3 Simulink.Parameter object array, distinguishable Values ---
% Value = row*10 + col, so the label->value mapping is self-describing.
clear w
for i = 1:2
    for j = 1:3
        w(i,j) = Simulink.Parameter(i*10 + j);
    end
end
truth.w_size = size(w);
% MATLAB's own linear order (column-major) and the subscript of each linear index
lin = zeros(1, numel(w));
subs = cell(1, numel(w));
for k = 1:numel(w)
    lin(k) = w(k).Value;
    [r, c] = ind2sub(size(w), k);
    subs{k} = sprintf('w(%d,%d)', r, c);
end
truth.w_linear_values = lin;      % w(1),w(2),... in MATLAB order
truth.w_linear_subs = subs;       % matching subscript label
truth.w_2_1 = w(2,1).Value;       % the discriminator: 21
truth.w_1_2 = w(1,2).Value;       % 12

%% --- C1: 2x3x2 double ---
A = zeros(2,3,2);
A(:,:,1) = [1 2 3; 4 5 6];
A(:,:,2) = [7 8 9; 10 11 12];
truth.A_size = size(A);
truth.A_linear = A(:)';
truth.A_disp = formattedDisplayText(A);
try, truth.A_mat2str = mat2str(A); catch e, truth.A_mat2str_error = e.message; end

%% --- C1: 2x2x2 cell ---
C = cell(2,2,2);
for k = 1:8, C{k} = k; end
truth.C_size = size(C);

%% --- C2: 2x3x2 struct array ---
clear s
for k = 1:12
    s(k).a = k;
end
s = reshape(s, [2 3 2]);
truth.s_size = size(s);
ssubs = cell(1, numel(s));
for k = 1:numel(s)
    [r,c,p] = ind2sub(size(s), k);
    ssubs{k} = sprintf('s(%d,%d,%d)', r, c, p);
end
truth.s_linear_subs = ssubs;
truth.s_linear_a = arrayfun(@(x) x.a, s(:))';

%% --- C2: 2x3x2 Simulink.Parameter array ---
clear v
for k = 1:12
    v(k) = Simulink.Parameter(k);
end
v = reshape(v, [2 3 2]);
truth.v_size = size(v);
vsubs = cell(1, numel(v));
for k = 1:numel(v)
    [r,c,p] = ind2sub(size(v), k);
    vsubs{k} = sprintf('v(%d,%d,%d)', r, c, p);
end
truth.v_linear_subs = vsubs;
truth.v_linear_values = arrayfun(@(x) x.Value, v(:))';

%% --- 2x3 plain double, for C5 ---
Kp = [1 2 3; 4 5 6];
truth.Kp_linear = Kp(:)';   % MATLAB's Kp(1..6) == 1 4 2 5 3 6
truth.Kp_2 = Kp(2);         % == 4

%% save .mat
save(fullfile(outdir, 'fix.mat'), 'w', 'A', 'C', 's', 'v', 'Kp');

%% save .sldd in both formats
for fmt = {'uncompressed-text', 'compressed-binary'}
    f = fmt{1};
    fn = fullfile(outdir, ['fix_' strrep(f,'-','_') '.sldd']);
    if exist(fn, 'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = f;
    ds = dd.getSection('Design Data');
    ds.addEntry('A', A);
    ds.addEntry('C', C);
    ds.addEntry('s', s);
    ds.addEntry('Kp', Kp);
    dd.saveChanges();
    dd.close();
end

fid = fopen(fullfile(outdir,'truth.json'), 'w');
fprintf(fid, '%s', jsonencode(truth));
fclose(fid);
disp('GEN OK');

%% Does the dictionary accept ANY object array? Probe the boundary.
fn = fullfile(outdir,'probe_objarr.sldd');
if exist(fn,'file'), delete(fn); end
dd2 = Simulink.data.dictionary.create(fn);
ds2 = dd2.getSection('Design Data');
report = {};
try, ds2.addEntry('pa', w); report{end+1} = 'Simulink.Parameter 2x3: OK'; catch e, report{end+1} = ['Simulink.Parameter 2x3: ' e.message]; end
try
    ba = [Simulink.Bus, Simulink.Bus];
    ds2.addEntry('ba', ba); report{end+1} = 'Simulink.Bus 1x2: OK';
catch e, report{end+1} = ['Simulink.Bus 1x2: ' e.message]; end
try
    pv = [Simulink.Parameter(1), Simulink.Parameter(2)];
    ds2.addEntry('pv', pv); report{end+1} = 'Simulink.Parameter 1x2: OK';
catch e, report{end+1} = ['Simulink.Parameter 1x2: ' e.message]; end
dd2.close();
disp('--- OBJECT ARRAY IN DICTIONARY ---');
for i=1:numel(report), disp(report{i}); end
