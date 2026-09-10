function probe_evaluate()
% PROBE_EVALUATE  Is `Evaluate` a second gate, independent of the parameter TYPE?
%
% An `edit` mask parameter with Evaluate OFF holds the literal string the user typed,
% not an expression. Does findVars know that, and how does each container format spell
% it? This decides whether both readers have to gate on Evaluate as well as on Type —
% probe_mask_types.m answers only the Type half.
%
% MEASURED, R2025a. Two edits, same type, same kind of value, one with Evaluate off:
%
%     === findVars ===
%     v_on     model workspace    evalProbe
%
% `v_off` is not there at all, so the gates are independent: a type on the expression
% allowlist is not enough. Each format marks it in its own place —
%
%     .slx    <MaskParameter Name="p_off" Type="edit" Evaluate="off">
%     .mdl    MaskVariables "p_on=@1;p_off=&2;"      @ evaluated, & literal
%
% — and the classic file says nothing about it in MaskStyleString, which reads
% "edit,edit" for both. See src/datamodel/parser/SlxParser.js (isExpressionMaskType and
% the Evaluate check beside it) and MdlParser's classicMask.
out = fullfile(tempdir, 'probe_evaluate');
if exist(out, 'dir'); rmdir(out, 's'); end
mkdir(out);

name = 'evalProbe';
close_system(name, 0);
new_system(name);
hws = get_param(name, 'ModelWorkspace');
hws.assignin('v_on', 1);
hws.assignin('v_off', 2);

add_block('built-in/SubSystem', [name '/S'], 'Position', [50 50 160 150]);
add_block('built-in/Gain', [name '/S/G'], 'Gain', '1', 'Position', [50 20 80 50]);
m = Simulink.Mask.create([name '/S']);
m.addParameter('Name', 'p_on',  'Type', 'edit', 'Value', 'v_on',  'Evaluate', 'on');
m.addParameter('Name', 'p_off', 'Type', 'edit', 'Value', 'v_off', 'Evaluate', 'off');

fprintf('release: %s\n', version('-release'));
fprintf('\n=== findVars ===\n');
vars = Simulink.findVars(name);
for k = 1:numel(vars)
    fprintf('%-8s %-18s %s\n', vars(k).Name, char(string(vars(k).SourceType)), ...
        char(string(vars(k).Source)));
end

slx = fullfile(out, 'evalProbe.slx');
save_system(name, slx);
mdl = fullfile(out, 'evalProbe_R2011b.mdl');
try
    save_system(name, mdl, 'ExportToVersion', 'R2011b');
    fprintf('\nexported %s\n', mdl);
catch e
    fprintf('\nEXPORT FAILED: %s\n', e.message);
end
close_system(name, 0);

fprintf('\n=== the .slx MaskParameter XML ===\n');
unz = fullfile(out, 'unz');
mkdir(unz);
unzip(slx, unz);
txt = fileread(fullfile(unz, 'simulink', 'systems', 'system_root.xml'));
fprintf('%s\n', txt);

if exist(mdl, 'file')
    fprintf('\n=== the .mdl Mask* props ===\n');
    lines = strsplit(fileread(mdl), newline);
    for k = 1:numel(lines)
        if contains(lines{k}, 'Mask')
            fprintf('%s\n', strtrim(lines{k}));
        end
    end
end
end
