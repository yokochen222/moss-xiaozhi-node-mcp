import onvif from 'node-onvif'
import OCR from './utils'


const username = 'admin'
const password = 'admin123'
let device = new onvif.OnvifDevice({
  xaddr: 'http://192.168.31.10:80/onvif/device_service',
  user : username,
  pass : password
})

device.init().then(async () => {
  const currentProfile = device.getCurrentProfile()
  // // # 摄像头水平转 360° 所需时间（单位：秒），请根据实际调整
  // const FULL_ROTATION_TIME = 5
  // const angle = 180
  // const speed = Math.abs(angle) / 360.0 * FULL_ROTATION_TIME
  // const directions = {
  //   'up':           {'x': 0.0,     'y': speed},
  //   'down':           {'x': 0.0,     'y': -speed},
  //   'left':         {'x': -speed,  'y': 0.0},
  //   'right':        {'x': speed,   'y': 0.0},
  // }
  // console.log(directions)
  // const direction = directions['up']
  device.ptzMove({
    speed: {
      x: 0,
      y: -1,
      z: 0,
    },
    timeout: 60
  }).then(() => {
    // X 1000ms * 6转动到限位位置
    // Y 500ms * 4转动到限位位置
    setTimeout(() => {
      device.ptzStop().then(() => {
        console.log('Succeeded to stop.');
      })
    }, 500);
  }).catch((error: any) => {
    console.error('移动失败', error);
  });
}).catch((error: any) => {
  console.error('初始化失败:', error);
});