% What does a classic `.mdl` saved under a non-UTF-8 character set look like, and
% what does MATLAB read back out of it?
%
% A classic `.mdl` records its own encoding as `SavedCharacterEncoding` in the Model
% block, and both classic files in the corpus say "UTF-8" -- so the corpus could not
% show a reader honouring the parameter, and `test/mdlEncoding.test.ts` SYNTHESIZED its
% fixtures instead: the real mdlcases_R2011b.mdl text, retitled and re-encoded. That is
% the licensed fallback for "MATLAB cannot be asked", not the answer. This probe was the
% ask. IT HAS BEEN RUN -- its three files are in `test/parity/artifacts/mdl/` and the
% synthesized bytes are gone. Rerun it to regenerate them.
%
% Three things it settled that a synthesized fixture only assumed, all three now
% asserted in that suite:
%
%   * WHICH SPELLING MATLAB WRITES. The test assumed `Shift_JIS` and `windows-1252`
%     -- the WHATWG encoding labels, which is what a TextDecoder takes. MATLAB was
%     equally free to write `SJIS`, `ibm-943_P15A-2003` or a platform name with no IANA
%     registration at all, and only the last of those would send the reader down its
%     UTF-8 fallback. MEASURED: it writes exactly the WHATWG spellings, and exactly the
%     byte pairs the hand-written table claimed (`93 fa 96 7b 8c ea 95 5c`,
%     `47 72 f6 df 65`). The invented bytes were right; they are no longer invented.
%   * WHETHER THE WHOLE FILE IS IN IT. The synthesized fixture re-encoded every byte. A
%     real save might have kept part of the file in ASCII, or escaped non-ASCII
%     characters rather than encoding them. MEASURED: the whole file, no escaping.
%   * WHETHER THE EXPORT SURVIVES IT AT ALL. `'ExportToVersion', 'R2011b'` already
%     gives up on a model workspace it cannot represent (see gen_mdl.m); it might have
%     had something to say about a block name it cannot represent either. MEASURED: it
%     does, and it is a REFUSAL rather than a mangling -- see the `names` map below --
%     but a name the session encoding can represent exports fine, workspace and all.
%
% One thing it settled that nobody had asked: a modern `.mdl` saved by R2027a records
% NO `SavedCharacterEncoding` in its compatibility stub. The suite's "the stub must not
% reach the parts" case is therefore hand-built by necessity, and says so.
%
% The block name is built from CODE POINTS, not typed into this file, on purpose:
% this script changes the session character encoding, and a .m file containing
% non-ASCII characters is subject to exactly the mangling being probed. Keeping the
% script pure ASCII means it cannot be part of the problem.
%
% `slCharacterEncoding` requires that no models be loaded when it is called, and it
% is a global session setting -- so this restores whatever it found on the way out,
% including if it errors. It can also refuse an encoding the platform does not have,
% which is itself a finding worth printing rather than a reason to stop.
%
% Run: mw -using Bmain matlab -nodesktop -batch "run('$PWD/test/parity/matlab/probe_mdl_encoding.m')"

outdir = getenv('MDL_ENCODING_OUT');
if isempty(outdir), outdir = fullfile(tempdir, 'mdlenc'); end
if ~exist(outdir, 'dir'), mkdir(outdir); end

% One name PER ENCODING, and not one name for both: MATLAB refuses to write a `.mdl`
% holding a character the session encoding cannot represent --
%
%   Unable to save model 'mdlenc_windows_1252' in the MDL file format because it
%   contains characters that are not valid in the current character encoding,
%   'windows-1252'.
%
% -- so a Japanese name yields no windows-1252 file at all. Measured, not assumed: the
% first run of this probe used one name for both and harvested only half of what it
% came for.
%
%   Shift_JIS   日本語表 -- the last character is the one that matters. `表` is
%               0x95 0x5C, and 0x5C read as ASCII is a BACKSLASH, which the classic
%               grammar treats as an escape: a name ending in it escapes its own
%               closing quote and the value runs on into the properties that follow. A
%               fixture without it proves only that names are legible; with it, the
%               file is unreadable to a UTF-8 reader rather than merely garbled.
%   win-1252    Größe -- ö and ß, the two characters a Western European locale
%               actually puts in a block name. Neither is a backslash trap; what this
%               one settles is legibility and the label MATLAB spells.
names = containers.Map( ...
    {'Shift_JIS', 'windows-1252'}, ...
    {char([26085 26412 35486 34920]), char([71 114 246 223 101])});

encodings = {'Shift_JIS', 'windows-1252'};

orig = slCharacterEncoding();
fprintf('SESSION ENCODING WAS %s (feature: %s)\n', orig, feature('DefaultCharacterSet'));

for e = 1:numel(encodings)
    enc = encodings{e};
    fprintf('\n==== %s ====\n', enc);
    try
        bdclose('all');
        slCharacterEncoding(enc);
    catch err
        fprintf('  REFUSED %s\n', err.message);
        continue
    end

    name = names(enc);
    mdl = ['mdlenc_' lower(strrep(enc, '-', '_'))];
    if bdIsLoaded(mdl), close_system(mdl, 0); end
    new_system(mdl);
    % One block, one parameter, one non-ASCII name -- the smallest file that can carry
    % the question. The parameter value stays ASCII: what is being probed is the
    % encoding of the file, not the identifier gate that decides which rows surface.
    add_block('simulink/Sources/Constant', [mdl '/' name], 'Value', 'Kp');
    set_param(mdl, 'Description', ['description in ' enc ': ' name]);

    % A model workspace, so the classic export carries a UUENCODED mxarray stream. That
    % stream travels through the file as a quoted TEXT value, which is the one part of
    % the file whose survival a re-decode could silently break -- and a corrupted stream
    % does not mojibake, it stops parsing. PLAIN VALUES ONLY: a Simulink data object
    % makes an R2011b export give up on the workspace and repoint it at a .m file (the
    % lesson gen_mdl.m records), which would leave nothing to decode.
    ws = get_param(mdl, 'ModelWorkspace');
    assignin(ws, 'Kp', 3.5);
    assignin(ws, 'grid', [1 2 3; 4 5 6]);
    assignin(ws, 'label', 'plain ascii');

    modern = fullfile(outdir, [mdl '.mdl']);
    save_system(mdl, modern, 'OverwriteIfChangedOnDisk', true);
    classic = fullfile(outdir, [mdl '_R2011b.mdl']);
    try
        save_system(mdl, classic, 'ExportToVersion', 'R2011b', 'OverwriteIfChangedOnDisk', true);
    catch err
        fprintf('  EXPORT REFUSED %s\n', err.message);
        classic = '';
    end
    close_system(mdl, 0);

    % ---- what MATLAB actually wrote -------------------------------------------
    % Read as raw BYTES (`fread` uint8, not `fileread`, which would decode them under
    % the session encoding and hide the answer). Print the recorded parameter line and
    % the block name's bytes in hex: those bytes ARE the ground truth the test needs.
    %
    % `isempty(dir(fn))` and NOT `exist(fn,'file') ~= 2`: exist() answers 4, not 2, for
    % a Simulink model file, so that test skips every file this probe just wrote and the
    % probe prints nothing at all. Measured while debugging probe_configsetref.m.
    for f = {modern, classic}
        fn = f{1};
        if isempty(fn) || isempty(dir(fn)), continue, end
        fid = fopen(fn, 'r'); raw = fread(fid, Inf, 'uint8=>uint8')'; fclose(fid);
        fprintf('  FILE %s (%d bytes)\n', fn, numel(raw));
        % latin1 so every byte maps to one character and nothing is lost to a
        % replacement character before the line can be found.
        text = native2unicode(raw, 'ISO-8859-1');
        for line = strsplit(text, newline)
            if ~isempty(strfind(line{1}, 'SavedCharacterEncoding')) %#ok<STREMP>
                fprintf('    RECORDS %s\n', strtrim(line{1}));
            end
        end
        hits = strfind(text, 'Name');
        for h = hits
            seg = text(h:min(numel(text), h + 40));
            stop = strfind(seg, newline);
            if ~isempty(stop), seg = seg(1:stop(1) - 1); end
            if any(double(seg) > 127)
                fprintf('    NAME BYTES %s\n', sprintf('%02x ', double(seg)));
                fprintf('    NAME LATIN1 %s\n', seg);
            end
        end
    end

    % ---- what MATLAB reads back ----------------------------------------------
    % The round trip, which is the only authority on whether the file is right: reopen
    % each flavour and compare the block name to the code points it was created from.
    for f = {modern, classic}
        fn = f{1};
        if isempty(fn) || isempty(dir(fn)), continue, end
        try
            open_system(fn);
            [~, opened] = fileparts(fn);
            blks = find_system(opened, 'Type', 'block');
            % The block's TYPE and parameter are printed too, because a harvested
            % fixture needs an expectation and this is where it has to come from: the
            % row a reader should produce is MATLAB's answer about this file, not a
            % line someone wrote in a test.
            for b = 1:numel(blks)
                got = get_param(blks{b}, 'Name');
                val = '';
                try, val = get_param(blks{b}, 'Value'); catch, end
                fprintf('    READ BACK %-24s codepoints=%s match=%d type=%s value=%s\n', fn, ...
                        mat2str(double(got)), isequal(got, name), ...
                        get_param(blks{b}, 'BlockType'), val);
            end
            fprintf('    READ BACK %-24s description=%s\n', fn, ...
                    mat2str(double(get_param(opened, 'Description'))));
            % `w = rws.whos` then index, which is the form gen_slx.m proves. Iterating
            % `for v = rws.whos` directly threw "Too many input arguments" here.
            rws = get_param(opened, 'ModelWorkspace');
            w = rws.whos;
            for k = 1:numel(w)
                fprintf('    READ BACK %-24s ws %s = %s\n', fn, w(k).name, ...
                        mat2str(getVariable(rws, w(k).name)));
            end
            close_system(opened, 0);
        catch err
            fprintf('    UNREADABLE %s -- %s\n', fn, err.message);
        end
    end
end

bdclose('all');
slCharacterEncoding(orig);
fprintf('\nSESSION ENCODING RESTORED TO %s\n', slCharacterEncoding());

% ---- harvesting ------------------------------------------------------------------
% DONE. All three files -- `mdlenc_shift_jis_R2011b.mdl`, `mdlenc_windows_1252_R2011b.mdl`
% and the modern `mdlenc_shift_jis.mdl` -- are in `test/parity/artifacts/mdl/`, and
% `test/mdlEncoding.test.ts` reads them. The synthesizer, the hand-written Shift_JIS
% byte table and the retitling helper are gone with them; what survived is the
% windows-1252 ENCODER, used only by the two cases MATLAB cannot be asked for (a label
% beyond the sniff window, and a label no decoder knows).
%
% Both eras are worth keeping even though the block name reads identically out of both:
% the classic one is the file that needs the parameter, and the modern one is the
% control -- the same model, the same name, in a package whose parts must NOT be
% re-decoded. To regenerate, rerun this probe and copy all three over.
%
% The assertions did have to change, in the one way the old header did not foresee: a
% Shift_JIS name read as UTF-8 does not lose its parameter row. The 0x5C escape runs the
% NAME past its own closing quote and it absorbs the ` SID` that follows -- measured as
% `<FFFD><FFFD><FFFD>{<FFFD><FFFD>" SID` -- while the row itself survives. The old
% comment claimed the block "loses its parameter row altogether", which was true of the
% multi-block synthesized fixture and is not true of this one-block model.
disp('MDLENCODING OK');
