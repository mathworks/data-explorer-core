classdef HolderAlias < Simulink.AliasType
  % Copyright 2026 The MathWorks, Inc.
  % A Simulink.AliasType subclass holding a function handle and a struct, for
  % make_hex_object_fixtures.m: the function handle makes a binary dictionary write the
  % whole object as Encoding="hex", and the struct is then a struct INSIDE a hex value —
  % which this package decodes into a StructNode under the node that holds the stream.
  properties
    Fh = @sin
    S = struct('a', 1, 'b', 'x')
  end
end
