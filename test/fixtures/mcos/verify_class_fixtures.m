function verify_class_fixtures()
  % Copyright 2026 The MathWorks, Inc.
  % Reopens the six fixtures make_class_fixtures.m wrote and asserts the values came back
  % — so a fixture that MATLAB *wrote* but cannot *read* is caught here rather than
  % becoming a test that pins a MATLAB accident. Run:
  %
  %   mw -using Bmain matlab -batch "cd('<repo>/test/fixtures/mcos'); verify_class_fixtures"
  %
  % Every twin is checked SEPARATELY and against the same expectations, which is the whole
  % point of a twin: a value that only survives one of the two formats is a finding.
  %
  % The checks are deliberately uneven. Most properties get one equality; the ones that
  % have a plausible way to go quietly wrong get a stricter check:
  %   Padded   compared with strcmp against a value WITH its spaces, because a trimming
  %            bug produces a string that still looks right in a printout.
  %   Cr/Tab/Lf/Ctrl compared by DOUBLE(char), because these characters are invisible and
  %            an equality on the text would read as passing either way.
  %   Matrix   compared whole, so a column-major/row-major transpose fails rather than
  %            comparing equal element-by-element in the wrong order.
  here = fileparts(mfilename('fullpath'));
  fixtures = fileparts(here);
  addpath(here);
  Simulink.data.dictionary.closeAll('-discard');

  state.pass = 0;
  state.fail = 0;
  for fmt = {'binary', 'text'}
    state = verify_derived(state, fullfile(fixtures, ['derived_class_' fmt{1} '.sldd']));
    state = verify_custom(state, fullfile(fixtures, ['custom_object_' fmt{1} '.sldd']), fmt{1});
    state = verify_types(state, fullfile(fixtures, ['bus_types_' fmt{1} '.sldd']));
  end
  fprintf('\nTOTAL pass=%d fail=%d\n', state.pass, state.fail);
  if state.fail > 0
    fprintf('VERIFY_CLASS_FIXTURES_FAILED\n');
  else
    fprintf('VERIFY_CLASS_FIXTURES_OK\n');
  end
end

function state = verify_derived(state, path)
  fprintf('\n=== %s ===\n', path);
  [vals, state] = load_entries(state, path, {'dpGain', 'dpPlain', 'dsFlow'});
  if isempty(vals), return, end
  p = vals.dpGain;
  state = chk(state, 'dpGain class', class(p), 'dexdata.DerivedParam');
  state = chk(state, 'dpGain Value', p.Value, int32(7));
  state = chk(state, 'dpGain DataType', p.DataType, 'int32');
  state = chk(state, 'dpGain Min/Max', [p.Min p.Max], [-10 100]);
  state = chk(state, 'dpGain Unit', p.Unit, 'm/s');
  state = chk(state, 'dpGain CalibLevel', p.CalibLevel, 42);
  state = chk(state, 'dpGain CalibTag', p.CalibTag, 'high');
  state = chk(state, 'dpGain IsLocked', p.IsLocked, true);
  state = chk(state, 'dpGain Limits', [p.Limits.lo p.Limits.hi], [-1 9]);
  state = chk(state, 'dpGain Aliases', p.Aliases, {'alpha', 'beta', 'gamma'});
  state = chk(state, 'dpGain Mode', p.Mode, GearMode.Reverse);

  pd = vals.dpPlain;
  state = chk(state, 'dpPlain class', class(pd), 'dexdata.DerivedParam');
  state = chk(state, 'dpPlain CalibLevel (default)', pd.CalibLevel, 3);
  state = chk(state, 'dpPlain Mode (default)', pd.Mode, GearMode.Drive);

  s = vals.dsFlow;
  state = chk(state, 'dsFlow class', class(s), 'dexdata.DerivedSignal');
  state = chk(state, 'dsFlow DataType', s.DataType, 'single');
  state = chk(state, 'dsFlow Routing', s.Routing, 'external');
  state = chk(state, 'dsFlow Priority', s.Priority, int32(9));
  state = chk(state, 'dsFlow Priority stays int32', class(s.Priority), 'int32');
end

function state = verify_custom(state, path, fmt)
  fprintf('\n=== %s ===\n', path);
  [vals, state] = load_entries(state, path, {'widget', 'partCell', 'gearValue', 'gearRow'});
  if isempty(vals), return, end
  w = vals.widget;
  state = chk(state, 'widget class', class(w), 'Widget');
  state = chk(state, 'widget Scalar', w.Scalar, 1.5);
  state = chk(state, 'widget Matrix', w.Matrix, [1 2 3; 4 5 6]);
  state = chk(state, 'widget Cplx', w.Cplx, 3 + 4i);
  state = chk(state, 'widget Padded KEEPS SPACES', w.Padded, '  pad me  ');
  state = chk(state, 'widget Str', w.Str, "a string");
  state = chk(state, 'widget Flag', w.Flag, true);
  state = chk(state, 'widget Nothing is 0x0', size(w.Nothing), [0 0]);
  state = chk(state, 'widget EmptyStruct is 1x1 no fields', ...
    [numel(w.EmptyStruct) numel(fieldnames(w.EmptyStruct))], [1 0]);
  state = chk(state, 'widget ZeroStruct is 0x0', size(w.ZeroStruct), [0 0]);
  state = chk(state, 'widget Nested.inner.leaf', w.Nested.inner.leaf, 7);
  state = chk(state, 'widget Cells', w.Cells, {1, 'two', true});
  state = chk(state, 'widget Hostile all five', w.Hostile, 'amp & lt < gt > quot " apos '' end');
  % By code point: these four are invisible, so an equality on the text would pass on a
  % value that silently lost a character — which is exactly what one format does.
  %
  % THE ONE PLACE THE TWINS DISAGREE ON A VALUE, and the reason these checks are
  % format-aware rather than shared. Measured R2027a, after moving the values out of
  % Widget.m's defaults so that both files actually carry them:
  %
  %   char code 13 (CR) SURVIVES a compressed-binary round-trip and is LOST by JSON text.
  %
  %     Ctrl = char([9 10 13 7 1])   binary -> [9 10 13 7 1]   text -> [9 10 7 1]
  %     Cr   = ['a' char(13) 'b']    binary -> [97 13 98]      text -> [97 98]
  %
  % It is not a JSON escaping problem: custom_object_text.sldd contains zero raw CR bytes
  % AND zero \r escapes, while tab, LF, BEL(7) and SOH(1) all come through the same string
  % as \t, \n, \u0007 and \u0001. The CR never reaches the file at all. The binary
  % format writes it as the reference &#xD; and reads it back intact.
  %
  % So a reader may NOT assume a text dictionary and its binary twin hold equal char data,
  % and must not "fix" a CR-less text value by inferring one. Asserting the measured
  % behaviour per format, rather than skipping these two, is deliberate: if a later release
  % makes text preserve CR, this fails and someone re-reads this comment.
  if strcmp(fmt, 'text')
    state = chk(state, 'widget Ctrl codes (text LOSES CR 13)', double(w.Ctrl), [9 10 7 1]);
    state = chk(state, 'widget Cr codes (text LOSES CR 13)', double(w.Cr), [97 98]);
  else
    state = chk(state, 'widget Ctrl codes', double(w.Ctrl), [9 10 13 7 1]);
    state = chk(state, 'widget Cr codes (&#xD; survives)', double(w.Cr), [97 13 98]);
  end
  state = chk(state, 'widget Tab codes', double(w.Tab), [97 9 98]);
  state = chk(state, 'widget Lf codes', double(w.Lf), [97 10 98]);
  state = chk(state, 'widget Mode', w.Mode, GearMode.Reverse);
  state = chk(state, 'widget Part', [w.Part.PartId double(string(w.Part.Label) == "lead")], [1 1]);
  state = chk(state, 'widget Parts size', size(w.Parts), [1 3]);
  state = chk(state, 'widget Parts ids in order', [w.Parts.PartId], [10 20 30]);
  state = chk(state, 'widget Tuning class', class(w.Tuning), 'Simulink.Parameter');
  state = chk(state, 'widget Tuning Value', w.Tuning.Value, 2.5);

  g = vals.partCell;
  state = chk(state, 'partCell size', size(g), [2 2]);
  state = chk(state, 'partCell column-major ids', cellfun(@(c) c.PartId, g(:))', [101 102 103 104]);
  state = chk(state, 'partCell element class', class(g{1}), 'WidgetPart');

  state = chk(state, 'gearValue', vals.gearValue, GearMode.Reverse);
  state = chk(state, 'gearRow', vals.gearRow, [GearMode.Park GearMode.Drive GearMode.Reverse]);
  state = chk(state, 'gearRow underlying int32', int32(vals.gearRow), int32([0 1 -1]));
end

function state = verify_types(state, path)
  fprintf('\n=== %s ===\n', path);
  [vals, state] = load_entries(state, path, {'btAlias', 'btNumeric', 'btBus', 'btValueType', 'btEnumDef'});
  if isempty(vals), return, end
  state = chk(state, 'btAlias BaseType', vals.btAlias.BaseType, 'uint8');
  state = chk(state, 'btNumeric WordLength', vals.btNumeric.WordLength, 16);
  state = chk(state, 'btNumeric FractionLength', vals.btNumeric.FractionLength, 3);
  b = vals.btBus;
  state = chk(state, 'btBus element count', numel(b.Elements), 4);
  state = chk(state, 'btBus element names', {b.Elements.Name}, {'plain', 'aliased', 'geared', 'matrix'});
  state = chk(state, 'btBus aliased type', b.Elements(2).DataType, 'btAlias');
  state = chk(state, 'btBus enum type', b.Elements(3).DataType, 'Enum: GearMode');
  state = chk(state, 'btBus matrix dims', b.Elements(4).Dimensions, [2 3]);
  state = chk(state, 'btBus matrix complexity', b.Elements(4).Complexity, 'complex');
  if isfield(vals, 'btValueType')
    state = chk(state, 'btValueType DataType', vals.btValueType.DataType, 'btAlias');
    state = chk(state, 'btValueType Dimensions', vals.btValueType.Dimensions, [1 4]);
  end
  if isfield(vals, 'btEnumDef')
    e = vals.btEnumDef;
    state = chk(state, 'btEnumDef enumerals', {e.Enumerals.Name}, {'OFF', 'ON'});
    state = chk(state, 'btEnumDef DefaultValue', e.DefaultValue, 'OFF');
  end
end

% ---------------------------------------------------------------------------

function [vals, state] = load_entries(state, path, names)
  % Read every named entry out in one open/close, searching BOTH sections: which section
  % an entry landed in is make_class_fixtures's probe's business, not this file's, and
  % hard-coding it here would make a correct relocation look like a missing entry.
  vals = struct();
  if ~isfile(path)
    state = fail(state, sprintf('%s does not exist', path));
    vals = [];
    return
  end
  d = Simulink.data.dictionary.open(path);
  for k = 1:numel(names)
    found = false;
    for sec = {'Design Data', 'Other Data'}
      try
        vals.(names{k}) = getValue(getEntry(getSection(d, sec{1}), names{k}));
        found = true;
        break
      catch
        % next section
      end
    end
    if ~found
      state = fail(state, sprintf('entry %s missing from %s', names{k}, path));
    end
  end
  Simulink.data.dictionary.closeAll('-discard');
end

function state = chk(state, name, actual, expected)
  if isequal(actual, expected)
    state.pass = state.pass + 1;
    fprintf('PASS %s\n', name);
  else
    state = fail(state, sprintf('%s: got %s expected %s', name, brief(actual), brief(expected)));
  end
end

function state = fail(state, msg)
  state.fail = state.fail + 1;
  fprintf('FAIL %s\n', msg);
end

function s = brief(v)
  % mat2str throws on a cell/object/enum, and a verifier that errors while REPORTING a
  % failure hides the failure it was reporting.
  try
    s = mat2str(v);
  catch
    try
      s = formattedDisplayText(v);
      s = strtrim(regexprep(char(s), '\s+', ' '));
    catch
      s = sprintf('<%s %s>', class(v), mat2str(size(v)));
    end
  end
end
