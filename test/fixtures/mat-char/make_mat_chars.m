% The MAT-file char fixtures: what MATLAB itself writes for text of every width, run once in each
% release (R2027a and R2023b), each writing into its own folder (r2027a/, r2023b/):
%   chars.mat             save -v7 -nocompression of the variables below;
%   chars_compressed.mat  the same, save -v7;
%   objects.mat           two Simulink.Parameter objects whose Description is CJK and Latin-1 text.
% MATLAB writes a char's data as miUTF8 where every character is below U+0080, and as miUTF16
% otherwise, at the top, in a struct field, in a cell and in an object's property.
here = fullfile(fileparts(mfilename('fullpath')), ['r' version('-release')]);
if ~exist(here, 'dir'), mkdir(here); end
S = struct();
S.ascii = 'abc';
S.latin = char([176 67]);
S.hello = ['h' char(233) 'llo w' char(246) 'rld'];
S.l1max = char(255);
S.u100 = char(256);
S.cjk = char([26085 26412 35486]);
S.emoji = ['a' char([55357 56832]) 'b'];
S.ctrl = [char(0) 'a' char(9) char(127)];
S.two = [char([26085 26412]); [char(35486) 'x']];
S.e00 = '';
S.e10 = char(zeros(1, 0));
S.sf = struct('f', char([26085 26412 35486]));
S.cc = {char([26085 26412 35486]), 'x'};
S.nest = {struct('g', char([26085 26412 35486]))};
S.mix = ['ab' char(26085)];
save(fullfile(here, 'chars.mat'), '-struct', 'S', '-v7', '-nocompression');
save(fullfile(here, 'chars_compressed.mat'), '-struct', 'S', '-v7');
p = Simulink.Parameter(1); p.Description = char([26085 26412 35486]); %#ok<NASGU>
q = Simulink.Parameter(2); q.Description = ['h' char(233)]; %#ok<NASGU>
save(fullfile(here, 'objects.mat'), 'p', 'q', '-v7', '-nocompression');
