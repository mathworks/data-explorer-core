function make_variantbank_r2027a(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors variantbank_r2027a_text.sldd and variantbank_r2027a_binary.sldd: one dictionary, in
  % each format, holding MATLAB-written Simulink.VariantBank and Simulink.VariantBankCoderInfo
  % entries whose fields are NOT the defaults, so a test can read what MATLAB itself stores for
  % them (test/variantBankFields.test.ts). It then prints, for the record, every setter rule
  % those tests copy (SET lines) and what MATLAB makes of a text dictionary hand-edited to break
  % each rule (LOAD lines). Run (one line: mw splits -batch on newlines):
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_variantbank_r2027a"
  %
  % `outDir` defaults to this folder. The committed files were written by R2027a
  % (27.1.0.3409468) on 2026-10-18; a re-run gives new UUIDs and timestamps, and the same values.
  % The hand-edited copies go to tempdir and are deleted; the tests make the same edits to the
  % committed text file. What the SET and LOAD lines said is recorded in
  % src/datamodel/node/data/Simulink.VariantBank.md.
  %
  % THE ENTRIES (Design Data):
  %   vbN    Simulink.VariantBank: Name 'bankA', Description 'desc A', VariantConditions
  %          {'V==1','V==2'} (stored normalised, 'V == 1' and 'V == 2'), AllChoicesCoderInfo
  %          'ciA', ActiveChoiceCoderInfo 'ciB'
  %   vb1    Simulink.VariantBank: Name 'bankOne', a two-line Description holding a quote, one
  %          condition '(W>0)&&~X', and the hidden BankCoderInfo 'ciA'
  %   vbD    Simulink.VariantBank, default
  %   ciA    Simulink.VariantBankCoderInfo: HeaderFile 'h.h', DefinitionFile 'd.c',
  %          PreStatement 'pre', PostStatement 'post', Qualifier 'const' (stored 'Const')
  %   ciB    Simulink.VariantBankCoderInfo, default
  if nargin < 1 || isempty(outDir)
    outDir = fileparts(mfilename('fullpath'));
  end
  fprintf('VERSION %s\n', version);
  Simulink.data.dictionary.closeAll('-discard');
  formats = {'uncompressed-text', 'text'; 'compressed-binary', 'binary'};
  for i = 1:size(formats, 1)
    fn = fullfile(outDir, ['variantbank_r2027a_' formats{i, 2} '.sldd']);
    if exist(fn, 'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = formats{i, 1};
    ds = dd.getSection('Design Data');
    b = Simulink.VariantBank; b.Name = 'bankA'; b.Description = 'desc A';
    b.VariantConditions = {'V==1', 'V==2'}; b.AllChoicesCoderInfo = 'ciA'; b.ActiveChoiceCoderInfo = 'ciB';
    ds.addEntry('vbN', b);
    b1 = Simulink.VariantBank; b1.Name = 'bankOne'; b1.Description = sprintf('two\nlines, it''s');
    b1.VariantConditions = {'(W>0)&&~X'}; b1.BankCoderInfo = 'ciA';
    ds.addEntry('vb1', b1);
    ds.addEntry('vbD', Simulink.VariantBank);
    c = Simulink.VariantBankCoderInfo; c.HeaderFile = 'h.h'; c.DefinitionFile = 'd.c';
    c.PreStatement = 'pre'; c.PostStatement = 'post'; c.Qualifier = 'const';
    ds.addEntry('ciA', c);
    ds.addEntry('ciB', Simulink.VariantBankCoderInfo);
    clear ds
    dd.saveChanges();
    dd.close();
    fprintf('WROTE %s\n', fn);
    dd = Simulink.data.dictionary.open(fn); ds = dd.getSection('Design Data');
    showBank(['READBACK ' formats{i, 2} ' vbN'], ds.getEntry('vbN').getValue);
    showBank(['READBACK ' formats{i, 2} ' vb1'], ds.getEntry('vb1').getValue);
    clear ds
    dd.close();
  end
  Simulink.data.dictionary.closeAll('-discard');

  % THE SETTER RULES.
  V = @Simulink.VariantBank;
  tryset(V(), 'Name', 'bankA');
  tryset(V(), 'Name', '');
  tryset(V(), 'Name', '1bad');
  tryset(V(), 'Name', 'a b');
  tryset(V(), 'Name', 'rtX');
  tryset(V(), 'Name', 'rt');
  tryset(V(), 'Name', 'RtX');
  tryset(V(), 'Name', 'RTX');
  tryset(V(), 'Name', 'xrt');
  tryset(V(), 'Name', '_a');
  tryset(V(), 'Name', 'int');
  tryset(V(), 'Name', 'end');
  tryset(V(), 'Name', repmat('a', 1, 63));
  tryset(V(), 'Name', repmat('a', 1, 64));
  tryset(V(), 'Name', repmat('a', 1, 300));
  tryset(V(), 'Name', ' bankA');
  tryset(V(), 'Name', "bankS");
  tryset(V(), 'Name', 5);
  tryset(V(), 'Description', '');
  tryset(V(), 'Description', sprintf('a\nb'));
  tryset(V(), 'Description', "s");
  tryset(V(), 'Description', 5);
  tryset(V(), 'AllChoicesCoderInfo', 'ciA');
  tryset(V(), 'AllChoicesCoderInfo', '');
  tryset(V(), 'AllChoicesCoderInfo', '1bad');
  tryset(V(), 'AllChoicesCoderInfo', 'rtX');
  tryset(V(), 'AllChoicesCoderInfo', '_a');
  tryset(V(), 'AllChoicesCoderInfo', 'end');
  tryset(V(), 'AllChoicesCoderInfo', 'a.b');
  tryset(V(), 'AllChoicesCoderInfo', repmat('a', 1, 63));
  tryset(V(), 'AllChoicesCoderInfo', repmat('a', 1, 64));
  tryset(V(), 'AllChoicesCoderInfo', 5);
  tryset(V(), 'ActiveChoiceCoderInfo', 'ciB');
  tryset(V(), 'ActiveChoiceCoderInfo', '1bad');
  tryset(V(), 'ActiveChoiceCoderInfo', 'end');
  tryset(V(), 'ActiveChoiceCoderInfo', repmat('a', 1, 64));
  tryset(V(), 'BankCoderInfo', 'ciC');
  tryset(V(), 'VariantConditions', {});
  tryset(V(), 'VariantConditions', cell(0, 1));
  tryset(V(), 'VariantConditions', {'V==1', 'V==2'});
  tryset(V(), 'VariantConditions', {'V==1'; 'V==2'});
  tryset(V(), 'VariantConditions', {'V==1', 'V==2'; 'V==3', 'V==4'});
  tryset(V(), 'VariantConditions', 'V==1');
  tryset(V(), 'VariantConditions', ["V==1", "V==2"]);
  tryset(V(), 'VariantConditions', {"V==1"});
  tryset(V(), 'VariantConditions', {1, 2});
  tryset(V(), 'VariantConditions', {{'V==1'}});
  tryset(V(), 'VariantConditions', 5);
  conds = {'V==', '', ' ', 'V', '1', 'true', 'V==1', 'V == 1', '  V==1  ', 'V==1 ', 'V~=1', 'V!=1', ...
    'V>1', 'V<1', 'V>=1', 'V<=1', 'V==-1', 'V==+1', 'V==1.5', 'V==1e3', 'V==0x1F', 'V==E.A', ...
    'V==1&&W==2', 'V==1||W==2', 'V==1&W==2', 'V==1|W==2', '~V', '~(V==1)', '!V', '(V==1)', ...
    '((V==1))', '(W>0)&&~X', 'V==1&&(W==2||X==3)', 'V==1&&W==2||X==3', 'V==1||W==2&&X==3', ...
    'V=1', 'V==1;', 'V==''a''', 'V=="a"', 'V==int8(1)', 'V+1==2', 'V*2==2', '-V==1', 'V == W', ...
    'V==1 && W', 'V==true', 'V_1==1', 'rtV==1', 'end==1', 'v.w.x==1', 'V==E.A.B', 'V==1,W==2', ...
    'V==[1 2]', 'V==1 %c', sprintf('V==1\nW==2'), 'V ==1', 'V== 1', '~ V', '~~V', 'V==~W', ...
    'V>W>1', 'V==W==1', '(V)', 'V==(1)', 'V==1&&W==2&&X==3', 'V==1||W==2||X==3', 'V&&W', '(V&&W)&&X', ...
    'V&&(W&&X)', '(V||W)||X', 'V||(W||X)', '(V||W)&&X', 'V&&W||X', 'V||W&&X', '~V==1', '~(V)', '~(V&&W)', ...
    '~V&&~W', 'V==1&&~(W==2)', 'V<W==1', 'V==(W<1)', '(V==1)==W', 'V~=~W', '1==V', 'V==01', 'V==1.50', ...
    'V==.5', 'V==1.', 'V==2e-1', 'V==-0', 'V==- 1', 'V==--1', 'V==-(1)', 'V==0.1', 'V==1/3', ...
    'V==123456789', 'V==1234567890123', 'V==12345678901234567', 'V==3.14159265358979', 'V==1e-5', ...
    'V==1e400', 'V==-1.5', 'V==Inf', 'V==NaN', 'A.B==C.D', 'false', 'V==false', 'V==1 ...', ...
    sprintf('V==1\t&&\tW==2'), 'V&&1', '1&&V', '(1)', '~1', 'V==1&&', 'V==(', '(V==1', 'V==1)', ...
    'V===1', 'V=~1', 'V<>1', 'V=<1', 'V=>1', 'V==E.', 'V==.E', 'V==E..A', 'V==a_', 'V==A1', 'V==1A', ...
    'V==1&&W==2&&X==3&&Y==4', '((V==1)&&(W==2))||(X==3)', 'V==1&&(W==2&&X==3)', '(V==1||W==2)||X==3', ...
    'V==2147483647', 'V==2147483648', 'V==-2147483648', 'V==-2147483649', 'V==4294967295', '~(~V)', ...
    '~(V==1)&&W', 'V==1&&~W', '~V||W', '~(V||W)&&X', 'V==1;W==2', 'V==1 ', ' V'};
  % NOT in the list: 'V==1i'. Setting it crashed R2027a (27.1.0.3409468) outright, a segmentation
  % violation in SL::SymbolicExprVisitor::execute under SlVariantBank::setVariantConditions.
  for k = 1:numel(conds)
    tryset(V(), 'VariantConditions', conds(k));
  end
  % The hidden BankCoderInfo, which is the older spelling of both coder infos at once.
  tryset(V(), 'BankCoderInfo', '1bad');
  tryset(V(), 'BankCoderInfo', '');
  b = V(); b.BankCoderInfo = 'ciA'; showBank('SEQ Bank=ciA', b);
  b = V(); b.BankCoderInfo = 'ciA'; b.AllChoicesCoderInfo = 'ciB'; showBank('SEQ Bank=ciA All=ciB', b);
  b = V(); b.BankCoderInfo = 'ciA'; b.ActiveChoiceCoderInfo = 'ciB'; showBank('SEQ Bank=ciA Active=ciB', b);
  b = V(); b.AllChoicesCoderInfo = 'ciA'; b.ActiveChoiceCoderInfo = 'ciB'; b.BankCoderInfo = 'ciC'; showBank('SEQ All=ciA Active=ciB Bank=ciC', b);
  b = V(); b.BankCoderInfo = 'ciA'; b.BankCoderInfo = ''; showBank('SEQ Bank=ciA Bank=''''', b);
  b = V(); b.BankCoderInfo = 'ciA'; b.AllChoicesCoderInfo = ''; showBank('SEQ Bank=ciA All=''''', b);

  % THE LOAD CHECKS: the committed text file with one field edited by hand, opened by MATLAB.
  src = fileread(fullfile(outDir, 'variantbank_r2027a_text.sldd'));
  loadcheck(src, 'as written', '"Name": "bankA"', '"Name": "bankA"');
  loadcheck(src, 'Name 1bad', '"Name": "bankA"', '"Name": "1bad"');
  loadcheck(src, 'Name rtX', '"Name": "bankA"', '"Name": "rtX"');
  loadcheck(src, 'Name 64 chars', '"Name": "bankA"', ['"Name": "' repmat('a', 1, 64) '"']);
  loadcheck(src, 'Name number', '"Name": "bankA"', '"Name": 5');
  loadcheck(src, 'Description number', '"Description": "desc A"', '"Description": 5');
  loadcheck(src, 'AllChoicesCoderInfo 1bad', '"AllChoicesCoderInfo": "ciA"', '"AllChoicesCoderInfo": "1bad"');
  loadcheck(src, 'AllChoicesCoderInfo end', '"AllChoicesCoderInfo": "ciA"', '"AllChoicesCoderInfo": "end"');
  loadcheck(src, 'ActiveChoiceCoderInfo 1bad', '"ActiveChoiceCoderInfo": "ciB"', '"ActiveChoiceCoderInfo": "1bad"');
  loadcheck(src, 'condition unnormalised', '"V == 1"', '"V==1"');
  loadcheck(src, 'condition unparsable', '"V == 2"', '"V =="');
  loadcheck(src, 'condition E.A', '"V == 2"', '"V == E.A"');
  loadcheck(src, 'condition empty', '"V == 2"', '""');
  loadcheck(src, 'condition number', '"V == 2"', '2');
  loadcheck(src, 'conditions char', '__VC__', '"VariantConditions": "V==1"');
  loadcheck(src, 'conditions number', '__VC__', '"VariantConditions": 5');
  loadcheck(src, 'conditions 2x1', '__DIM__', '');
  loadcheck(src, 'vb1 All ciB under Bank ciA', '__VB1__', '"AllChoicesCoderInfo": "ciB",');
  loadcheck(src, 'vb1 Bank cleared', '__VB1BANK__', '"BankCoderInfo": ""');
  loadcheck(src, 'vb1 Bank ciB', '__VB1BANK__', '"BankCoderInfo": "ciB"');
  loadcheck(src, 'vb1 Bank 1bad', '__VB1BANK__', '"BankCoderInfo": "1bad"');
  fprintf('MAKE_VARIANTBANK_R2027A_DONE\n');
end

function tryset(o, prop, val)
  if ischar(val), label = ['''' strrep(val, newline, '\n') ''''];
  elseif isstring(val), label = ['string ' mat2str(size(val))];
  elseif iscell(val), label = ['cell ' mat2str(size(val)) ' ' cellLabel(val)];
  else, label = [class(val) ' ' mat2str(val)]; end
  try
    o.(prop) = val; got = o.(prop);
    if iscell(got), s = ['cell ' mat2str(size(got)) ' ' cellLabel(got)];
    elseif ischar(got), s = ['''' strrep(got, newline, '\n') ''''];
    else, s = [class(got) ' ' mat2str(size(got))]; end
    fprintf('SET %s.%s = %s -> OK %s\n', class(o), prop, label, s);
  catch e
    fprintf('SET %s.%s = %s -> ERR %s\n', class(o), prop, label, strrep(e.message, newline, ' '));
  end
end

function s = cellLabel(c)
  parts = cell(1, numel(c));
  for k = 1:numel(c)
    if ischar(c{k}), parts{k} = ['''' strrep(c{k}, newline, '\n') ''''];
    elseif isstring(c{k}), parts{k} = ['"' char(c{k}) '"'];
    else, parts{k} = class(c{k}); end
  end
  s = ['{' strjoin(parts, ',') '}'];
end

function showBank(label, b)
  vc = b.VariantConditions;
  if iscell(vc), vcs = ['cell ' mat2str(size(vc)) ' ' cellLabel(vc)]; else, vcs = ['<' class(vc) '>']; end
  fprintf('%s Name=''%s'' Description=''%s'' VC=%s All=''%s'' Active=''%s'' Bank=''%s''\n', label, b.Name, ...
    strrep(b.Description, newline, '\n'), vcs, b.AllChoicesCoderInfo, b.ActiveChoiceCoderInfo, b.BankCoderInfo);
end

function loadcheck(src, label, from, to)
  if strcmp(from, '__VC__')
    % vbN's whole VariantConditions cell, which is the only one holding 'V == 2'.
    edited = regexprep(src, '"VariantConditions": \{[^{}]*"V == 2"\s*\]\s*\}', to, 'once');
  elseif strcmp(from, '__VB1__')
    % vb1's AllChoicesCoderInfo, the one followed by a BankCoderInfo 'ciA'.
    edited = regexprep(src, '"AllChoicesCoderInfo": "ciA",(\s*"BankCoderInfo": "ciA")', [to '$1'], 'once');
  elseif strcmp(from, '__VB1BANK__')
    edited = strrep(src, '"BankCoderInfo": "ciA"', to);
  elseif strcmp(from, '__DIM__')
    % vbN's cell, its 1x2 dimensions spelled 2x1.
    [a, z] = regexp(src, '"VariantConditions": \{\s*"_array_type": "Cell",\s*"_dimensions": \[\s*1,\s*2\s*\],\s*"_elements": \[\s*"V == 1"', 'once');
    edited = src;
    if ~isempty(a)
      seg = src(a:z); k = strfind(seg, '[');
      i1 = k(1) - 1 + find(seg(k(1):end) == '1', 1); i2 = k(1) - 1 + find(seg(k(1):end) == '2', 1);
      seg([i1 i2]) = '21'; edited = [src(1:a-1) seg src(z+1:end)];
    end
  else
    edited = strrep(src, from, to);
  end
  if strcmp(edited, src) && ~strcmp(from, to)
    fprintf('LOAD %s: EDIT DID NOT APPLY\n', label);
    return;
  end
  Simulink.data.dictionary.closeAll('-discard');
  fn = [tempname '.sldd'];
  fid = fopen(fn, 'w'); fwrite(fid, edited, 'char'); fclose(fid);
  lastwarn('');
  try
    dd = Simulink.data.dictionary.open(fn); ds = dd.getSection('Design Data');
    try
      showBank(['LOAD ' label ' vbN'], ds.getEntry('vbN').getValue);
      showBank(['LOAD ' label ' vb1'], ds.getEntry('vb1').getValue);
    catch e
      fprintf('LOAD %s vbN ERR %s\n', label, strrep(e.message, newline, ' '));
    end
    [w, wid] = lastwarn;
    if ~isempty(w), fprintf('LOAD %s WARN %s %s\n', label, wid, strrep(w, newline, ' ')); end
    clear ds
    dd.close();
  catch e
    fprintf('LOAD %s OPEN ERR %s\n', label, strrep(e.message, newline, ' '));
  end
  Simulink.data.dictionary.closeAll('-discard');
  delete(fn);
end
