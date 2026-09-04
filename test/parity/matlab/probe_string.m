% What does MATLAB actually put in a .mat file for a string?
%
% A MATLAB `string` is an MCOS object, and McosParser.buildObjectValue gives up on
% one by design (`return NOT_AVAILABLE`). Two separate things are wrong downstream
% and only one of them needs the payload cracked:
%
%   * SHAPE and TYPE. cases.mat's strArray is 1x3 and strMat is 2x3, and our reader
%     reports [1,1] for both with a blank Data Type. `string` is a genuine MATLAB
%     data type, not just a class name, so both are wrong whatever happens to the
%     text.
%   * the TEXT itself, recoverable only if the payload layout can be READ OFF a file
%     rather than guessed. A decoder built on a guess produces plausible mojibake,
%     which is worse than an honest sentinel.
%
% So this probe's deliverable is a written layout, including whatever it fails to
% determine. It writes the fixture the decoder is developed against, MATLAB's own
% answers for every case in it, and a byte dump of the whole file so the MCOS
% subsystem can be read directly.
%
% Run: mw -using Bmain matlab -nodesktop \
%          -batch "run('$PWD/test/parity/matlab/probe_string.m')"

outdir = getenv('STRING_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'strprobe'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end

% Every shape and every edge the decoder has to distinguish. The two-element
% sMissing is deliberate: a `missing` next to a real string is the only way to see
% whether the payload marks it in place or omits it.
sScalar  = "hello";
sRow     = ["alpha", "beta", "gamma"];
s2x3     = ["a" "b" "c"; "d" "e" "f"];
sCol     = ["one"; "two"];
sNd      = reshape(["a" "b" "c" "d" "e" "f" "g" "h"], [2 2 2]);
sEmptyE  = "";                        % a 1x1 string holding zero characters
sEmptyA  = strings(0, 0);             % a 0x0 string array, holding nothing at all
sMissing = [string(missing), "x"];
sUnicode = ["caf" + char(233), "na" + char(239) + "ve", char([26085 26412])];
sLong    = string(repmat('x', 1, 300));
% A character OUTSIDE the BMP, stored as a UTF-16 surrogate pair. strlength counts it
% as one character while the pair is two code units, so this is the one case that says
% which of the two the payload's count word means.
sAstral  = ["a" + char([55357 56832]) + "b"];

VARS = {'sScalar', 'sRow', 's2x3', 'sCol', 'sNd', 'sEmptyE', 'sEmptyA', ...
        'sMissing', 'sUnicode', 'sLong', 'sAstral'};

% Which heap cell holds a string's payload? In a file whose ONLY objects are strings
% the objects are numbered 1..N and their payloads are cells 2..N+1, so `cell =
% objId + 1` and `the strings come first` predict exactly the same thing and the dump
% cannot tell them apart. These four put a Simulink object AHEAD of the string, and a
% string inside a struct field, a cell element and an object property, so the two
% rules disagree — whichever survives is the one to implement against.
mixParam = Simulink.Parameter(42);
mixStr   = "after";
save(fullfile(outdir, 'mix_order.mat'), 'mixParam', 'mixStr');

mixStruct = struct('p', {Simulink.Parameter(7)}, 's', {"inStruct"});
mixCell   = {Simulink.Parameter(8), "inCell", 9};
save(fullfile(outdir, 'mix_nested.mat'), 'mixStruct', 'mixCell');

% A property of a Simulink object holding a string, so the string is reached only
% through another object's property block rather than from a named variable.
mixProp = Simulink.Parameter(1);
mixProp.Description = "described";
save(fullfile(outdir, 'mix_prop.mat'), 'mixProp');
fprintf('  mixProp.Description is %s after assignment\n', class(mixProp.Description));

% Two variables holding the same text: one object each, or one shared?
dupA = "same";
dupB = "same";
save(fullfile(outdir, 'mix_dup.mat'), 'dupA', 'dupB');

save(fullfile(outdir, 'strings.mat'), VARS{:});
% -v7 is the older container; if it stores a string differently, the reader needs to
% know before it trusts one layout.
save(fullfile(outdir, 'strings_v7.mat'), '-v7', 'sScalar', 'sRow', 's2x3');
% -v7.3 is HDF5, an entirely different file format. Written only so the note can say
% whether the corpus could ever contain one.
save(fullfile(outdir, 'strings_v73.mat'), '-v7.3', 'sRow');

% ---- MATLAB's own answers, the truth the decoder is checked against -------------
truth = struct();
for i = 1:numel(VARS)
    name = VARS{i};
    v = eval(name);
    t = struct();
    t.class = class(v);
    t.size = size(v);
    t.numel = numel(v);
    % Column-major, which is MATLAB's own linear order and the order the payload is
    % expected to use.
    lin = v(:)';
    % Flat and column-major, so a consumer never has to un-nest jsonencode's
    % row-major view of a 2-D logical. Both are needed to read the payload's
    % per-element count words: a `missing` and a zero-length string are two
    % different things there, and `codes` spells both as [].
    t.ismissing = ismissing(lin);
    t.lengths = strlength(lin);
    t.linear = cellstr(lin);
    % The CODE UNITS of each element, so a decoder can be checked without any
    % assumption about how JSON survives a round trip through the shell.
    codes = cell(1, numel(lin));
    for k = 1:numel(lin)
        if ismissing(lin(k))
            codes{k} = [];
        else
            codes{k} = double(char(lin(k)));
        end
    end
    t.codes = codes;
    t.disp = formattedDisplayText(v, 'SuppressMarkup', true);
    truth.(name) = t;

    fprintf('  %-9s class=%-7s size=%-10s numel=%-3d nmissing=%d\n', ...
        name, class(v), mat2str(size(v)), numel(v), sum(ismissing(v(:))));
end

fid = fopen(fullfile(outdir, 'strings_truth.json'), 'w');
fprintf(fid, '%s', jsonencode(truth));
fclose(fid);

% ---- the bytes, so the subsystem is read rather than guessed -------------------
% One variable per file as well as the combined one: a single-variable file is small
% enough to read end to end, and it isolates which bytes belong to which value.
for i = 1:numel(VARS)
    name = VARS{i};
    save(fullfile(outdir, ['one_' name '.mat']), name);
end

f = fopen(fullfile(outdir, 'strings.mat'), 'r');
b = fread(f, Inf, 'uint8=>uint8');
fclose(f);
fprintf('\nstrings.mat: %d bytes\n', numel(b));

disp('STRINGPROBE OK');
