function make_complex_zero_imag(out)
% Copyright 2026 The MathWorks, Inc.
%
% Complex arrays every imaginary part of which is 0, as MATLAB holds them (isreal false), at the
% places an element of one is edited: a variable, an int8 one, a struct field, a cell member and a
% Simulink.Parameter's Value. test/complexElementUndo.test.ts edits an element of each, undoes it,
% and expects each complex again. Run from this folder: make_complex_zero_imag(pwd)
z0 = complex([1 2], [0 0]); %#ok<NASGU>
zi8 = complex(int8([1 2 3]), int8([0 0 0])); %#ok<NASGU>
sz.z0 = complex([1 2], [0 0]); %#ok<STRNU>
cz = {complex([1 2], [0 0])}; %#ok<NASGU>
pz = Simulink.Parameter(complex([1 2], [0 0])); %#ok<NASGU>
save(fullfile(out, 'complex_zero_imag.mat'), 'z0', 'zi8', 'sz', 'cz', 'pz', '-v7');
end
