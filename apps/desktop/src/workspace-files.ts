import type { WorkspaceFile } from './components/WorkspaceFileView';

export function openWorkspaceFile(
  current: WorkspaceFile[],
  next: WorkspaceFile,
  pin = false,
  forceReload = false,
) {
  const previous = current.find(file => file.path === next.path);
  const reusable =
    !forceReload &&
    previous?.artifact &&
    next.artifact &&
    previous.artifact.sha256 === next.artifact.sha256;
  const preview = previous ? Boolean(previous.preview && !pin) : !pin;
  const selected: WorkspaceFile =
    reusable && previous.preview === preview
      ? previous
      : { ...(reusable ? previous : next), preview };
  if (previous)
    return { files: current.map(file => (file.path === next.path ? selected : file)), selected };
  const previewIndex = current.findIndex(file => file.preview);
  const files =
    !pin && previewIndex !== -1
      ? current.map((file, index) => (index === previewIndex ? selected : file))
      : [...current, selected];
  return { files, selected };
}
