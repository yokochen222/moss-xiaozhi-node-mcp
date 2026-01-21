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
  // console.time('ptzMove')
  // device.ptzMove({
  //   speed: {
  //     x: 0,
  //     y: 1,
  //     z: 0,
  //   },
  //   timeout: 4
  // }).then(() => {
  //   // setTimeout(() => {
  //   //   device.ptzStop().then(() => {
  //   //     console.log('Succeeded to stop.');
  //   //   })
  //   // }, 1000);
  //   console.log('ptzMove done');
  // }).catch((error: any) => {
  //   console.error('ptzMove error', error);
  // });
  // await device.services.ptz.continuousMove({
  //   ProfileToken: currentProfile.token,
  //   Velocity: {x: 0, y: 1, z: 0},
  // })
  // setTimeout(() => {
  //   device.ptzStop().then(() => {
  //     console.log('Succeeded to stop.');
  //   })
  // }, 38.888)

  moveY(90, 1)

}).catch((error: any) => {
  console.error('初始化失败:', error);
});


/**
 * Y 轴转动
 * @param degree 转动角度
 * @param token 设备token
 * @param direction 转动方向 1: 向上 -1: 向下
*/
async function moveY(degree: number, direction: number) {
  let _d = degree
  // moveOneDegree(direction).then(() => {
  //   if (_d) {
  //     moveOneDegree(direction)
  //   }
  // })
  console.time('moveY')
  const move = async () => {
    _d--
    await moveOneDegree(direction)
    if (_d) {
      await move()
    }
  }
  await move()
  console.timeEnd('moveY')
}
/**
 * 控制Y轴电机转动1度
 * @param direction 方向
*/
async function moveOneDegree(direction: number) {
  return new Promise(async(resolve, reject) => {
    const currentProfile = device.getCurrentProfile()
    await device.services.ptz.continuousMove({
      ProfileToken: currentProfile.token,
      Velocity: {x: 0, y: direction, z: 0},
    })
    console.log('acee')
    setTimeout(() => {
      device.ptzStop()
      resolve(true)
    }, 38.888)
  })
}
