export interface ComposerTextareaMetrics {
  height: number;
  maxHeight: number;
  scrollable: boolean;
}

export function computeComposerTextareaMetrics(params: {
  scrollHeight: number;
  viewportHeight: number;
  compact: boolean;
}): ComposerTextareaMetrics {
  const minHeight = params.compact ? 20 : 24;
  const safeViewport =
    Number.isFinite(params.viewportHeight) && params.viewportHeight > 0
      ? params.viewportHeight
      : 800;
  const maxHeight = params.compact
    ? Math.max(120, Math.min(240, Math.round(safeViewport * 0.36)))
    : Math.max(140, Math.min(340, Math.round(safeViewport * 0.42)));
  const desired = Math.max(minHeight, Math.ceil(params.scrollHeight));
  const scrollable = desired > maxHeight;
  const height = Math.min(desired, maxHeight);
  return { height, maxHeight, scrollable };
}
