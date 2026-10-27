function make_param_string(out)
% Copyright 2026 The MathWorks, Inc.
%
% Simulink.Parameter objects whose Value MATLAB saved as a string object, at the places a Value is
% edited: a variable, one with an empty string, a struct field and a cell member, beside a string
% variable and a Parameter holding a number. And MATLAB's own save of the file with one of them
% given another text, which a save of the same edit is compared with, byte for byte.
% test/paramStringValue.test.ts edits each Value. Run from this folder, in each release; each writes
% its own subfolder: make_param_string(pwd)
pStr = Simulink.Parameter; pStr.Value = "abc"; pStr.Description = 'text';
pEmpty = Simulink.Parameter; pEmpty.Value = "";
sHolds.p = Simulink.Parameter; sHolds.p.Value = "in a struct"; sHolds.n = 1;
q = Simulink.Parameter; q.Value = "in a cell";
cHolds = {q, 2};
s = "top";
pNum = Simulink.Parameter(5);
folder = fullfile(out, ['r' version('-release')]);
if ~isfolder(folder), mkdir(folder); end
file = fullfile(folder, 'param_string.mat');
save(file, 'pStr', 'pEmpty', 'sHolds', 'cHolds', 's', 'pNum', '-v7');
S = load(file);
S.pStr.Value = "a longer text, with ünïcødé";
save(fullfile(folder, 'param_string_longer.mat'), '-struct', 'S', '-v7');
end
