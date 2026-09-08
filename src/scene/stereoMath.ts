export function fitTargetDiam(
  sceneWidth: number,
  sceneHeight: number,
  screenWidth: number,
  screenHeight: number,
  margin = 1.15,
): number {
  const aspect = screenWidth > 0 && screenHeight > 0 ? screenWidth / screenHeight : 16 / 9;
  return Math.max(sceneHeight, sceneWidth / aspect) * margin;
}
