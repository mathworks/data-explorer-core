function make_class_fixtures()
  % Copyright 2026 The MathWorks, Inc.
  % Authors the derived-class / custom-class dictionary fixtures, each as a TWIN PAIR:
  % one compressed-binary (zip whose data/chunk0.xml is the XML we read) and one JSON
  % text, from the SAME in-memory values. Run:
  %
  %   mw -using Bmain matlab -batch "cd('<repo>/test/fixtures/mcos'); make_class_fixtures"
  %
  % (A MULTI-LINE -batch argument silently runs nothing and exits 0, so the whole call has
  % to be one line. The `cd` is what puts this folder — and so the classdefs and the
  % +dexdata package — on the path before the function resolves. Verify by the WROTE
  % lines and the trailing MAKE_CLASS_FIXTURES_DONE, not by the exit code.)
  %
  % Writes six files into test/fixtures/:
  %   derived_class_{binary,text}.sldd   dexdata.DerivedParam / dexdata.DerivedSignal —
  %                                      subclasses of Simulink.Parameter and .Signal
  %   custom_object_{binary,text}.sldd   Widget — a plain MCOS value class covering every
  %                                      value shape, plus bare enum entries (scalar and
  %                                      1x3) and a 2x2 CELL of custom objects, which is
  %                                      as close to an object-array entry as a dictionary
  %                                      allows (see custom_items)
  %   bus_types_{binary,text}.sldd       the type-defining MathWorks classes as MATLAB
  %                                      actually writes them in BINARY (arch_binary.sldd
  %                                      is hand-authored and typeLink.sldd is text-only,
  %                                      so neither is evidence of MATLAB's output)
  %
  % WHY TWINS. The same dictionary written both ways is the control that separates FORMAT
  % from CONTENT: any difference the two readers produce is a reader bug, because the
  % values went in from one variable. Both members of a pair therefore come from one
  % `items` list, built once below — a second hand-written list is a second thing to get
  % wrong, which is exactly how rt_text/rt_bin were already done here.
  %
  % BUT A TWIN PAIR IS NOT TWO COPIES OF THE SAME PROPERTY SET, and that is the most
  % surprising thing these fixtures measured (R2027a):
  %
  %   compressed-binary  writes EVERY property of an object
  %   JSON text          writes only properties away from the CLASSDEF DEFAULT, and
  %                      reconstructs the rest from the class on load
  %
  % Measured on the entries below: dpGain (all fifteen touched) is 15 properties in both
  % formats, but dpPlain (nothing touched) is 15 in the binary and THREE in the text, and
  % btValueType is 9 against 3. So "same entries, same properties" is the wrong assertion
  % across a twin pair; "same entries, and every property PRESENT IN BOTH agrees" is the
  % right one. It also means a text dictionary is not self-contained for a custom class —
  % its defaults live in a .m file — which is why Widget's defaults are a sentinel and
  % custom_items() assigns all twenty properties explicitly.
  %
  % WHY THE SECTION IS PROBED, NOT DECLARED. Design Data accepts only values Simulink
  % recognises as design data and rejects the rest; which side of that line a
  % Simulink.Parameter SUBCLASS or a bare enum falls on is not documented anywhere we
  % trust, so resolve_sections() finds out once, against a throwaway dictionary, and both
  % twins then use the answer. Guessing would mean a silent twin divergence if the guess
  % were wrong for one format only.
  here = fileparts(mfilename('fullpath'));
  fixtures = fileparts(here);
  addpath(here);
  Simulink.data.dictionary.closeAll('-discard');

  derived = resolve_sections('derived', derived_items());
  custom  = resolve_sections('custom',  custom_items());
  types   = resolve_sections('types',   type_items());

  write_twins(fullfile(fixtures, 'derived_class'), derived);
  write_twins(fullfile(fixtures, 'custom_object'), custom);
  write_twins(fullfile(fixtures, 'bus_types'),    types);
  fprintf('MAKE_CLASS_FIXTURES_DONE\n');
end

% ---------------------------------------------------------------------------
% The three item lists. An item is {name, preferredSection, value}; the section
% is a PREFERENCE, narrowed by resolve_sections.
% ---------------------------------------------------------------------------

function items = derived_items()
  % A fully populated subclass instance: every INHERITED property set away from its
  % default too, so each one can be checked by value rather than taken on trust.
  % dexdata.* and not DerivedParam: MATLAB refuses to DEFINE a Simulink.DataObject
  % subclass outside a package ("must be defined inside of a package, but not in a
  % nested package"), so the dotted name is forced, not stylistic. See
  % +dexdata/DerivedParam.m.
  p = dexdata.DerivedParam;
  p.Value = int32(7);
  p.DataType = 'int32';
  p.Min = -10;
  p.Max = 100;
  p.Unit = 'm/s';
  p.Description = 'a derived parameter';
  p.CalibLevel = 42;
  p.CalibTag = 'high';
  p.IsLocked = true;
  p.Limits = struct('lo', -1, 'hi', 9);
  p.Aliases = {'alpha', 'beta', 'gamma'};
  p.Mode = GearMode.Reverse;

  % The same class at ITS DEFAULTS, as the control. The measured answer (R2027a) is that
  % MATLAB omits NOTHING: dpPlain writes all six extra properties and all of
  % Simulink.Parameter's, CoderInfo tree included, exactly as dpGain does. So a derived
  % class costs the same bytes whether it was touched or not, and no reader may infer
  % "unset" from "absent" here.
  pd = dexdata.DerivedParam;

  s = dexdata.DerivedSignal;
  s.DataType = 'single';
  s.Min = -5;
  s.Max = 5;
  s.Unit = 'V';
  s.Description = 'a derived signal';
  s.Routing = 'external';
  s.Priority = int32(9);

  items = { ...
    {'dpGain',  'Design Data', p}, ...
    {'dpPlain', 'Design Data', pd}, ...
    {'dsFlow',  'Design Data', s}, ...
  };
end

function items = custom_items()
  % EVERY Widget property is assigned, none left at its classdef default — see Widget.m
  % for the measurement, but the short version is that the JSON text format writes only
  % non-default properties, so a value left in the classdef lands in the binary twin and
  % NOT in the text one. Widget's defaults are therefore the sentinel 0 and this function
  % is the fixture's content. Adding a property to Widget means adding a line here.
  w = Widget;
  w.Scalar = 1.5;
  w.Matrix = [1 2 3; 4 5 6];
  w.Cplx = 3 + 4i;
  w.Padded = '  pad me  ';
  w.Str = "a string";
  w.Flag = true;
  w.Nothing = [];
  w.EmptyStruct = struct();
  w.ZeroStruct = struct([]);
  w.Nested = struct('inner', struct('leaf', 7));
  w.Cells = {1, 'two', true};
  w.Hostile = 'amp & lt < gt > quot " apos '' end';
  % The four control-character cases, one encoding each. char() and not an escape, because
  % MATLAB single quotes have no escapes and '\t' would be a literal backslash-t.
  w.Ctrl = char([9 10 13 7 1]);
  w.Cr = ['a' char(13) 'b'];
  w.Tab = ['a' char(9) 'b'];
  w.Lf = ['a' char(10) 'b'];
  w.Mode = GearMode.Reverse;

  part = WidgetPart;
  part.PartId = 1;
  part.Label = 'lead';
  w.Part = part;

  % 1x3 object ARRAY as a PROPERTY. Built by growing from .empty rather than by
  % repmat, so each element carries a distinct PartId/Label and a dropped or
  % reordered element is legible in the XML instead of being invisible.
  parts = WidgetPart.empty;
  for k = 1:3
    q = WidgetPart;
    q.PartId = k * 10;
    q.Label = sprintf('part%d', k);
    parts(k) = q;
  end
  w.Parts = parts;

  % A Simulink.Parameter nested inside a custom class: MathWorks-in-custom, the
  % nesting direction the corpus had no instance of.
  t = Simulink.Parameter;
  t.Value = 2.5;
  t.DataType = 'single';
  t.Description = 'nested MathWorks object';
  w.Tuning = t;

  % A 2x2 CELL of objects, which is as close as a dictionary gets to an object array at
  % entry level. An MCOS object ARRAY cannot be an entry value AT ALL — measured in
  % .scratch/probe_class_refusals.m, R2027a, both sections refuse every one:
  %
  %   WidgetPart 1x3 / 2x2   "Values of class 'WidgetPart' are not supported in the
  %                           'Other_Data' section of the dictionary."  (scalar: accepted)
  %   Widget 1x2             same, and the scalar is accepted
  %   Simulink.Parameter     "Arrays of class 'Simulink.Parameter' are not supported in
  %     1x3 / 2x2             the dictionary." — a DIFFERENT message, i.e. a deliberate
  %                           array check, not a class-support check
  %   Simulink.BusElement    refused in both sections, scalar included
  %
  % That is worth writing down twice over, because object_array_binary.sldd hand-authors
  % exactly this shape (3x1 Simulink.Parameter and 2x1 Simulink.VariableUsage as entry
  % VALUES) and MATLAB will not write it. The reader should keep coping with it, but the
  % fixture is synthetic and no round-trip can ever confirm it. Object arrays reach real
  % XML only as a PROPERTY — Widget.Parts above, a Bus's Elements_internal — which is
  % where this corpus now covers them.
  %
  % The cell, by contrast, is accepted in DESIGN DATA as well as Other Data, so custom
  % MCOS objects do reach the design-data section after all, just wrapped. 2x2 and not
  % 1x4 so the column-major order of the <Element> list is observable.
  grid = cell(2, 2);
  for k = 1:4
    q = WidgetPart;
    q.PartId = 100 + k;
    q.Label = sprintf('cell%d', k);
    grid{k} = q;
  end

  % gearRow: an enum ARRAY is accepted where an object array is not, so this is the one
  % non-scalar object-ish entry value a dictionary will hold. Mixed signs on purpose.
  items = { ...
    {'widget',    'Other Data',  w}, ...
    {'partCell',  'Design Data', grid}, ...
    {'gearValue', 'Design Data', GearMode.Reverse}, ...
    {'gearRow',   'Design Data', [GearMode.Park GearMode.Drive GearMode.Reverse]}, ...
  };
end

function items = type_items()
  a = Simulink.AliasType;
  a.BaseType = 'uint8';
  a.Description = 'alias of uint8';

  n = Simulink.NumericType;
  n.DataTypeMode = 'Fixed-point: binary point scaling';
  n.Signedness = 'Signed';
  n.WordLength = 16;
  n.FractionLength = 3;
  n.Description = 'fixdt(1,16,3)';

  % A bus whose four elements each differ in ONE property from the others, so the
  % element list is a table of cases rather than three copies: a plain double, one typed
  % by the alias entry above (the Data Type link's binary-format case), one typed by the
  % CUSTOM enum class, and one that is both 2x3 and complex.
  e1 = Simulink.BusElement; e1.Name = 'plain';   e1.DataType = 'double';
  e2 = Simulink.BusElement; e2.Name = 'aliased'; e2.DataType = 'btAlias';
  e3 = Simulink.BusElement; e3.Name = 'geared';  e3.DataType = 'Enum: GearMode';
  e4 = Simulink.BusElement; e4.Name = 'matrix';  e4.DataType = 'double';
  e4.Dimensions = [2 3];
  e4.Complexity = 'complex';
  b = Simulink.Bus;
  b.Elements = [e1 e2 e3 e4];
  b.Description = 'four elements, four cases';

  items = { ...
    {'btAlias',   'Design Data', a}, ...
    {'btNumeric', 'Design Data', n}, ...
    {'btBus',     'Design Data', b}, ...
  };

  % Simulink.ValueType and EnumTypeDefinition are both newer and both optional to the
  % point of this fixture; a release that lacks either must still produce the bus.
  try
    v = Simulink.ValueType;
    v.DataType = 'btAlias';
    v.Dimensions = [1 4];
    v.Description = 'a value type over an alias';
    items{end + 1} = {'btValueType', 'Design Data', v};
  catch err
    fprintf('SKIP btValueType: %s\n', err.message);
  end
  try
    % appendEnumeral, not addEnumeral: R2027a's EnumTypeDefinition has no addEnumeral at
    % all (`methods` lists appendEnumeral / removeEnumeral), so the obvious spelling fails
    % as an "Unrecognized method" rather than as a bad argument.
    ed = Simulink.data.dictionary.EnumTypeDefinition;
    ed.appendEnumeral('OFF', 0, 'off state');
    ed.appendEnumeral('ON', 1, 'on state');
    % A fresh EnumTypeDefinition is NOT empty — it ships one enumeral named `enum1`
    % with value 0, which the two appends land behind. Removed so the fixture holds the
    % two enumerals it says it does, and so OFF is not the second zero in the list.
    % By INDEX, not by name: removeEnumeral('enum1') fails with "Invalid argument at
    % position 1. Value must be a scalar."
    ed.removeEnumeral(1);
    ed.DefaultValue = 'OFF';
    ed.StorageType = 'int32';
    ed.Description = 'a dictionary-defined enum';
    items{end + 1} = {'btEnumDef', 'Design Data', ed};
  catch err
    fprintf('SKIP btEnumDef: %s\n', err.message);
  end
end

% ---------------------------------------------------------------------------
% Writing
% ---------------------------------------------------------------------------

function items = resolve_sections(tag, items)
  % Narrow each item's section to one Simulink will actually accept, and DROP any item
  % no section takes — reported loudly, because a silently missing entry is the failure
  % mode that makes a fixture lie. Runs against a throwaway dictionary in tempdir so the
  % real files are only ever written from a list already known to work.
  probe = [tempname '_' tag '.sldd'];
  cleanup = onCleanup(@() cleanup_file(probe));
  dd = Simulink.data.dictionary.create(probe);
  keep = {};
  for k = 1:numel(items)
    it = items{k};
    sections = unique({it{2}, 'Other Data'}, 'stable');
    placed = '';
    for s = sections
      try
        addEntry(getSection(dd, s{1}), it{1}, it{3});
        placed = s{1};
        break
      catch err
        fprintf('  %s/%s refused by %s: %s\n', tag, it{1}, s{1}, err.message);
      end
    end
    if isempty(placed)
      fprintf('SKIP %s/%s: no section accepted it\n', tag, it{1});
    else
      if ~strcmp(placed, it{2})
        fprintf('  %s/%s moved to %s\n', tag, it{1}, placed);
      end
      keep{end + 1} = {it{1}, placed, it{3}}; %#ok<AGROW>
    end
  end
  Simulink.data.dictionary.closeAll('-discard');
  items = keep;
end

function write_twins(stem, items)
  write_dict([stem '_binary.sldd'], items, 'compressed-binary');
  write_dict([stem '_text.sldd'], items, 'text');
end

function write_dict(path, items, fmt)
  cleanup_file(path);
  dd = Simulink.data.dictionary.create(path);
  for k = 1:numel(items)
    it = items{k};
    addEntry(getSection(dd, it{2}), it{1}, it{3});
  end
  % FileFormat must be set BEFORE saveChanges; without it the write is JSON text,
  % which is R2027a's default and is NOT what the XML reader is being measured on.
  if strcmp(fmt, 'compressed-binary')
    dd.FileFormat = 'compressed-binary';
  end
  saveChanges(dd);
  Simulink.data.dictionary.closeAll('-discard');
  fprintf('WROTE %s bytes=%d entries=%d\n', path, dir(path).bytes, numel(items));
end

function cleanup_file(path)
  % A dictionary left open holds a lock, and `create` on an existing path errors, so a
  % re-run has to clear both. closeAll first: deleting a file still open leaves the
  % in-memory dictionary pointing at nothing and the NEXT create fails instead.
  Simulink.data.dictionary.closeAll('-discard');
  if isfile(path)
    delete(path);
  end
end
