<!-- Copyright 2026 The MathWorks, Inc. -->

# Configuration set edits, as MATLAB saves them

MATLAB's own saves of each edit of a model's configuration sets, for
`test/configSetsWriter.test.ts`, which makes the same edit with `ConfigSetsWriter` and holds the
result to them. Written on R2027a (2026-11-03) from the models of `test/fixtures/active-config`:

- `<model>__<edit>.slx`: by `test/parity/matlab/probe_config_set_writes.m`, which opens the model,
  makes the edit (`none` for none) and saves it in the model's own layout (`save_system`, with
  `ExportToVersion` for an older one). The edits: `add` (a fresh `Simulink.ConfigSet` named Added),
  `addref` (a `Simulink.ConfigSetRef` named AddedRef, to dictCfg), `rename` (Slow to Slower),
  `describe` (Fast's Description 'Quick runs'), `delete` (Slow), `copy` (a copy of Fast, FastCopy).
- `esc*.slx`: `acs_sets.slx` with Slow renamed `Slow set-2` and Fast's Description set to
  `line1 <a&b> "q" 's'` and a second line, `line2`, saved in R2027a and exported to R2025a, R2021a,
  R2018a and R2013b: how each layout writes a name and a Description.
