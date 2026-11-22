import { DESIGN_H, DESIGN_W, SOCKETS, SocketsType } from '../theme/layout';

export interface DisplacementResult {
  /** The target position on the screen in device pixels */
  x: number;
  y: number;
  /** Horizontal distance moved from the original design location */
  dx: number;
  /** Vertical distance moved from the original design location */
  dy: number;
  /** Straight-line Euclidean distance moved */
  totalDistance: number;
  /**
   * The scale multiplier ("how many times" the base coordinate is multiplied).
   * E.g., 1.25x means the layout is scaled up 1.25 times.
   */
  scaleMultiplier: number;
  /**
   * Ratio of displacement relative to design size.
   */
  displacementFactor: number;
}

export interface ResponsiveFrameMetrics {
  /** Screen or container width in pixels */
  width: number;
  /** Screen or container height in pixels */
  height: number;
  /** Ratio of current width to reference design width (923px) */
  widthRatio: number;
  /** Exact uniform scale factor applied to fit the phone display */
  scale: number;
  /** Horizontal centering offset in device pixels */
  offsetX: number;
  /** Vertical centering offset in device pixels */
  offsetY: number;
  /** Actual rendered width of the controller chassis */
  renderedWidth: number;
  /** Actual rendered height of the controller chassis */
  renderedHeight: number;
  /**
   * Function to move any design coordinate from its current location
   * to the exact right location on this screen width.
   */
  moveToRightLocation: (currentX: number, currentY: number) => DisplacementResult;
}

export interface ButtonDisplacementInfo {
  buttonId: string;
  currentLocation: { x: number; y: number };
  rightLocation: { x: number; y: number };
  displacement: { dx: number; dy: number; totalDistance: number };
  scaleMultiplier: number;
}

/**
 * Calculates responsive metrics and displacement functions based on the phone's width.
 *
 * "knows the width and then decides how many times it would move from its current location
 * to the right location."
 *
 * @param screenWidth - The current phone / screen width in pixels.
 * @param screenHeight - Optional screen height in pixels. If omitted, uses standard controller aspect ratio.
 * @returns ResponsiveFrameMetrics with calculation functions.
 */
export function calculateResponsiveDisplacement(
  screenWidth: number,
  screenHeight?: number
): ResponsiveFrameMetrics {
  const width = Math.max(1, screenWidth);
  // If height is not provided or estimated, infer from the controller frame aspect ratio (923:426 ~ 2.1667)
  const effectiveHeight =
    screenHeight && screenHeight > 0
      ? screenHeight
      : (width * DESIGN_H) / DESIGN_W;

  // Width ratio: How many times wider the current screen is compared to the base design (923px)
  const widthRatio = width / DESIGN_W;

  // Determine uniform scale so controller fits cleanly within the bounds
  const scale = Math.min(width / DESIGN_W, effectiveHeight / DESIGN_H);

  const renderedWidth = DESIGN_W * scale;
  const renderedHeight = DESIGN_H * scale;

  // Centering offsets
  const offsetX = (width - renderedWidth) / 2;
  const offsetY = (effectiveHeight - renderedHeight) / 2;

  /**
   * Function that takes a button's current design location (currentX, currentY)
   * and decides how much and how many times it moves to the right location.
   */
  const moveToRightLocation = (currentX: number, currentY: number): DisplacementResult => {
    // Right location in device pixels
    const rightX = currentX * scale + offsetX;
    const rightY = currentY * scale + offsetY;

    // Displacement from base location
    const dx = rightX - currentX;
    const dy = rightY - currentY;
    const totalDistance = Math.hypot(dx, dy);

    // Multiplier: how many times current location is multiplied to reach right location
    const scaleMultiplier = scale;
    const displacementFactor = currentX !== 0 ? Math.abs(dx / currentX) : 0;

    return {
      x: rightX,
      y: rightY,
      dx,
      dy,
      totalDistance,
      scaleMultiplier,
      displacementFactor,
    };
  };

  return {
    width,
    height: effectiveHeight,
    widthRatio,
    scale,
    offsetX,
    offsetY,
    renderedWidth,
    renderedHeight,
    moveToRightLocation,
  };
}

/**
 * Helper to compute the exact right location and movement for a specific controller button
 * given the phone width.
 *
 * @param socketKey - Socket identifier (e.g. 'faceA', 'faceY', 'leftStick', 'LT', etc.)
 * @param screenWidth - The current phone width in pixels.
 * @param screenHeight - Optional screen height in pixels.
 */
export function getButtonDisplacement(
  socketKey: keyof SocketsType,
  screenWidth: number,
  screenHeight?: number
): ButtonDisplacementInfo {
  const metrics = calculateResponsiveDisplacement(screenWidth, screenHeight);
  const socket = SOCKETS[socketKey];

  // Base/current coordinate
  let curX = 0;
  let curY = 0;

  if ('cx' in socket && 'cy' in socket) {
    curX = (socket as { cx: number; cy: number }).cx;
    curY = (socket as { cx: number; cy: number }).cy;
  } else if ('x' in socket && 'y' in socket) {
    curX = (socket as { x: number; y: number }).x;
    curY = (socket as { x: number; y: number }).y;
  }

  const result = metrics.moveToRightLocation(curX, curY);

  return {
    buttonId: socketKey as string,
    currentLocation: { x: curX, y: curY },
    rightLocation: { x: result.x, y: result.y },
    displacement: {
      dx: result.dx,
      dy: result.dy,
      totalDistance: result.totalDistance,
    },
    scaleMultiplier: result.scaleMultiplier,
  };
}

/**
 * Calculates right locations and movement distances for ALL controller buttons
 * on any given phone width.
 *
 * @param screenWidth - Current phone width in pixels.
 * @param screenHeight - Optional phone height in pixels.
 */
export function calculateAllButtonLocations(
  screenWidth: number,
  screenHeight?: number
): Record<keyof SocketsType, ButtonDisplacementInfo> {
  const keys = Object.keys(SOCKETS) as (keyof SocketsType)[];
  const results = {} as Record<keyof SocketsType, ButtonDisplacementInfo>;

  for (const k of keys) {
    results[k] = getButtonDisplacement(k, screenWidth, screenHeight);
  }

  return results;
}
