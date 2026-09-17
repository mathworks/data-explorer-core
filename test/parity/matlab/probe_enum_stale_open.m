% Copyright 2026 The MathWorks, Inc.
%
% Open a .sldd whose enum DefaultValue names an enumeral the file does not
% contain, and report what MATLAB makes of it. Our writer can produce exactly
% that file (delete the default enumeral in the UI and save); MATLAB's own save
% never does, because it drops the key -- so the only way to learn whether such a
% file is loadable at all is to hand MATLAB one and watch.
%
% Usage: probe_enum_stale_open('/path/a.sldd', '/path/b.sldd', ...)
function probe_enum_stale_open(varargin)
    fprintf('STALE_BEGIN\n');
    for k = 1:numel(varargin)
        f = varargin{k};
        fprintf('\n--- %s\n', f);
        try
            dd = Simulink.data.dictionary.open(f);
        catch e
            fprintf('OPEN_ERROR %s | %s\n', e.identifier, e.message);
            continue
        end
        fprintf('OPEN_OK\n');
        try
            en = getEntry(getSection(dd, 'Design Data'), 'MyEnum');
        catch e
            fprintf('ENTRY_ERROR %s | %s\n', e.identifier, e.message);
            safeClose(dd); continue
        end
        % getValue is where the stored DefaultValue would be pushed through the
        % property's own validation, so this is the line most likely to throw.
        try
            v = getValue(en);
        catch e
            fprintf('GETVALUE_ERROR %s | %s\n', e.identifier, e.message);
            safeClose(dd); continue
        end
        names = cell(1, numel(v.Enumerals));
        for i = 1:numel(v.Enumerals)
            names{i} = char(v.Enumerals(i).Name);
        end
        fprintf('ENUMERALS [%s]\n', strjoin(names, ' '));
        fprintf('DEFAULTVALUE ''%s''\n', v.DefaultValue);
        fprintf('DANGLING %d\n', ~isempty(v.DefaultValue) && ~any(strcmp(names, v.DefaultValue)));

        % A resave: does MATLAB tidy the key the way it tidies its own?
        try
            setValue(en, v);
            saveChanges(dd);
            fprintf('RESAVE_OK\n');
        catch e
            fprintf('RESAVE_ERROR %s | %s\n', e.identifier, e.message);
        end
        safeClose(dd);
        try
            txt = fileread(f);
            tok = regexp(txt, '"DefaultValue"\s*:\s*"[^"]*"', 'match', 'once');
            if isempty(tok)
                fprintf('FILE_KEY_AFTER_RESAVE <absent or binary>\n');
            else
                fprintf('FILE_KEY_AFTER_RESAVE %s\n', tok);
            end
        catch e
            fprintf('FILE_READ_ERROR %s\n', e.message);
        end
    end
    fprintf('\nSTALE_END\n');
end

function safeClose(dd)
    try
        discardChanges(dd);
    catch
    end
    try
        close(dd);
    catch
    end
end
