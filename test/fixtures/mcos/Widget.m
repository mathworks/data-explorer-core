classdef Widget
  % The authoring class for custom_object_{binary,text}.sldd: ONE plain MCOS value class
  % (no superclass) whose properties cover every value shape a dictionary can hold, so a
  % reader change that breaks one of them breaks a NAMED property rather than "the
  % fixture".
  %
  % WHY EVERY DEFAULT IS THE SENTINEL 0, AND WHY THE VALUES LIVE IN THE GENERATOR.
  % The two dictionary formats disagree about defaults, measured on the first cut of
  % these fixtures (R2027a):
  %
  %   compressed-binary  writes EVERY property of an object, touched or not
  %   JSON text          writes only properties away from the CLASSDEF DEFAULT, and
  %                      reconstructs the rest from the class at load time
  %
  % The first cut put the interesting values in the defaults here and set only the four
  % object-valued properties in the generator. MATLAB read both twins back perfectly — and
  % custom_object_text.sldd contained four properties out of twenty. The literal string
  % `pad me` was not in the file at all. A twin pair like that is worse than no twin: it
  % looks like a control and is not one, because the text member's values live in a .m file
  % the reader under test has never seen.
  %
  % So nothing here is a real value. `0` is a sentinel no property in the fixture uses, and
  % make_class_fixtures.m assigns all twenty — which makes all twenty non-default and so
  % present in BOTH formats. The fixture's content is in the generator, in one place, where
  % the next person looking for it will be.
  %
  % WHAT EACH PROPERTY IS FOR (values in make_class_fixtures.m/custom_items):
  %
  %   Padded   ' pad me ' with LEADING AND TRAILING SPACES. The single most load-bearing
  %            value here. DictionaryXmlFast coerces a text body ONLY IF IT EQUALS ITS OWN
  %            TRIM, precisely so a padded char array survives; a reader that trims turns
  %            this into 'pad me' and nothing else in the corpus notices.
  %   Hostile  all five characters XML must escape (& < > " ') in one char array. MATLAB
  %            escapes only the first three — `"` and `'` are written RAW, because they
  %            need escaping in an attribute value and not in element text — so this also
  %            pins which of the five entities a dictionary ever actually contains.
  %   Ctrl /   the CONTROL-CHARACTER cases, and the reason this class is worth more than
  %   Cr /     its property count. Measured one character at a time in
  %   Tab / Lf .scratch/probe_char_format.m, MATLAB has THREE encodings for a char array
  %            and picks by content:
  %
  %              printable, incl. tab(9) and LF(10)   written literally
  %              CR(13)                               written as &#xD;
  %              NUL(0), BEL(7), DEL(127), or any      the WHOLE array becomes
  %              non-BMP char (surrogate pair)        Format="decimal" and the body is
  %                                                   the char CODES, space separated
  %
  %            Both of the last two are outside what the readers were built for: `Format`
  %            is a FIFTEENTH attribute (DictionaryXmlFast interns fourteen, and the
  %            32-dictionary corpus census found no other), and `&#xD;` is a numeric
  %            character reference, which that census found zero of. One property each:
  %              Ctrl -> Format="decimal">9 10 13 7 1  (one bad character decimalizes all)
  %              Cr   -> a&#xD;b
  %              Tab  -> a<TAB>b    literal tab in element text
  %              Lf   -> a<LF>b     literal newline in element text
  %            Tab and Lf are not filler: a reader that strips layout whitespace from
  %            element text — which DictionaryXmlFast deliberately does — has to not strip
  %            these, and nothing in the corpus made it prove that.
  %
  %            AND CR IS WHERE THE TWO FORMATS STOP AGREEING. With these values finally in
  %            the files rather than in this classdef, MATLAB round-trips char 13 through
  %            compressed-binary and LOSES it through JSON text: Ctrl comes back
  %            [9 10 7 1] and Cr comes back 'ab'. custom_object_text.sldd holds zero raw
  %            CR bytes and zero \r escapes, while \t, \n, \u0007 and \u0001 all survive in
  %            the same strings — so the character is dropped on write, not mis-escaped.
  %            verify_class_fixtures.m asserts both behaviours by format on purpose.
  %   Cplx     complex scalar; MATLAB writes IsComplex="1" and a `3.0+4.0i` body.
  %   Matrix   2x3, so a column-major flattening is visible as a transpose rather than as
  %            the same six numbers in a different order.
  %   Nothing / ZeroStruct / EmptyStruct — the three distinct EMPTIES, which are not
  %            interchangeable: [] is 0x0 double, struct([]) is a 0x0 struct, struct() is a
  %            1x1 struct with no fields. They serialize three different ways.
  %   Tuning   a Simulink.Parameter INSIDE a custom class. The nesting direction the corpus
  %            lacked: object_props and rt_bin both have custom-in-custom, nothing had
  %            MathWorks-in-custom.
  %   Part /   a scalar custom object and a 1x3 object ARRAY. An object array cannot be an
  %   Parts    entry value at all (see make_class_fixtures.m), so a property is the only
  %            place real MATLAB output puts one.
  properties
    Scalar = 0
    Matrix = 0
    Cplx = 0
    Padded = 0
    Str = 0
    Flag = 0
    Nothing = 0
    EmptyStruct = 0
    ZeroStruct = 0
    Nested = 0
    Cells = 0
    Hostile = 0
    Ctrl = 0
    Cr = 0
    Tab = 0
    Lf = 0
    Mode = 0
    Part = 0
    Parts = 0
    Tuning = 0
  end
end
