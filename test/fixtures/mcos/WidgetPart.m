classdef WidgetPart
  % The leaf custom class behind Widget's two object-valued properties: one scalar
  % (Widget.Part) and one ARRAY (Widget.Parts). Kept deliberately tiny — its job is to
  % be countable, not to hold interesting values, because what is under test is the
  % `<P Name="Parts" Dimension="1*3">` + one classed `<Element>` per element shape,
  % and a fat leaf only makes that shape harder to read in the XML.
  %
  % Label carries the index so a mis-ordered or truncated element list is visible by
  % reading, not by counting.
  properties
    PartId = 0
    Label = 'part'
  end
end
