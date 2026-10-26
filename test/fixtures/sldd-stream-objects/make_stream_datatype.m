function make_stream_datatype(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors the fixtures for a Simulink.Parameter's DataType inside a dictionary entry's MAT stream
  % following each edit of its Value in turn: one entry, sDt, a struct whose p is a Parameter with
  % Value 5 under DataType 'single' (so the object holds a DataType cell over a double Value) and
  % whose sp is sparse, which makes MATLAB write the entry's whole value as a MAT stream. Run:
  %
  %   matlab -nodesktop -batch "cd('<repo>/test/fixtures/sldd-stream-objects'); make_stream_datatype"
  %
  % Writes, in `outDir` (default: this folder):
  %   stream_datatype_binary.sldd  FileFormat 'compressed-binary'
  %   stream_datatype_text.sldd    FileFormat 'uncompressed-text'
  %
  % USER is 'fixture' while a dictionary is written, as make_stream_objects.m has it.
  if nargin < 1 || isempty(outDir)
    outDir = fileparts(mfilename('fullpath'));
  end
  fprintf('VERSION %s\n', version);
  user = getenv('USER');
  p = Simulink.Parameter(5);
  p.DataType = 'single';
  sDt = struct('p', p, 'sp', sparse([0 1]));
  F = {'stream_datatype_binary.sldd', 'compressed-binary'; 'stream_datatype_text.sldd', 'uncompressed-text'};
  for f = 1:size(F, 1)
    ddPath = fullfile(outDir, F{f, 1});
    Simulink.data.dictionary.closeAll('-discard');
    if isfile(ddPath), delete(ddPath); end
    setenv('USER', 'fixture');
    restoreUser = onCleanup(@() setenv('USER', user));
    dd = Simulink.data.dictionary.create(ddPath);
    ds = getSection(dd, 'Design Data');
    addEntry(ds, 'sDt', sDt);
    dd.FileFormat = F{f, 2};
    saveChanges(dd);
    clear ds
    close(dd);
    clear dd
    Simulink.data.dictionary.closeAll('-discard');
    clear restoreUser
    dd = Simulink.data.dictionary.open(ddPath);
    v = getValue(getEntry(getSection(dd, 'Design Data'), 'sDt'));
    fprintf('WROTE %s: sDt.p Value %s %s, DataType %s\n', F{f, 1}, class(v.p.Value), mat2str(v.p.Value), v.p.DataType);
    close(dd);
    clear dd
    Simulink.data.dictionary.closeAll('-discard');
  end
  fprintf('MAKE_STREAM_DATATYPE_DONE\n');
end
