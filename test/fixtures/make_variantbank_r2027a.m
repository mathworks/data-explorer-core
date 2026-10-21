function make_variantbank_r2027a(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors variantbank_r2027a_text.sldd and variantbank_r2027a_binary.sldd: one dictionary, in
  % each format, holding MATLAB-written Simulink.VariantBank and Simulink.VariantBankCoderInfo
  % entries whose fields are NOT the defaults, so a test can read what MATLAB itself stores for
  % them (test/variantBankFields.test.ts). It then prints, for the record, every setter rule
  % those tests copy (SET lines) and what MATLAB makes of a text dictionary hand-edited to break
  % each rule (LOAD lines), for the bank and then for the coder info. Run (one line: mw splits
  % -batch on newlines):
  %
  %   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); make_variantbank_r2027a"
  %
  % `outDir` defaults to this folder. The committed files were written by R2027a
  % (27.1.0.3409468) on 2026-10-18; a re-run gives new UUIDs and timestamps, and the same values.
  % The coder info SET and LOAD lines were added later the same day and run with `outDir` a
  % scratch folder, which wrote the same values again, so the committed files were not replaced;
  % so were the header file length lines, added in review the same day.
  % The hand-edited copies go to tempdir and are deleted; the tests make the same edits to the
  % committed text file. What the SET and LOAD lines said is recorded in
  % src/datamodel/node/data/Simulink.VariantBank.md and Simulink.VariantBankCoderInfo.md.
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
  % violation while MATLAB set the bank's variant conditions.
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

  % THE CODER INFO SETTER RULES (C-169B): Simulink.VariantBankCoderInfo's five char properties.
  C = @Simulink.VariantBankCoderInfo;
  hf = {'', 'h.h', 'a.hpp', 'a.H', 'a.HPP', 'a.Hpp', 'a.hh', 'a.hxx', 'a.c', 'a.cpp', 'a', 'a.', ...
    '.h', 'a.h.c', 'a.c.h', 'a.b.h', 'inc/a.h', 'inc\a.h', '../a.h', './a.h', '/abs/a.h', ...
    'C:\x\a.h', 'a b.h', ' a.h', 'a.h ', '1a.h', 'rta.h', 'rt.h', 'RTa.h', 'Rta.h', 'xrt.h', ...
    '_a.h', 'a-b.h', 'a$.h', '<a.h>', '"a.h"', 'int.h', 'end.h', [repmat('a', 1, 63) '.h'], ...
    [repmat('a', 1, 64) '.h'], [repmat('a', 1, 300) '.h'], sprintf('a.h\n'), [char(233) '.h'], ...
    'inc/1a.h', 'rt/a.h', '1inc/a.h', 'a b/c.h', 'inc/rta.h', 'inc//a.h', 'inc/', 'a.h/', ...
    '1a.c', 'a b.c', 'rt.c', '.c', 'a b', '1a', 'rta', 'inc/a', '1a.H', 'a.c/', 'a.hpp/', 'ab/', ...
    'a/', 'a.c/x.h', 'x/a.h', 'a.h/x', 'a.1b.h', 'a. .h', 'a.-.h', 'a..h', 'a.rt.h', 'a.c d.h', ...
    '  a.h', sprintf('\ta.h'), ' 1a.h', ' rta.h', 'a .h', 'a.h.h', 'a.hpp.h', 'a.c$.h', 'a$b.c.h', ...
    'a.b/c.h', 'a. h', sprintf('a.h\t'), 'rT.h', 'Rt.h', 'a.c.H', 'a..hpp', ' ', ' .h', '.', '..', ...
    'a.b.c.d.h', 'a_1.v2.hpp', 'A.h', 'a1.h'};
  for k = 1:numel(hf), tryset(C(), 'HeaderFile', hf{k}); end
  tryset(C(), 'HeaderFile', "s.h");
  tryset(C(), 'HeaderFile', 5);
  % A header file name's length (added in review of C-169B): 255 and 256 characters, with .h,
  % .hpp, a leading space and a dotted middle part; which refusal MATLAB gives first for a name
  % too long that another rule refuses too; how a character outside ASCII is counted (é, ǖ, €,
  % 中 and an emoji, at the limit of each count tried); and whether the limit is on the whole
  % name or on each '/'-separated part of it.
  hl = {[repmat('a', 1, 253) '.h'], [repmat('a', 1, 254) '.h'], [repmat('a', 1, 251) '.hpp'], ...
    [repmat('a', 1, 252) '.hpp'], [' ' repmat('a', 1, 252) '.h'], [' ' repmat('a', 1, 253) '.h'], ...
    ['a.' repmat('b', 1, 251) '.h'], ['a.' repmat('b', 1, 252) '.h'], ['inc/' repmat('a', 1, 249) '.h'], ...
    ['inc/' repmat('a', 1, 250) '.h'], ['rt' repmat('a', 1, 300) '.h'], ['1' repmat('a', 1, 300) '.h'], ...
    [repmat('a', 1, 300) '.c'], [repmat('a', 1, 300) '.h '], ['a.' char(233) '.h'], ...
    ['a.' repmat(char(233), 1, 200) '.h'], ['a.' repmat(char(233), 1, 252) '.h'], ...
    ['a.' repmat(char(233), 1, 125) 'x.h'], ['a.' repmat(char(233), 1, 125) 'xx.h'], ...
    ['a.' repmat(char(8364), 1, 83) 'xx.h'], ['a.' repmat(char(8364), 1, 83) 'xxx.h'], ...
    ['a.' repmat(char([55357 56832]), 1, 62) 'xxx.h'], ['a.' repmat(char([55357 56832]), 1, 62) 'xxxx.h'], ...
    ['a.' repmat(char(470), 1, 83) 'x.h'], ['a.' repmat(char(470), 1, 84) 'x.h'], ['a.' repmat(char(20013), 1, 100) '.h'], ...
    ['a.b/' repmat('c', 1, 249) '.h'], ['a.b/' repmat('c', 1, 251) '.h'], ['a.' repmat('b', 1, 260) '/c.h'], ...
    ['a.' repmat(char(8364), 1, 251) '.h'], ['a.' repmat(char(8364), 1, 252) '.h'], ...
    ['a.' repmat(char(20013), 1, 251) '.h'], ['a.' repmat(char(20013), 1, 252) '.h']};
  for k = 1:numel(hl), tryset(C(), 'HeaderFile', hl{k}); end
  df = {'', 'd.c', 'a.h', 'a.cpp', 'a.C', 'a', 'a.', '.c', 'a.txt', 'a b.c', ' a.c', 'a.c ', '1a.c', ...
    'rta.c', '_a.c', 'a-b.c', 'a.b.c', 'inc/a.c', 'inc\a.c', '<a.c>', sprintf('a\nb'), ...
    [repmat('a', 1, 300) '.c'], [char(233) '.c'], 'a. b', 'a.1', 'a.c/', 'a/', 'a.$', 'a. c', ...
    'a.c d', 'a b', '1a', 'rt', 'rta', ' rta.c', '  a.c', sprintf('\ta.c'), 'a .c', 'a.c/x', 'x/a.c', ...
    'a..c', 'a.rt', '.', '..', ' ', ' .c', 'RTa.c', 'int', 'a.c.h'};
  for k = 1:numel(df), tryset(C(), 'DefinitionFile', df{k}); end
  tryset(C(), 'DefinitionFile', "s.c");
  tryset(C(), 'DefinitionFile', 5);
  st = {'', 'pre', sprintf('a\nb'), '  x  ', '#pragma x', repmat('x', 1, 1000), char(233)};
  for k = 1:numel(st), tryset(C(), 'PreStatement', st{k}); tryset(C(), 'PostStatement', st{k}); end
  tryset(C(), 'PreStatement', "s");
  tryset(C(), 'PreStatement', 5);
  tryset(C(), 'PostStatement', "s");
  tryset(C(), 'PostStatement', 5);
  q = {'None', 'none', 'NONE', 'Const', 'const', 'CONST', 'cOnSt', 'Volatile', 'volatile', 'VOLATILE', ...
    '', 'foo', ' const', 'const ', 'Const Volatile', 'const volatile', 'ConstVolatile', 'c', 'Con', ...
    'vol', 'n', 'Const,Volatile', 'constvolatile', 'CONSTVOLATILE', 'Constvolatile', 'constVolatile', ...
    'VolatileConst', 'Restrict', 'restrict', 'Static', 'Extern', 'Register', 'Auto', 'ConstRestrict', ...
    'None ', 'Const_Volatile'};
  for k = 1:numel(q), tryset(C(), 'Qualifier', q{k}); end
  tryset(C(), 'Qualifier', "const");
  tryset(C(), 'Qualifier', 5);
  tryset(C(), 'Qualifier', {'Const'});
  mq = findprop(C(), 'Qualifier');
  fprintf('QUALIFIER META class=%s\n', class(mq));
  try, fprintf('QUALIFIER META validation=%s\n', strrep(evalc('disp(mq.Validation)'), newline, ' ')); catch e, fprintf('QUALIFIER META validation ERR %s\n', e.message); end
  % THE CODER INFO LOAD CHECKS: ciA in the committed text file with one field edited by hand.
  loadcheckCi(src, 'ci as written', '"Qualifier": "Const"', '"Qualifier": "Const"');
  loadcheckCi(src, 'ci Qualifier const', '"Qualifier": "Const"', '"Qualifier": "const"');
  loadcheckCi(src, 'ci Qualifier CONST', '"Qualifier": "Const"', '"Qualifier": "CONST"');
  loadcheckCi(src, 'ci Qualifier Volatile', '"Qualifier": "Const"', '"Qualifier": "Volatile"');
  loadcheckCi(src, 'ci Qualifier foo', '"Qualifier": "Const"', '"Qualifier": "foo"');
  loadcheckCi(src, 'ci Qualifier empty', '"Qualifier": "Const"', '"Qualifier": ""');
  loadcheckCi(src, 'ci Qualifier number', '"Qualifier": "Const"', '"Qualifier": 5');
  loadcheckCi(src, 'ci Qualifier ConstVolatile', '"Qualifier": "Const"', '"Qualifier": "ConstVolatile"');
  loadcheckCi(src, 'ci Qualifier volatile', '"Qualifier": "Const"', '"Qualifier": "volatile"');
  loadcheckCi(src, 'ci HeaderFile leading space', '"HeaderFile": "h.h"', '"HeaderFile": " h.h"');
  loadcheckCi(src, 'ci HeaderFile a.h/', '"HeaderFile": "h.h"', '"HeaderFile": "a.h/"');
  loadcheckCi(src, 'ci HeaderFile a.c.h', '"HeaderFile": "h.h"', '"HeaderFile": "a.c.h"');
  loadcheckCi(src, 'ci HeaderFile rta.h', '"HeaderFile": "h.h"', '"HeaderFile": "rta.h"');
  loadcheckCi(src, 'ci DefinitionFile trailing space', '"DefinitionFile": "d.c"', '"DefinitionFile": "d.c "');
  loadcheckCi(src, 'ci DefinitionFile 1a.c', '"DefinitionFile": "d.c"', '"DefinitionFile": "1a.c"');
  loadcheckCi(src, 'ci HeaderFile a.c', '"HeaderFile": "h.h"', '"HeaderFile": "a.c"');
  loadcheckCi(src, 'ci HeaderFile a b.h', '"HeaderFile": "h.h"', '"HeaderFile": "a b.h"');
  loadcheckCi(src, 'ci HeaderFile empty', '"HeaderFile": "h.h"', '"HeaderFile": ""');
  loadcheckCi(src, 'ci HeaderFile inc/a.h', '"HeaderFile": "h.h"', '"HeaderFile": "inc/a.h"');
  loadcheckCi(src, 'ci HeaderFile a.hpp', '"HeaderFile": "h.h"', '"HeaderFile": "a.hpp"');
  loadcheckCi(src, 'ci HeaderFile number', '"HeaderFile": "h.h"', '"HeaderFile": 5');
  loadcheckCi(src, 'ci HeaderFile 255 chars', '"HeaderFile": "h.h"', ['"HeaderFile": "' repmat('a', 1, 253) '.h"']);
  loadcheckCi(src, 'ci HeaderFile 256 chars', '"HeaderFile": "h.h"', ['"HeaderFile": "' repmat('a', 1, 254) '.h"']);
  loadcheckCi(src, 'ci HeaderFile 302 chars', '"HeaderFile": "h.h"', ['"HeaderFile": "' repmat('a', 1, 300) '.h"']);
  loadcheckCi(src, 'ci HeaderFile 255 decomposed', '"HeaderFile": "h.h"', ['"HeaderFile": "a.' repmat(char(233), 1, 125) 'x.h"']);
  loadcheckCi(src, 'ci HeaderFile 256 decomposed', '"HeaderFile": "h.h"', ['"HeaderFile": "a.' repmat(char(233), 1, 125) 'xx.h"']);
  loadcheckCi(src, 'ci HeaderFile 257 in two parts', '"HeaderFile": "h.h"', ['"HeaderFile": "a.b/' repmat('c', 1, 251) '.h"']);
  loadcheckCi(src, 'ci HeaderFile folder of 262', '"HeaderFile": "h.h"', ['"HeaderFile": "a.' repmat('b', 1, 260) '/c.h"']);
  loadcheckCi(src, 'ci DefinitionFile a b.c', '"DefinitionFile": "d.c"', '"DefinitionFile": "a b.c"');
  loadcheckCi(src, 'ci DefinitionFile a.txt', '"DefinitionFile": "d.c"', '"DefinitionFile": "a.txt"');
  loadcheckCi(src, 'ci DefinitionFile number', '"DefinitionFile": "d.c"', '"DefinitionFile": 5');
  loadcheckCi(src, 'ci PreStatement number', '"PreStatement": "pre"', '"PreStatement": 5');
  loadcheckCi(src, 'ci PostStatement LF', '"PostStatement": "post"', '"PostStatement": "a\nb"');
  loadcheckCi(src, 'ci PostStatement number', '"PostStatement": "post"', '"PostStatement": 5');
  % R2026b's spelling: a text dictionary that release wrote holds a coder info as plain
  % properties, with no envelope (measured: "_elements": [{"_id": "1",
  % "_properties": {...}}]). ciA respelled so, then edited by hand the same way.
  plain = regexprep(src, ['"_custom_save": \{\s*"_array_type": "Struct",\s*"_dimensions": \[\s*1,\s*1\s*\],\s*' ...
    '"_elements": \[\s*(\{[^{}]*"HeaderFile": "h\.h"[^{}]*\})\s*\],\s*"_fields": \[[^\]]*\]\s*\},\s*"_id": "1"'], ...
    '"_id": "1", "_properties": $1', 'once');
  if strcmp(plain, src), fprintf('LOAD r2026b: RESPELL DID NOT APPLY\n'); end
  loadcheckCi(plain, 'r2026b as written', '"Qualifier": "Const"', '"Qualifier": "Const"');
  loadcheckCi(plain, 'r2026b HeaderFile x.h', '"HeaderFile": "h.h"', '"HeaderFile": "x.h"');
  loadcheckCi(plain, 'r2026b Qualifier const', '"Qualifier": "Const"', '"Qualifier": "const"');
  loadcheckCi(plain, 'r2026b Qualifier foo', '"Qualifier": "Const"', '"Qualifier": "foo"');
  loadcheckCi(plain, 'r2026b HeaderFile a.c', '"HeaderFile": "h.h"', '"HeaderFile": "a.c"');
  loadcheckCi(plain, 'r2026b HeaderFile number', '"HeaderFile": "h.h"', '"HeaderFile": 5');
  loadcheckCi(plain, 'r2026b HeaderFile 255 chars', '"HeaderFile": "h.h"', ['"HeaderFile": "' repmat('a', 1, 253) '.h"']);
  loadcheckCi(plain, 'r2026b HeaderFile 256 chars', '"HeaderFile": "h.h"', ['"HeaderFile": "' repmat('a', 1, 254) '.h"']);
  loadcheckCi(plain, 'r2026b DefinitionFile a b.c', '"DefinitionFile": "d.c"', '"DefinitionFile": "a b.c"');
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

function showCi(label, c)
  fprintf('%s HeaderFile=''%s'' DefinitionFile=''%s'' Pre=''%s'' Post=''%s'' Qualifier=''%s''\n', label, ...
    strrep(c.HeaderFile, newline, '\n'), strrep(c.DefinitionFile, newline, '\n'), ...
    strrep(c.PreStatement, newline, '\n'), strrep(c.PostStatement, newline, '\n'), c.Qualifier);
end

function loadcheckCi(src, label, from, to)
  edited = strrep(src, from, to);
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
      showCi(['LOAD ' label ' ciA'], ds.getEntry('ciA').getValue);
      showCi(['LOAD ' label ' ciB'], ds.getEntry('ciB').getValue);
    catch e
      fprintf('LOAD %s ciA ERR %s\n', label, strrep(e.message, newline, ' '));
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
