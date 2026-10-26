% A MAT-file whose variables hold one Simulink.Parameter handle several times (twins): p1, p2 and
% s.p are one object with a struct Value, q and q2 another with a numeric Value. Written by R2027a.
here = fileparts(mfilename('fullpath'));
p1 = Simulink.Parameter; p1.Value = struct('a', 1, 'b', 2, 'c', 3);
p2 = p1;
s.p = p1; s.k = 1;
q = Simulink.Parameter; q.Value = [1 2 3]; q2 = q;
save(fullfile(here, 'twins.mat'), 'p1', 'p2', 's', 'q', 'q2');
fprintf('WROTE %s\n', fullfile(here, 'twins.mat'));
