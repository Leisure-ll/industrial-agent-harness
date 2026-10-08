// Electron uses logical pixels and workArea already excludes the dock/taskbar.
function windowBounds(area, previous) {
  const minWidth = Math.min(640, area.width);
  const minHeight = Math.min(480, area.height);
  const width = Math.min(area.width, Math.max(minWidth, previous?.width ?? 1440));
  const height = Math.min(area.height, Math.max(minHeight, previous?.height ?? 900));
  return {
    width,
    height,
    minWidth,
    minHeight,
    x: Math.round(
      Math.max(
        area.x,
        Math.min(area.x + area.width - width, previous?.x ?? area.x + (area.width - width) / 2),
      ),
    ),
    y: Math.round(
      Math.max(
        area.y,
        Math.min(area.y + area.height - height, previous?.y ?? area.y + (area.height - height) / 2),
      ),
    ),
  };
}
module.exports = { windowBounds };
