% Copyright 2026 The MathWorks, Inc.
%
% What does MATLAB do to an enum's DefaultValue when the enumeral it names is
% REMOVED? Our UI lets the user delete any enumeral (EnumTypeNode.canRemoveChild
% is unconditional) and never touches DefaultValue afterwards, so we can produce
% an enum whose default names an enumeral that is no longer there. This probe
% asks MATLAB what it does in the same situation, for BOTH dictionary flavours:
%
%   Design Data        Simulink.data.dictionary.EnumTypeDefinition
%   Architectural Data Simulink.dictionary.archdata.EnumType
%
% The two APIs are NOT parallel, which round 1 of this probe established:
%   design data: appendEnumeral(obj, name, value, desc), removeEnumeral(obj, INDEX)
%   arch data:   addEnumeral(obj, name),                 removeEnumeral(obj, NAME)
% Both carry a char DefaultValue, and both validate it on assignment
% ("Default value does not match any of the enumeration names").
%
% Every step is wrapped, because the interesting outcomes include "MATLAB
% refuses" -- an error here is data, not a failure. Run under -batch and read
% the tagged lines.
function probe_enum_removal()
    fprintf('PROBE_BEGIN\n');
    fprintf('VERSION %s\n', version);
    root = tempname; mkdir(root);
    fprintf('TMPROOT %s\n', root);

    run_step(@() dd_live(),         '1. DESIGN DATA -- remove the default enumeral, live object');
    run_step(@() dd_discriminate(), '2. DESIGN DATA -- is the default CLEARED or RE-POINTED');
    run_step(@() dd_persist(root),  '3. DESIGN DATA -- does it reach the file and reload');
    run_step(@() ad_live(),         '4. ARCH DATA -- remove the default enumeral, live object');
    run_step(@() ad_discriminate(), '5. ARCH DATA -- is the default CLEARED or RE-POINTED');
    run_step(@() ad_persist(root),  '6. ARCH DATA -- does it reach the file and reload');
    fprintf('\nPROBE_END\n');
end

% A step that throws is reported and the probe continues: "MATLAB refuses" is one
% of the answers being looked for, so it must not end the run.
function run_step(fn, title)
    fprintf('\n===== %s =====\n', title);
    try
        fn();
    catch e
        fprintf('STEP_ERROR %s | %s\n', e.identifier, e.message);
    end
end

% Print a value however it is shaped, short enough for one line.
function s = brief(v)
    try
        if ischar(v)
            s = ['''' v ''''];
        elseif isstring(v) && isscalar(v)
            s = ['"' char(v) '"'];
        elseif isempty(v)
            s = sprintf('<empty %s %s>', class(v), mat2str(size(v)));
        elseif isnumeric(v) || islogical(v)
            s = mat2str(v);
        else
            s = sprintf('<%s %s>', class(v), mat2str(size(v)));
        end
    catch
        s = '<unprintable>';
    end
end

% The enumeral names an enum currently carries, in order. Works for a struct
% array (design data) and an object array (arch data).
function s = enumeral_names(en)
    try
        parts = cell(1, numel(en));
        for k = 1:numel(en)
            parts{k} = char(en(k).Name);
        end
        s = ['[' strjoin(parts, ' ') ']'];
    catch e
        s = sprintf('<names unreadable: %s>', e.message);
    end
end

function i = idx_of(en, name)
    i = 0;
    for k = 1:numel(en)
        if strcmp(char(en(k).Name), name)
            i = k; return
        end
    end
end

% A design-data enum carrying exactly `names`. A fresh EnumTypeDefinition already
% has one enumeral ('enum1', value 0, DefaultValue ''), so the placeholder is
% appended past and then dropped -- otherwise every experiment below would be
% reasoning about a list whose first entry it did not choose.
function ed = dd_new(names)
    ed = Simulink.data.dictionary.EnumTypeDefinition;
    for k = 1:numel(names)
        appendEnumeral(ed, names{k}, int32(k - 1), '');
    end
    removeEnumeral(ed, idx_of(ed.Enumerals, 'enum1'));
end

% ---------------------------------------------------------------- 1
% Three enumerals, DefaultValue on the MIDDLE one, then remove that one. The
% middle is deliberate: removing the first would be indistinguishable from the
% implicit "defaults to the first enumeral" rule taking over.
function dd_live()
    ed = dd_new({'item1', 'item2', 'item3'});
    fprintf('DD.built %s default=%s\n', enumeral_names(ed.Enumerals), brief(ed.DefaultValue));
    ed.DefaultValue = 'item2';
    fprintf('DD.set_default %s\n', brief(ed.DefaultValue));

    % THE QUESTION. Refuse, silently clear, re-point, or leave a dangling name?
    try
        removeEnumeral(ed, idx_of(ed.Enumerals, 'item2'));
        fprintf('DD.remove_default ALLOWED\n');
    catch e
        fprintf('DD.remove_default REFUSED %s | %s\n', e.identifier, e.message);
    end
    fprintf('DD.after %s default=%s\n', enumeral_names(ed.Enumerals), brief(ed.DefaultValue));

    % Assignment-time validation, for contrast: if a bogus name is rejected here,
    % then whatever removal did above is a deliberate choice and not an absence
    % of checking.
    try
        ed.DefaultValue = 'nosuch';
        fprintf('DD.set_bogus ACCEPTED -> %s\n', brief(ed.DefaultValue));
    catch e
        fprintf('DD.set_bogus REJECTED %s | %s\n', e.identifier, e.message);
    end

    % Removing a NON-default enumeral must leave the default alone.
    ed2 = dd_new({'item1', 'item2', 'item3'});
    ed2.DefaultValue = 'item2';
    removeEnumeral(ed2, idx_of(ed2.Enumerals, 'item3'));
    fprintf('DD.remove_other %s default=%s\n', enumeral_names(ed2.Enumerals), brief(ed2.DefaultValue));

    % And emptying the enum out entirely -- our canRemoveChild allows it.
    ed3 = dd_new({'only'});
    try
        removeEnumeral(ed3, 1);
        fprintf('DD.empty_out ALLOWED n=%d default=%s\n', numel(ed3.Enumerals), brief(ed3.DefaultValue));
    catch e
        fprintf('DD.empty_out REFUSED %s | %s\n', e.identifier, e.message);
    end
end

% ---------------------------------------------------------------- 2
% If removing the default makes the default read as the FIRST enumeral, two very
% different mechanisms fit: the stored char was CLEARED and the getter falls back
% to the first (what our displayValue does), or it was actively RE-POINTED to the
% first (a real write). They differ the moment the first enumeral is removed too,
% so that is the discriminator.
function dd_discriminate()
    ed = dd_new({'a', 'b', 'c'});
    ed.DefaultValue = 'b';
    removeEnumeral(ed, idx_of(ed.Enumerals, 'b'));
    fprintf('DD.disc.step1 %s default=%s\n', enumeral_names(ed.Enumerals), brief(ed.DefaultValue));
    % Now drop the first. Cleared+fallback => default follows to 'c'.
    % Re-pointed to 'a'  => default is now dangling at 'a', or MATLAB refuses.
    try
        removeEnumeral(ed, idx_of(ed.Enumerals, 'a'));
        fprintf('DD.disc.step2 %s default=%s\n', enumeral_names(ed.Enumerals), brief(ed.DefaultValue));
    catch e
        fprintf('DD.disc.step2 REFUSED %s | %s\n', e.identifier, e.message);
    end

    % Removing the LAST one while it is the default: does the default land on the
    % first enumeral, or on the removed one's neighbour?
    ed2 = dd_new({'a', 'b', 'c'});
    ed2.DefaultValue = 'c';
    removeEnumeral(ed2, idx_of(ed2.Enumerals, 'c'));
    fprintf('DD.disc.last %s default=%s\n', enumeral_names(ed2.Enumerals), brief(ed2.DefaultValue));

    % Is an explicitly-set default distinguishable from an unset one at all? If
    % setting the first enumeral as the default stores 'a' rather than '', then
    % the empty string is a real state and "cleared" is observable.
    ed3 = dd_new({'a', 'b'});
    fprintf('DD.disc.unset %s\n', brief(ed3.DefaultValue));
    ed3.DefaultValue = 'a';
    fprintf('DD.disc.set_first %s\n', brief(ed3.DefaultValue));
    ed3.DefaultValue = '';
    fprintf('DD.disc.cleared %s\n', brief(ed3.DefaultValue));
end

% ---------------------------------------------------------------- 3
% Does the outcome reach a FILE, and what does MATLAB read back? This is the half
% that matters to us: our serializer writes DefaultValue and the enumeral list
% independently, so a live-object rule that tidies the default is a rule our
% writer does not have.
function dd_persist(root)
    f = fullfile(root, 'dd_enum.sldd');
    dd = Simulink.data.dictionary.create(f);
    sec = getSection(dd, 'Design Data');
    ed = dd_new({'item1', 'item2', 'item3'});
    ed.DefaultValue = 'item2';
    addEntry(sec, 'MyEnum', ed);
    saveChanges(dd);
    close(dd);
    fprintf('DD.persist.baseline_saved\n');

    % What the file itself says, before any removal -- so the key name and
    % spelling are on record for our writer to match.
    txt = fileread(f);
    tok = regexp(txt, '"DefaultValue"\s*:\s*"[^"]*"', 'match', 'once');
    fprintf('DD.persist.file_key %s\n', tok);

    % Now remove the default enumeral through the ENTRY, the way a user would.
    dd = Simulink.data.dictionary.open(f);
    en = getEntry(getSection(dd, 'Design Data'), 'MyEnum');
    v = getValue(en);
    removeEnumeral(v, idx_of(v.Enumerals, 'item2'));
    fprintf('DD.persist.in_memory %s default=%s\n', enumeral_names(v.Enumerals), brief(v.DefaultValue));
    try
        setValue(en, v);
        saveChanges(dd);
        fprintf('DD.persist.saved_after_remove OK\n');
    catch e
        fprintf('DD.persist.saved_after_remove ERROR %s | %s\n', e.identifier, e.message);
    end
    close(dd);

    txt2 = fileread(f);
    tok2 = regexp(txt2, '"DefaultValue"\s*:\s*"[^"]*"', 'match', 'once');
    if isempty(tok2)
        fprintf('DD.persist.file_key_after <absent>\n');
    else
        fprintf('DD.persist.file_key_after %s\n', tok2);
    end

    try
        dd = Simulink.data.dictionary.open(f);
        v2 = getValue(getEntry(getSection(dd, 'Design Data'), 'MyEnum'));
        fprintf('DD.persist.reloaded %s default=%s\n', enumeral_names(v2.Enumerals), brief(v2.DefaultValue));
        close(dd);
    catch e
        fprintf('DD.persist.reload ERROR %s | %s\n', e.identifier, e.message);
    end
end

% An arch-data enum carrying exactly `names`. Same placeholder problem as the
% design-data builder: addEnumType seeds one enumeral called 'enum1'.
% addEnumeral wants a VALUE as well as a name -- `addEnumeral(et, name)` raises
% MATLAB:minrhs. Round 1 of this probe hid that behind a try/catch fallback and
% reported nothing, which is why the 4-argument form is spelled out here.
function et = ad_new(ad, typeName, names)
    et = addEnumType(ad, typeName);
    for k = 1:numel(names)
        addEnumeral(et, names{k}, int32(k - 1), '');
    end
    removeEnumeral(et, 'enum1');
end

% ---------------------------------------------------------------- 4
% The same question in Architectural Data, where the enum is a HANDLE object and
% its enumerals are objects rather than a struct array -- so removal could
% plausibly behave differently from the design-data copy semantics.
function ad_live()
    ad = Simulink.dictionary.archdata.create([tempname '.sldd']);
    et = ad_new(ad, 'MyEnum', {'item1', 'item2', 'item3'});
    fprintf('AD.built %s default=%s\n', enumeral_names(et.Enumerals), brief(et.DefaultValue));
    et.DefaultValue = 'item2';
    fprintf('AD.set_default %s\n', brief(et.DefaultValue));

    try
        removeEnumeral(et, 'item2');
        fprintf('AD.remove_default ALLOWED\n');
    catch e
        fprintf('AD.remove_default REFUSED %s | %s\n', e.identifier, e.message);
    end
    fprintf('AD.after %s default=%s\n', enumeral_names(et.Enumerals), brief(et.DefaultValue));
    try
        fprintf('AD.after.getEnumeralNames %s\n', strjoin(reshape(cellstr(getEnumeralNames(et)), 1, []), ' '));
    catch e
        fprintf('AD.after.getEnumeralNames ERROR %s\n', e.message);
    end

    try
        et.DefaultValue = 'nosuch';
        fprintf('AD.set_bogus ACCEPTED -> %s\n', brief(et.DefaultValue));
    catch e
        fprintf('AD.set_bogus REJECTED %s | %s\n', e.identifier, e.message);
    end

    et2 = ad_new(ad, 'OtherEnum', {'item1', 'item2', 'item3'});
    et2.DefaultValue = 'item2';
    removeEnumeral(et2, 'item3');
    fprintf('AD.remove_other %s default=%s\n', enumeral_names(et2.Enumerals), brief(et2.DefaultValue));

    et3 = ad_new(ad, 'SoleEnum', {'only'});
    try
        removeEnumeral(et3, 'only');
        fprintf('AD.empty_out ALLOWED n=%d default=%s\n', numel(et3.Enumerals), brief(et3.DefaultValue));
    catch e
        fprintf('AD.empty_out REFUSED %s | %s\n', e.identifier, e.message);
    end
    try, discardChanges(ad); catch, end
end

% ---------------------------------------------------------------- 5
function ad_discriminate()
    ad = Simulink.dictionary.archdata.create([tempname '.sldd']);
    et = ad_new(ad, 'Disc', {'a', 'b', 'c'});
    et.DefaultValue = 'b';
    removeEnumeral(et, 'b');
    fprintf('AD.disc.step1 %s default=%s\n', enumeral_names(et.Enumerals), brief(et.DefaultValue));
    try
        removeEnumeral(et, 'a');
        fprintf('AD.disc.step2 %s default=%s\n', enumeral_names(et.Enumerals), brief(et.DefaultValue));
    catch e
        fprintf('AD.disc.step2 REFUSED %s | %s\n', e.identifier, e.message);
    end

    et2 = ad_new(ad, 'DiscLast', {'a', 'b', 'c'});
    et2.DefaultValue = 'c';
    removeEnumeral(et2, 'c');
    fprintf('AD.disc.last %s default=%s\n', enumeral_names(et2.Enumerals), brief(et2.DefaultValue));

    et3 = ad_new(ad, 'DiscClear', {'a', 'b'});
    fprintf('AD.disc.unset %s\n', brief(et3.DefaultValue));
    et3.DefaultValue = 'b';
    fprintf('AD.disc.set_second %s\n', brief(et3.DefaultValue));
    try
        et3.DefaultValue = '';
        fprintf('AD.disc.cleared %s\n', brief(et3.DefaultValue));
    catch e
        fprintf('AD.disc.clear REJECTED %s | %s\n', e.identifier, e.message);
    end
    try, discardChanges(ad); catch, end
end

% ---------------------------------------------------------------- 6
function ad_persist(root)
    f = fullfile(root, 'ad_enum.sldd');
    ad = Simulink.dictionary.archdata.create(f);
    et = ad_new(ad, 'MyEnum', {'item1', 'item2', 'item3'});
    et.DefaultValue = 'item2';
    save(ad);
    fprintf('AD.persist.baseline_saved\n');
    txt = fileread(f);
    tok = regexp(txt, '"DefaultValue"\s*:\s*"[^"]*"', 'match', 'once');
    if isempty(tok)
        fprintf('AD.persist.file_key <no JSON match; binary or different spelling>\n');
    else
        fprintf('AD.persist.file_key %s\n', tok);
    end

    removeEnumeral(et, 'item2');
    fprintf('AD.persist.in_memory %s default=%s\n', enumeral_names(et.Enumerals), brief(et.DefaultValue));
    try
        save(ad);
        fprintf('AD.persist.saved_after_remove OK\n');
    catch e
        fprintf('AD.persist.saved_after_remove ERROR %s | %s\n', e.identifier, e.message);
    end
    try, close(ad); catch, end

    txt2 = fileread(f);
    tok2 = regexp(txt2, '"DefaultValue"\s*:\s*"[^"]*"', 'match', 'once');
    if isempty(tok2)
        fprintf('AD.persist.file_key_after <absent>\n');
    else
        fprintf('AD.persist.file_key_after %s\n', tok2);
    end

    try
        ad2 = Simulink.dictionary.archdata.open(f);
        et2 = getDataType(ad2, 'MyEnum');
        fprintf('AD.persist.reloaded %s default=%s\n', enumeral_names(et2.Enumerals), brief(et2.DefaultValue));
        close(ad2);
    catch e
        fprintf('AD.persist.reload ERROR %s | %s\n', e.identifier, e.message);
    end
end
