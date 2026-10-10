classdef FhHolder
  % Copyright 2026 The MathWorks, Inc.
  % A plain value class with a function-handle property, used only by
  % make_sparse_fixtures.m's section probe (notes.probes): Design Data refuses a plain
  % class, and the probe records what Other Data does with one.
  properties
    F = @sin
    N = 1
  end
end
