function E = probe_display_catalog()
%PROBE_DISPLAY_CATALOG  Named values for measuring MATLAB's Workspace-browser display.
%   E is an N-by-3 cell: {name, maker, group}. maker is a function handle that
%   builds the value, so a value MATLAB cannot create fails on its own row
%   (the harness records the error) instead of failing the whole catalog.
%   Requires: DispColor (Simulink.defineIntEnumType, done by probe_display.m),
%   DispLevel.m and DispWidget.m (test/fixtures/display/, which the probe adds to the path).
E = {};
    function add(group, name, maker)
        E(end+1, :) = {name, maker, group};
    end

% ---------------------------------------------------------------- double scalars
add('double', 'd_zero',        @() 0);
add('double', 'd_negzero',     @() -0);
add('double', 'd_one',         @() 1);
add('double', 'd_neg_1p5',     @() -1.5);
add('double', 'd_half',        @() 0.5);
add('double', 'd_nan',         @() NaN);
add('double', 'd_inf',         @() Inf);
add('double', 'd_neginf',      @() -Inf);
add('double', 'd_pi',          @() pi);
add('double', 'd_negpi',       @() -pi);
add('double', 'd_third',       @() 1/3);
add('double', 'd_1e10',        @() 1e10);
add('double', 'd_1em10',       @() 1e-10);
add('double', 'd_1e5',         @() 1e5);
add('double', 'd_99999',       @() 99999);
add('double', 'd_123456789',   @() 123456789);
add('double', 'd_12345p678',   @() 12345.678);
add('double', 'd_123p456',     @() 123.456);
add('double', 'd_0p001',       @() 0.001);
add('double', 'd_1em5_neg',    @() -1e-5);
add('double', 'd_0p1plus0p2',  @() 0.1+0.2);
add('double', 'd_1e15',        @() 1e15);
add('double', 'd_1e16',        @() 1e16);
add('double', 'd_1e20',        @() 1e20);
add('double', 'd_2pow53',      @() 2^53);
add('double', 'd_realmax',     @() realmax);
add('double', 'd_realmin',     @() realmin);
add('double', 'd_eps',         @() eps);
% ---------------------------------------------------------------- single scalars
add('single', 's_zero',        @() single(0));
add('single', 's_one',         @() single(1));
add('single', 's_pi',          @() single(pi));
add('single', 's_third',       @() single(1/3));
add('single', 's_1e10',        @() single(1e10));
add('single', 's_nan',         @() single(NaN));
add('single', 's_realmax',     @() realmax('single'));
% ---------------------------------------------------------------- integer scalars
add('int', 'i8_42',            @() int8(42));
add('int', 'i8_neg7',          @() int8(-7));
add('int', 'i8_max',           @() intmax('int8'));
add('int', 'i8_min',           @() intmin('int8'));
add('int', 'u8_0',             @() uint8(0));
add('int', 'u8_max',           @() intmax('uint8'));
add('int', 'i16_max',          @() intmax('int16'));
add('int', 'i16_min',          @() intmin('int16'));
add('int', 'u16_max',          @() intmax('uint16'));
add('int', 'i32_max',          @() intmax('int32'));
add('int', 'i32_min',          @() intmin('int32'));
add('int', 'u32_max',          @() intmax('uint32'));
add('int', 'i64_max',          @() intmax('int64'));
add('int', 'i64_min',          @() intmin('int64'));
add('int', 'i64_5',            @() int64(5));
add('int', 'u64_0',            @() uint64(0));
add('int', 'u64_max',          @() intmax('uint64'));
add('int', 'u64_2pow53p1',     @() uint64(9007199254740993));
% ---------------------------------------------------------------- logical
add('logical', 'l_true',       @() true);
add('logical', 'l_false',      @() false);
add('logical', 'l_row3',       @() [true false true]);
add('logical', 'l_2x2',        @() logical([1 0; 0 1]));
% ---------------------------------------------------------------- char
add('char', 'c_empty',         @() '');
add('char', 'c_space',         @() ' ');
add('char', 'c_abc',           @() 'abc');
add('char', 'c_quote',         @() 'it''s');
add('char', 'c_dquote',        @() 'say "hi"');
add('char', 'c_2row',          @() ['ab'; 'cd']);
add('char', 'c_3x1',           @() ['a'; 'b'; 'c']);
add('char', 'c_newline',       @() sprintf('a\nb'));
add('char', 'c_tab',           @() sprintf('a\tb'));
add('char', 'c_nul',           @() ['a' char(0) 'b']);
add('char', 'c_unicode',       @() ['h' char(233) 'llo ' char(8364)]);
add('char', 'c_len1000',       @() repmat('x', 1, 1000));
add('char', 'c_len100000',     @() repmat('y', 1, 100000));
add('char', 'c_2x2x2',         @() repmat('a', [2 2 2]));
% ---------------------------------------------------------------- string
add('string', 'str_empty',     @() "");
add('string', 'str_abc',       @() "abc");
add('string', 'str_quote',     @() "say ""hi""");
add('string', 'str_apos',      @() "it's");
add('string', 'str_newline',   @() "a" + newline + "b");
add('string', 'str_row2',      @() ["a" "bb"]);
add('string', 'str_col2',      @() ["a"; "bb"]);
add('string', 'str_2x2',       @() ["a" "b"; "c" "d"]);
add('string', 'str_1x10',      @() "s" + (1:10));
add('string', 'str_1x11',      @() "s" + (1:11));
add('string', 'str_missing',   @() string(missing));
add('string', 'str_row_with_missing', @() ["a" string(missing)]);
add('string', 'str_0x3',       @() strings(0, 3));
add('string', 'str_len1000',   @() string(repmat('z', 1, 1000)));
add('string', 'str_len100000', @() string(repmat('w', 1, 100000)));
add('missing', 'm_missing',    @() missing);
% ---------------------------------------------------------------- complex
add('complex', 'z_scalar',     @() 1+2i);
add('complex', 'z_neg',        @() -1-2i);
add('complex', 'z_pureimag',   @() 2i);
add('complex', 'z_pi_e',       @() pi + 1i*exp(1));
add('complex', 'z_zeroimag',   @() complex(1, 0));
add('complex', 'z_nanimag',    @() complex(1, NaN));
add('complex', 'z_vector',     @() [1+2i 3-4i]);
add('complex', 'z_col',        @() [1+2i; 3-4i]);
add('complex', 'z_2x2',        @() [1+2i 3; 4 5-6i]);
add('complex', 'z_1x11',       @() (1:11) + 1i);
add('complex', 'z_single',     @() single(1+2i));
add('complex', 'z_single_pi',  @() single(pi + 1i));
add('complex', 'z_int16',      @() int16(1+2i));
add('complex', 'z_int16_vec',  @() int16([1+2i 3-4i]));
add('complex', 'z_int8_vec',   @() int8([1+2i -3-4i]));
add('complex', 'z_uint8',      @() complex(uint8(3), uint8(4)));
% ---------------------------------------------------------------- double arrays (summary boundary is numel 11)
add('double-array', 'd_1x2_neg',   @() [-1 2]);
add('double-array', 'd_1x5',       @() 1:5);
add('double-array', 'd_1x10',      @() 1:10);
add('double-array', 'd_1x11',      @() 1:11);
add('double-array', 'd_10x1',      @() (1:10)');
add('double-array', 'd_11x1',      @() (1:11)');
add('double-array', 'd_2x2',       @() [1 2; 3 4]);
add('double-array', 'd_2x5',       @() reshape(1:10, 2, 5));
add('double-array', 'd_3x4',       @() reshape(1:12, 3, 4));
add('double-array', 'd_10x10',     @() reshape(1:100, 10, 10));
add('double-array', 'd_11x11',     @() reshape(1:121, 11, 11));
add('double-array', 'd_100x100',   @() reshape(1:10000, 100, 100));
add('double-array', 'd_1x10_frac', @() (1:10)/3);
add('double-array', 'd_1x3_frac',  @() [0.5 0.25 1/3]);
add('double-array', 'd_2x2_frac',  @() [pi 1; 2 3]);
add('double-array', 'd_col_frac',  @() [0.5; 0.25]);
add('double-array', 'd_row_nonfinite', @() [1 NaN Inf -Inf]);
add('double-array', 'd_row_scale_1e6', @() [1 1e6]);
add('double-array', 'd_row_scale_frac', @() [1.5 1e5]);
add('double-array', 'd_row_tiny',  @() [1e-10 1]);
add('double-array', 'd_col_scale', @() [1; 1e6]);
add('double-array', 'd_2x3_scale', @() [1 2 3; 4 5 1e6]);
add('double-array', 'd_2x2_scale_frac', @() [1.5 2; 3 1e5]);
add('double-array', 'd_row_negzero', @() [0 -0]);
% ---------------------------------------------------------------- other numeric arrays
add('int-array', 'i8_1x5',     @() int8(1:5));
add('int-array', 'i8_1x10',    @() int8(1:10));
add('int-array', 'i8_1x11',    @() int8(1:11));
add('int-array', 'i8_10x1',    @() int8((1:10)'));
add('int-array', 'i8_11x1',    @() int8((1:11)'));
add('int-array', 'i8_2x2',     @() int8([1 -2; 3 4]));
add('int-array', 'i8_2x5',     @() int8(reshape(1:10, 2, 5)));
add('int-array', 'i8_3x4',     @() int8(reshape(1:12, 3, 4)));
add('int-array', 'i8_10x10',   @() int8(reshape(mod(0:99, 127), 10, 10)));
add('int-array', 'i8_11x11',   @() int8(reshape(mod(0:120, 127), 11, 11)));
add('int-array', 'i8_100x100', @() int8(reshape(mod(0:9999, 127), 100, 100)));
add('int-array', 'i8_minmax',  @() [intmin('int8') intmax('int8')]);
add('int-array', 'u64_vec',    @() [uint64(0) intmax('uint64')]);
add('int-array', 'i64_vec',    @() [intmin('int64') intmax('int64')]);
add('int-array', 'i32_2x2',    @() int32([100000 -2; 3 4]));
add('int-array', 's_vec',      @() single([pi 1/3]));
add('int-array', 's_2x2',      @() single([1 2; 3 4]));
% ---------------------------------------------------------------- logical arrays
add('logical-array', 'l_1x5',     @() logical(mod(1:5, 2)));
add('logical-array', 'l_1x10',    @() logical(mod(1:10, 2)));
add('logical-array', 'l_1x11',    @() logical(mod(1:11, 2)));
add('logical-array', 'l_10x1',    @() logical(mod((1:10)', 2)));
add('logical-array', 'l_11x1',    @() logical(mod((1:11)', 2)));
add('logical-array', 'l_2x5',     @() logical(mod(reshape(1:10, 2, 5), 2)));
add('logical-array', 'l_3x4',     @() logical(mod(reshape(1:12, 3, 4), 2)));
add('logical-array', 'l_10x10',   @() logical(eye(10)));
add('logical-array', 'l_11x11',   @() logical(eye(11)));
add('logical-array', 'l_100x100', @() logical(eye(100)));
% ---------------------------------------------------------------- N-D
add('nd', 'd_2x2x2',           @() reshape(1:8, 2, 2, 2));
add('nd', 'd_1x1x3',           @() reshape(1:3, 1, 1, 3));
add('nd', 'd_2x3x4x5',         @() reshape(1:120, 2, 3, 4, 5));
add('nd', 'd_2x2x2x2x2',       @() reshape(1:32, 2, 2, 2, 2, 2));
add('nd', 'i8_2x2x2',          @() int8(reshape(1:8, 2, 2, 2)));
add('nd', 'l_2x2x2',           @() true(2, 2, 2));
add('nd', 'cell_2x2x2',        @() cell(2, 2, 2));
add('nd', 'str_2x2x2',         @() repmat("a", [2 2 2]));
% ---------------------------------------------------------------- empties (c040-workspace-probe.m, same names)
add('empty', 'dx_double_0x0',        @() []);
add('empty', 'dx_double_1x0',        @() zeros(1,0));
add('empty', 'dx_double_0x1',        @() zeros(0,1));
add('empty', 'dx_double_0x3',        @() zeros(0,3));
add('empty', 'dx_double_0x0x2',      @() zeros(0,0,2));
add('empty', 'dx_single_0x0',        @() single([]));
add('empty', 'dx_int8_0x3',          @() zeros(0,3,'int8'));
add('empty', 'dx_logical_1x0',       @() false(1,0));
add('empty', 'dx_complex_0x0',       @() complex([]));
add('empty', 'dx_complex_1x0',       @() complex(zeros(1,0)));
add('empty', 'dx_complex_int16_1x0', @() complex(zeros(1,0,'int16')));
add('empty', 'dx_complex_scalar',    @() 1+2i);
add('empty', 'dx_complex_vector',    @() [1+2i 3-4i]);
add('empty', 'dx_complex_int16',     @() int16(1+2i));
add('empty', 'dx_char_0x0',          @() '');
add('empty', 'dx_char_1x0',          @() char(zeros(1,0)));
add('empty', 'dx_char_0x2',          @() char(zeros(0,2)));
add('empty', 'dx_string_empty_1x1',  @() "");
add('empty', 'dx_string_0x0',        @() strings(0,0));
add('empty', 'dx_string_1x0',        @() strings(1,0));
add('empty', 'dx_cell_0x0',          @() {});
add('empty', 'dx_cell_1x0',          @() cell(1,0));
add('empty', 'dx_cell_0x3',          @() cell(0,3));
add('empty', 'dx_struct_0x0',        @() struct([]));
add('empty', 'dx_struct_0x0_fields', @() struct('a', {}));
add('empty', 'dx_struct_1x0',        @() repmat(struct('a', 1), 1, 0));
add('empty', 'dx_sparse_0x0',        @() sparse([]));
add('empty', 'dx_sparse_2x0',        @() sparse(2, 0));
add('empty', 'dx_enum_0x0',          @() matlab.lang.OnOffSwitchState.empty);
add('empty', 'dx_enum_1x0',          @() matlab.lang.OnOffSwitchState.empty(1,0));
add('empty', 'dx_param_empty',       @() Simulink.Parameter([]));
add('empty', 'dx_param_complex_1x0', @() Simulink.Parameter(complex(zeros(1,0))));
add('empty', 'e_logical_0x3',        @() false(0,3));
add('empty', 'e_logical_0x0',        @() logical([]));
add('empty', 'e_uint64_0x0',         @() uint64([]));
add('empty', 'e_single_complex_1x0', @() complex(single(zeros(1,0))));
add('empty', 'e_sparse_logical_0x0', @() sparse(logical([])));
add('empty', 'e_func_handle_none',   @() function_handle.empty);
% ---------------------------------------------------------------- cells
add('cell', 'cell_1',          @() {1});
add('cell', 'cell_char',       @() {'a'});
add('cell', 'cell_mixed',      @() {1, 'two', [3 4]});
add('cell', 'cell_nested',     @() {1, {2, {3}}});
add('cell', 'cell_cellstr',    @() {'a', 'bb'});
add('cell', 'cell_col',        @() {1; 2});
add('cell', 'cell_2x2',        @() {1 'a'; [1 2] {}});
add('cell', 'cell_1x10',       @() num2cell(1:10));
add('cell', 'cell_1x11',       @() num2cell(1:11));
add('cell', 'cell_of_struct',  @() {struct('a', 1)});
add('cell', 'cell_of_empty',   @() {[]});
add('cell', 'cell_of_string',  @() {"abc"});
add('cell', 'cell_of_param',   @() {Simulink.Parameter(1)});
% ---------------------------------------------------------------- structs
add('struct', 'st_scalar',     @() struct('a', 1, 'b', 'x'));
add('struct', 'st_nofields',   @() struct());
add('struct', 'st_1x2',        @() struct('a', {1, 2}));
add('struct', 'st_2x2',        @() repmat(struct('a', 1), 2, 2));
add('struct', 'st_nested',     @() struct('inner', struct('x', 1, 'y', [1 2 3])));
add('struct', 'st_bigfields',  @() struct('m', magic(4), 's', "str", 'c', {{1, 2}}));
% ---------------------------------------------------------------- enums
add('enum', 'en_on',           @() matlab.lang.OnOffSwitchState.on);
add('enum', 'en_off',          @() matlab.lang.OnOffSwitchState.off);
add('enum', 'en_onoff_vec',    @() [matlab.lang.OnOffSwitchState.on matlab.lang.OnOffSwitchState.off matlab.lang.OnOffSwitchState.on]);
add('enum', 'en_sl_red',       @() DispColor.Red);
add('enum', 'en_sl_vec',       @() [DispColor.Red DispColor.Blue]);
add('enum', 'en_sl_empty',     @() DispColor.empty(0, 0));
add('enum', 'en_i32_high',     @() DispLevel.High);
add('enum', 'en_i32_vec',      @() [DispLevel.Low DispLevel.High]);
add('enum', 'en_i32_empty',    @() DispLevel.empty(1, 0));
% ---------------------------------------------------------------- Simulink objects
add('object', 'p_scalar',      @() Simulink.Parameter(5));
add('object', 'p_pi',          @() Simulink.Parameter(pi));
add('object', 'p_int8',        @() Simulink.Parameter(int8(3)));
add('object', 'p_bool',        @() Simulink.Parameter(true));
add('object', 'p_vec',         @() Simulink.Parameter([1 2 3]));
add('object', 'p_1x11',        @() Simulink.Parameter(1:11));
add('object', 'p_matrix',      @() Simulink.Parameter(magic(3)));
add('object', 'p_complex',     @() Simulink.Parameter(1+2i));
add('object', 'p_struct',      @() Simulink.Parameter(struct('a', 1, 'b', 2)));
add('object', 'p_enum',        @() Simulink.Parameter(DispColor.Green));
add('object', 'p_string',      @() Simulink.Parameter("abc"));
add('object', 'p_props',       @() mkParamProps());
add('object', 'p_noarg',       @() Simulink.Parameter);
add('object', 'sig_default',   @() Simulink.Signal);
add('object', 'sig_props',     @() mkSignalProps());
add('object', 'alias_int16',   @() Simulink.AliasType('int16'));
add('object', 'nt_default',    @() Simulink.NumericType);
add('object', 'nt_fixdt',      @() fixdt(1, 16, 8));
add('object', 'bus_empty',     @() Simulink.Bus);
add('object', 'bus_two',       @() mkBus());
add('object', 'busel',         @() Simulink.BusElement);
add('object', 'lut_default',   @() Simulink.LookupTable);
add('object', 'bp_default',    @() Simulink.Breakpoint);
add('object', 'vt_default',    @() Simulink.ValueType);
add('object', 'variant_expr',  @() Simulink.Variant('DISP_MODE==1'));
add('object', 'enumdef',       @() mkEnumDef());
add('object', 'p_array_1x2',   @() [Simulink.Parameter(1) Simulink.Parameter(2)]);
add('object', 'autosar_param', @() AUTOSAR.Parameter);
add('object', 'mpt_param',     @() mpt.Parameter);
add('object', 'widget',        @() DispWidget);
add('object', 'widget_1x2',    @() [DispWidget DispWidget]);
% ---------------------------------------------------------------- sparse
add('sparse', 'sp_scalar',     @() sparse(5));
add('sparse', 'sp_scalar_pi',  @() sparse(pi));
add('sparse', 'sp_zero_scalar', @() sparse(0));
add('sparse', 'sp_vec',        @() sparse([1 0 2]));
add('sparse', 'sp_matrix',     @() sparse([1 0; 0 2]));
add('sparse', 'sp_eye100',     @() speye(100));
add('sparse', 'sp_complex',    @() sparse([1+2i 0]));
add('sparse', 'sp_complex_scalar', @() sparse(1+2i));
add('sparse', 'sp_logical',    @() sparse(logical([1 0 1])));
add('sparse', 'sp_logical_scalar', @() sparse(true));
add('sparse', 'sp_allzero_2x2', @() sparse(2, 2));
% ---------------------------------------------------------------- function handles
add('func', 'fh_sin',          @() @sin);
add('func', 'fh_anon',         @() @(x) x.^2 + 1);
% ---------------------------------------------------------------- other MATLAB types a .mat commonly holds
add('other', 'fi_pi',          @() fi(pi));
add('other', 'fi_vec',         @() fi([1 2 3], 1, 16, 8));
add('other', 'half_one',       @() half(1));
add('other', 'dt_date',        @() datetime(2026, 10, 15));
add('other', 'dur_hours',      @() hours(1.5));
add('other', 'cat_ab',         @() categorical({'a', 'b'}));
add('other', 'cat_scalar',     @() categorical({'a'}));
add('other', 'tbl_2x2',        @() table([1; 2], {'a'; 'b'}));
add('other', 'map_1',          @() containers.Map({'a'}, {1}));
add('other', 'dict_2',         @() dictionary(["a" "b"], [1 2]));
add('other', 'ts_3',           @() timeseries([1 2 3]));
end

% ---------------------------------------------------------------- builders
function p = mkParamProps()
p = Simulink.Parameter(int16(7));
p.Min = 0;
p.Max = 100;
p.Unit = 'm/s';
p.Description = 'A parameter with properties';
p.DataType = 'int16';
end

function s = mkSignalProps()
s = Simulink.Signal;
s.DataType = 'single';
s.Dimensions = [1 3];
s.Unit = 'V';
s.InitialValue = '0';
end

function b = mkBus()
e1 = Simulink.BusElement; e1.Name = 'speed'; e1.DataType = 'double';
e2 = Simulink.BusElement; e2.Name = 'flags'; e2.DataType = 'uint8'; e2.Dimensions = [1 4];
b = Simulink.Bus;
b.Elements = [e1 e2];
b.Description = 'two elements';
end

function d = mkEnumDef()
d = Simulink.data.dictionary.EnumTypeDefinition;   % default: one enumeral, enum1 = 0
appendEnumeral(d, 'Second', 2, '');
end
