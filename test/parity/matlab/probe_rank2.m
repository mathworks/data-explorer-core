outdir = '/tmp/c4probe';
truth = struct();

% 1x3 object vector (row-major == col-major; expect CORRECT)
clear ov; for j=1:3, ov(1,j) = Simulink.Parameter(100+j); end
truth.ov = arrayfun(@(x) x.Value, ov(:))';

% 3x1 object column vector
clear oc; for i=1:3, oc(i,1) = Simulink.Parameter(200+i); end
truth.oc = arrayfun(@(x) x.Value, oc(:))';

% 2x3 rank-2 struct array
clear s2; for i=1:2, for j=1:3, s2(i,j).a = i*10+j; end, end
truth.s2_linear_a = arrayfun(@(x) x.a, s2(:))';
truth.s2_1_2 = s2(1,2).a; truth.s2_2_1 = s2(2,1).a;

% 1x3 struct vector
clear s1; for j=1:3, s1(1,j).a = 300+j; end
truth.s1_linear_a = arrayfun(@(x) x.a, s1(:))';

% 2x3 rank-2 double already covered by Kp

save(fullfile(outdir,'fix2.mat'), 'ov','oc','s2','s1');

for fmt = {'uncompressed-text','compressed-binary'}
    f = fmt{1};
    fn = fullfile(outdir, ['fix2_' strrep(f,'-','_') '.sldd']);
    if exist(fn,'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = f;
    ds = dd.getSection('Design Data');
    ds.addEntry('s2', s2);
    ds.addEntry('s1', s1);
    dd.saveChanges(); dd.close();
end

fid = fopen(fullfile(outdir,'truth2.json'),'w'); fprintf(fid,'%s',jsonencode(truth)); fclose(fid);
disp('GEN2 OK');
