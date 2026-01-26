import { OnvifDevice } from 'node-onvif';

// === 配置 ===
const CAMERA_CONFIG = {
  hostname: '192.168.1.64',
  port: 80,
  username: 'admin',
  password: 'admin123'
};

let camera: typeof OnvifDevice | null = null;
let profileToken: string | null = null;
let panRange: { min: number; max: number } | null = null;
let tiltRange: { min: number; max: number } | null = null;
let usesNormalizedSpace = true; // 默认假设是 [-1,1]

// === 初始化摄像头并获取PTZ范围 ===
export async function initCamera(): Promise<void> {
  try {
    camera = new OnvifDevice(CAMERA_CONFIG);
    await camera.init();

    const profiles = await camera.getStreamProfiles();
    if (profiles.length === 0) {
      throw new Error('No media profiles found');
    }
    profileToken = profiles[0].profileToken;

    // 获取PTZ配置选项以确定范围
    const configOptions = await camera.getPtzConfigurationOptions(profileToken);
    const space = configOptions?.Spaces?.AbsolutePanTiltPositionSpace?.[0];

    if (space && space.XRange && space.YRange) {
      const xMin = space.XRange.Min;
      const xMax = space.XRange.Max;
      const yMin = space.YRange.Min;
      const yMax = space.YRange.Max;

      // 判断是否为归一化空间（常见于很多摄像头）
      if (xMin === -1 && xMax === 1 && yMin === -1 && yMax === 1) {
        usesNormalizedSpace = true;
        // 但我们需要知道物理角度范围！可惜 ONVIF 不一定提供。
        // 所以我们假设一个典型值（可配置）
        panRange = { min: -180, max: 180 };
        tiltRange = { min: -90, max: 90 };
      } else {
        // 设备直接使用物理角度（理想情况）
        usesNormalizedSpace = false;
        panRange = { min: xMin, max: xMax };
        tiltRange = { min: yMin, max: yMax };
      }
    } else {
      // 无法获取范围，回退到归一化 + 假设角度范围
      console.warn('⚠️ PTZ range not available. Assuming normalized space with ±180° pan, ±90° tilt.');
      usesNormalizedSpace = true;
      panRange = { min: -180, max: 180 };
      tiltRange = { min: -90, max: 90 };
    }

    console.log('✅ Camera initialized.');
    console.log('PAN range (physical):', panRange);
    console.log('TILT range (physical):', tiltRange);
    console.log('Uses normalized space:', usesNormalizedSpace);
  } catch (error) {
    console.error('❌ Failed to initialize camera:', error);
    throw error;
  }
}

// === 将物理角度转换为设备坐标 ===
function degToOnvifCoord(deg: number, range: { min: number; max: number }): number {
  if (!usesNormalizedSpace) {
    // 设备直接接受角度
    return Math.max(range.min, Math.min(range.max, deg));
  } else {
    // 映射角度到 [-1, 1]
    const clampedDeg = Math.max(range.min, Math.min(range.max, deg));
    const t = (clampedDeg - range.min) / (range.max - range.min); // [0,1]
    return t * 2 - 1; // [-1,1]
  }
}

// === 执行 AbsoluteMove（使用设备坐标）===
async function doAbsoluteMove(xOnvif: number, yOnvif: number, zoom?: number): Promise<void> {
  if (!camera || !profileToken) {
    throw new Error('Camera not initialized');
  }

  const moveOpts = {
    profileToken,
    position: {
      PanTilt: { x: xOnvif, y: yOnvif }
    } as any
  };

  if (zoom !== undefined) {
    moveOpts.position.Zoom = { x: Math.max(0, Math.min(1, zoom)) };
  }

  await camera.absoluteMovePtz(moveOpts);
}

// === 新增：通过角度控制 ===
export async function moveToPanTilt(panDeg: number, tiltDeg: number, zoom?: number): Promise<void> {
  if (!panRange || !tiltRange) {
    throw new Error('PTZ ranges not initialized. Call initCamera() first.');
  }

  const x = degToOnvifCoord(panDeg, panRange);
  const y = degToOnvifCoord(tiltDeg, tiltRange);

  await doAbsoluteMove(x, y, zoom);
}

// === 辅助：获取当前物理角度（估算）===
export async function getCurrentPanTiltInDegrees() {
  if (!camera || !profileToken || !panRange || !tiltRange) {
    throw new Error('Not initialized');
  }

  const status = await camera.getPtzStatus(profileToken);
  const pos = status.Position;
  const xNorm = pos?.PanTilt?.x ?? 0;
  const yNorm = pos?.PanTilt?.y ?? 0;

  if (!usesNormalizedSpace) {
    return { pan: xNorm, tilt: yNorm };
  } else {
    // 从 [-1,1] 反推角度
    const pan = panRange.min + ((xNorm + 1) / 2) * (panRange.max - panRange.min);
    const tilt = tiltRange.min + ((yNorm + 1) / 2) * (tiltRange.max - tiltRange.min);
    return { pan, tilt };
  }
}

// === 兼容旧的方向控制（可选保留）===
const MOVE_STEP_DEG = 10; // 每次移动10度

export async function moveUp(): Promise<void> {
  const { tilt } = await getCurrentPanTiltInDegrees();
  await moveToPanTilt(0, tilt - MOVE_STEP_DEG);
}

export async function moveDown(): Promise<void> {
  const { tilt } = await getCurrentPanTiltInDegrees();
  await moveToPanTilt(0, tilt + MOVE_STEP_DEG);
}

export async function moveLeft(): Promise<void> {
  const { pan } = await getCurrentPanTiltInDegrees();
  await moveToPanTilt(pan - MOVE_STEP_DEG, 0);
}

export async function moveRight(): Promise<void> {
  const { pan } = await getCurrentPanTiltInDegrees();
  await moveToPanTilt(pan + MOVE_STEP_DEG, 0);
}

export async function stopPtz(): Promise<void> {
  if (camera && profileToken) {
    await camera.stopPtz(profileToken);
  }
}