classdef FhAlias < Simulink.AliasType
  % Copyright 2026 The MathWorks, Inc.
  % A Simulink.AliasType subclass with a function-handle property, for
  % make_sparse_fixtures.m: the value a binary dictionary writes as Encoding="hex" for a
  % reason other than sparsity. A Simulink.DataType subclass has to live in a class
  % directory inside a package (MATLAB refuses it otherwise), hence +dexsparse/@FhAlias.
  properties
    Fh = @cos
  end
end
