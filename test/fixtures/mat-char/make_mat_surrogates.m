% The MAT-file surrogate fixtures: text holding a UTF-16 surrogate on its own, as MATLAB itself
% writes it, run once in each release (R2027a and R2023b), each writing into its own folder
% (r2027a/, r2023b/):
%   surrogates.mat  save -v7 -nocompression of the variables below, and a Simulink.Parameter
%                   whose Description holds one.
% MATLAB writes such text as miUTF16 and keeps the surrogate as the unit it is, high or low, at
% the start or the end, at the top, in a struct field, in a cell and in an object's property; it
% keeps a leading U+FEFF too, which is no byte-order mark in a char's data.
here = fullfile(fileparts(mfilename('fullpath')), ['r' version('-release')]);
if ~exist(here, 'dir'), mkdir(here); end
S = struct();
S.hi = char(55357);
S.lo = char(56832);
S.tail = ['a' char(55357)];
S.lead = [char(56832) 'b'];
S.rev = char([56832 55357]);
S.two = [char(55357) 'x'; 'y' char(56832)];
S.bom = char([65279 97]);
S.sur = struct('t', char([97 55357]), 'd', 1);
S.cc = {['a' char(56832) 'b'], 1};
S.p = Simulink.Parameter(1);
S.p.Description = ['a' char(55357)];
save(fullfile(here, 'surrogates.mat'), '-struct', 'S', '-v7', '-nocompression');
