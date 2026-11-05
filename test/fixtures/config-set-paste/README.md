<!-- Copyright 2026 The MathWorks, Inc. -->

# A configuration set in a model and in a dictionary, as MATLAB saves them

For `test/configSetPaste.test.ts`, written on R2027a (2026-11-05) by
`test/parity/matlab/gen_config_set_paste.m`:

- `pm.slx`: a model holding Configuration (active), Fast (fixed-step, StopTime 2, a Description of
  two lines) and R (a `Simulink.ConfigSetRef` to dictCfg, Description `refdesc`).
- `pd.sldd`: a text dictionary holding the same Fast and R in its Configurations. Each one's
  `_properties` are the model part's, byte for byte.
- `pm__dup.slx`: `pm.slx` with a copy of Fast attached as MATLAB names a duplicate
  (`attachConfigSet`'s allowRename): Fast1.
