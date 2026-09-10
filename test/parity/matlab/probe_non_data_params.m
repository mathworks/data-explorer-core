function probe_non_data_params()
% PROBE_NON_DATA_PARAMS  Which free-text block parameters never name workspace data?
%
% The companion measurement to gen_block_params.m, and the part that generator refuses to
% guess at. An option-list parameter is marked as one in the dialog, so it can be scanned
% for; these are ordinary STRING parameters — a Bus Selector's `OutputSignals`, a Model
% block's `ModelNameDialog` — whose values look exactly like variable names and are not.
% Nothing in the dialog says so and nothing in the file says so, so the only way to know
% is to ask `Simulink.findVars` on a model built to make the question sharp.
%
% THE TRAP THIS PROTECTS AGAINST is not a spare row. Each model below holds a variable
% whose name COLLIDES with the value of the parameter under test. If the parser credits
% the parameter, that block lands on the Usage cell of a variable it does not read: a
% false edge, and one a user cannot tell from a true one. Every model therefore also
% carries a Gain reading a real variable (`kGain`) as the control — a run that credits
% neither name has failed to compile, not proved anything.
%
% Run:  matlab -nodesktop -batch "addpath('<repo>/test/parity/matlab'); probe_non_data_params"
%
% Prints one PAIR line per measured (BlockType, parameter). Those lines are the source of
% NON_DATA_BLOCK_PARAMS in src/datamodel/parser/SlxParser.ts; the verdicts as measured on
% R2027a are recorded beside that table. Nothing here is committed as a fixture — the
% table is three entries long and reads better as prose next to the code it gates.

fprintf('=== Bus Selector: OutputSignals ===\n');
busSelector();
fprintf('\n=== Bus Assignment: AssignedSignals ===\n');
busAssignment();
fprintf('\n=== Model block: ModelNameDialog ===\n');
modelBlock();
end

% ---------------------------------------------------------------------------------------

function busSelector()
% Constant -> Bus Creator -> Bus Selector -> Gain -> Terminator, wired so the model
% actually compiles: findVars gives no answer at all about a model it cannot compile, and
% an uncompilable model would have produced the same empty result as a true negative.
mdl = 'dexBusSelectorProbe';
ws = freshModel(mdl);
assignin(ws, 'a', 1);      % collides with the name of a signal on the bus
assignin(ws, 'kGain', 2);  % control: an unambiguously real reference

add_block('simulink/Sources/Constant', [mdl '/C1'], 'Value', '1');
add_block('simulink/Sources/Constant', [mdl '/C2'], 'Value', '2');
add_block('simulink/Signal Routing/Bus Creator', [mdl '/BC'], 'Inputs', '2');
add_block('simulink/Signal Routing/Bus Selector', [mdl '/BS']);
add_block('simulink/Math Operations/Gain', [mdl '/G'], 'Gain', 'kGain');
add_block('simulink/Sinks/Terminator', [mdl '/T']);

add_line(mdl, 'C1/1', 'BC/1');
add_line(mdl, 'C2/1', 'BC/2');
add_line(mdl, 'BC/1', 'BS/1');
% A Bus Selector selects BY SIGNAL NAME, so the signals have to be named for the value
% under test to mean anything.
nameOutport([mdl '/C1'], 'a');
nameOutport([mdl '/C2'], 'b');
set_param([mdl '/BS'], 'OutputSignals', 'a');
add_line(mdl, 'BS/1', 'G/1');
add_line(mdl, 'G/1', 'T/1');

report(mdl, 'BusSelector', 'OutputSignals', 'a', 'kGain');

% And the other direction, the one that would refute the entry outright: point the
% parameter at a name that IS a variable and nothing else — no signal on the bus is
% spelled `a_var` — and ask whether MATLAB reads it as one. Whether the model still
% analyses is beside the point; the only question is credit.
assignin(ws, 'a_var', 1);
set_param([mdl '/BS'], 'OutputSignals', 'a_var');
fprintf('  with OutputSignals = a_var, a variable and NOT a signal on the bus: ');
try
    if ismember('a_var', {Simulink.findVars(mdl).Name})
        fprintf('credited — RECHECK, the parameter IS an expression\n');
    else
        fprintf('not credited\n');
    end
catch e
    fprintf('refused (%s)\n', firstLine(e.message));
end
close_system(mdl, 0);
end

function busAssignment()
% Same shape, same collision, on the block that writes INTO a bus rather than out of it.
% Measured separately because the two parameters are spelled differently and a table keyed
% on the pair cannot generalise from one to the other.
mdl = 'dexBusAssignmentProbe';
ws = freshModel(mdl);
assignin(ws, 'a', 1);
assignin(ws, 'kGain', 2);

add_block('simulink/Sources/Constant', [mdl '/C1'], 'Value', '1');
add_block('simulink/Sources/Constant', [mdl '/C2'], 'Value', '2');
add_block('simulink/Sources/Constant', [mdl '/C3'], 'Value', '3');
add_block('simulink/Signal Routing/Bus Creator', [mdl '/BC'], 'Inputs', '2');
add_block('simulink/Signal Routing/Bus Assignment', [mdl '/BA']);
add_block('simulink/Math Operations/Gain', [mdl '/G'], 'Gain', 'kGain');
add_block('simulink/Sinks/Terminator', [mdl '/T']);

add_line(mdl, 'C1/1', 'BC/1');
add_line(mdl, 'C2/1', 'BC/2');
nameOutport([mdl '/C1'], 'a');
nameOutport([mdl '/C2'], 'b');
add_line(mdl, 'BC/1', 'BA/1');
set_param([mdl '/BA'], 'AssignedSignals', 'a');
add_line(mdl, 'C3/1', 'BA/2');
add_line(mdl, 'BA/1', 'G/1');
add_line(mdl, 'G/1', 'T/1');

report(mdl, 'BusAssignment', 'AssignedSignals', 'a', 'kGain');
close_system(mdl, 0);
end

function modelBlock()
% A parent whose Model block names a child model, and whose workspace holds a variable
% spelled exactly like that child. `child` passes any identifier test, so a dictionary
% entry of that name would have collected a link from the Model block's file name.
child = 'dexRefChildProbe';
parent = 'dexRefParentProbe';

freshModel(child);
add_block('simulink/Sources/In1', [child '/In1']);
add_block('simulink/Sinks/Out1', [child '/Out1']);
add_line(child, 'In1/1', 'Out1/1');
% A referenced model must exist on disk for the parent to compile.
childFile = fullfile(tempdir, [child '.slx']);
save_system(child, childFile, 'OverwriteIfChangedOnDisk', true);
close_system(child, 0);
addpath(tempdir);

ws = freshModel(parent);
assignin(ws, child, 1);      % collides with the referenced model's file name
assignin(ws, 'kGain', 2);    % control

add_block('simulink/Sources/Constant', [parent '/C'], 'Value', '1');
add_block('simulink/Ports & Subsystems/Model', [parent '/M'], 'ModelNameDialog', child);
add_block('simulink/Math Operations/Gain', [parent '/G'], 'Gain', 'kGain');
add_block('simulink/Sinks/Terminator', [parent '/T']);
add_line(parent, 'C/1', 'M/1');
add_line(parent, 'M/1', 'G/1');
add_line(parent, 'G/1', 'T/1');

report(parent, 'ModelReference', 'ModelNameDialog', child, 'kGain');
fprintf('  (ModelFile and ModelName are the same file name under older spellings:');
for p = {'ModelFile', 'ModelName'}
    try
        fprintf(' %s=%s', p{1}, get_param([parent '/M'], p{1}));
    catch
        fprintf(' %s=<absent>', p{1});
    end
end
fprintf(')\n');
close_system(parent, 0);
delete(childFile);
end

% ---------------------------------------------------------------------------------------

function ws = freshModel(mdl)
if bdIsLoaded(mdl), close_system(mdl, 0); end
new_system(mdl);
load_system(mdl);
ws = get_param(mdl, 'ModelWorkspace');
end

function nameOutport(blk, signalName)
set_param(get_param(blk, 'PortHandles').Outport(1), 'Name', signalName);
end

function report(mdl, blockType, param, collidingName, controlName)
% The verdict, and enough of the raw findVars answer to see WHY it is the verdict.
vars = Simulink.findVars(mdl);
names = {vars.Name};
fprintf('  findVars on %s:\n', mdl);
for k = 1:numel(vars)
    fprintf('    VAR %-22s srcType=%-16s users=%s\n', vars(k).Name, ...
        char(string(vars(k).SourceType)), strjoin(cellstr(vars(k).Users), ', '));
end
credited = ismember(collidingName, names);
control = ismember(controlName, names);
if ~control
    fprintf('  INVALID: the control variable %s was not credited either — the model did not compile.\n', ...
        controlName);
    return;
end
fprintf('  PAIR %s|%s  value=%s  credited=%d  (control %s credited=1)\n', ...
    blockType, param, collidingName, credited, controlName);
if credited
    fprintf('  RECHECK: MATLAB DOES credit this parameter. It must not be blocklisted.\n');
end
end

function s = firstLine(msg)
s = regexprep(msg, '\s+', ' ');
if numel(s) > 110, s = [s(1:110) '...']; end
end
