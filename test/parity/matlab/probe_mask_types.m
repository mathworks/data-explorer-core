function probe_mask_types()
% PROBE_MASK_TYPES  Which mask parameter TYPES hold an expression MATLAB resolves?
%
% One masked subsystem, one parameter of every type Simulink.Mask accepts, each valued
% with the NAME of a model workspace variable. Whatever findVars credits is an
% expression; whatever it ignores is a selection, a label or a widget state.

name = 'maskTypeProbe';
close_system(name, 0);
new_system(name);
hws = get_param(name, 'ModelWorkspace');

types = {'edit', 'checkbox', 'popup', 'combobox', 'listbox', 'radiobutton', ...
         'slider', 'dial', 'spinbox', 'unit', 'min', 'max', 'promote', ...
         'datatypestr', 'hyperlink', 'text', 'image', 'table', 'matrix', ...
         'custom', 'filebrowse', 'folderbrowse', 'tree', 'colorpicker', 'datepicker'};

add_block('built-in/SubSystem', [name '/S'], 'Position', [50 50 160 150]);
add_block('built-in/Gain', [name '/S/G'], 'Gain', '1', 'Position', [50 20 80 50]);
m = Simulink.Mask.create([name '/S']);

added = {};
for k = 1:numel(types)
    t = types{k};
    pname = ['p_' t];
    vname = ['v_' t];
    hws.assignin(vname, k);
    try
        switch t
            case {'popup', 'combobox', 'listbox', 'radiobutton'}
                m.addParameter('Name', pname, 'Type', t, ...
                    'TypeOptions', {vname, 'other'}, 'Value', vname);
            otherwise
                m.addParameter('Name', pname, 'Type', t, 'Value', vname);
        end
        added{end+1} = t;  %#ok<AGROW>
        fprintf('ADDED   %-14s value=%s\n', t, vname);
    catch e
        fprintf('SKIPPED %-14s %s\n', t, e.message);
    end
end

fprintf('\n=== MaskNames / MaskValues as stored ===\n');
nms = get_param([name '/S'], 'MaskNames');
vls = get_param([name '/S'], 'MaskValues');
for k = 1:numel(nms)
    fprintf('    %-22s = %s\n', nms{k}, vls{k});
end

fprintf('\n=== findVars: which values MATLAB resolved ===\n');
credited = containers.Map('KeyType', 'char', 'ValueType', 'logical');
vars = Simulink.findVars(name);
for k = 1:numel(vars)
    fprintf('%-16s %-18s %s\n', vars(k).Name, char(string(vars(k).SourceType)), ...
        char(string(vars(k).Source)));
    credited(vars(k).Name) = true;
end

fprintf('\n=== verdict per type ===\n');
for k = 1:numel(added)
    t = added{k};
    hit = isKey(credited, ['v_' t]);
    fprintf('%-14s %s\n', t, char(string(hit)));
end

close_system(name, 0);
end
