classdef ComplexHolder
  % The custom class behind complex_objects.mat's `holder`: one plain MCOS value class (no
  % superclass) with a complex number in each of the places a property can hold one — a
  % scalar, a struct field, a cell element and a matrix — and two more rows, one holding a
  % NaN element and one of class int16. Each default is the sentinel 0 (or an empty struct
  % or cell); make_complex_fixtures.m assigns all six, for the reason Widget.m gives: a
  % value that lives in a classdef default is not in the file under test.
  properties
    Z = 0
    S = struct()
    C = {}
    Zm = 0
    N = 0
    I = 0
  end
end
