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
  console.log('当前 Profile Token:', currentProfile.token)
  console.log('PTZ Token:', currentProfile.ptz?.token)

  try {
    // 1. 获取设备当前状态
    let currentPosition: any = null
    try {
      const status = await device.services.ptz.getStatus({
        ProfileToken: currentProfile.token
      })
      console.log('当前 PTZ 状态:', JSON.stringify(status?.data, null, 2))
      
      // 提取当前位置
      const ptzStatus = status?.data?.GetStatusResponse?.PTZStatus
      if (ptzStatus?.Position?.PanTilt?.$) {
        currentPosition = {
          pan: parseFloat(ptzStatus.Position.PanTilt.$.x),
          tilt: parseFloat(ptzStatus.Position.PanTilt.$.y),
          zoom: parseFloat(ptzStatus.Position.Zoom?.$?.x || '0')
        }
        console.log('当前位置:', currentPosition)
      }
    } catch (statusError: any) {
      console.log('无法获取状态:', statusError.message)
    }

    // 2. 获取配置选项以了解支持的范围
    try {
      if (currentProfile.ptz?.token) {
        const configOptions = await device.services.ptz.getConfigurationOptions({
          ConfigurationToken: currentProfile.ptz.token
        })
        const options = configOptions?.data?.GetConfigurationOptionsResponse
        console.log('PTZ 配置选项:', JSON.stringify(options, null, 2))
      }
    } catch (configError: any) {
      console.log('无法获取配置选项:', configError.message)
    }

    // 3. 根据当前位置智能选择移动方向
    // 根据 ONVIF 规范，位置通常在 -1 到 1 之间
    // 如果当前位置在边界（如 tilt = -1），就不能再向该方向移动
    
    let translationY = 0.01  // 默认向下移动
    let velocityY = 0.1      // 默认向下速度
    
    if (currentPosition) {
      // 如果 tilt 已经在最小值（-1），改为向上移动
      if (currentPosition.tilt <= -0.99) {
        console.log('⚠️  当前位置 tilt =', currentPosition.tilt, '，已在最小值边界，改为向上移动')
        translationY = -0.01  // 向上移动（负值）
        velocityY = -0.1      // 向上速度
      }
      // 如果 tilt 已经在最大值（1），改为向下移动
      else if (currentPosition.tilt >= 0.99) {
        console.log('⚠️  当前位置 tilt =', currentPosition.tilt, '，已在最大值边界，改为向下移动')
        translationY = 0.01   // 向下移动（正值）
        velocityY = 0.1        // 向下速度
      }
    }

    // 4. 尝试相对移动
    let params = {
      'ProfileToken': currentProfile.token,
      'Translation': {
        'x': 0,           // pan: 不移动
        'y': translationY, // tilt: 根据边界智能选择方向
        'z': 0            // zoom: 不改变
      },
      'Speed': {
        'x': 0.1,
        'y': Math.abs(velocityY),  // 速度使用绝对值
        'z': 0
      }
    };
     
    console.log('执行相对移动，参数:', JSON.stringify(params, null, 2))
    const result = await device.services.ptz.relativeMove(params)
    console.log('✅ 相对移动成功:', JSON.stringify(result?.data, null, 2));
    
  } catch (error: any) {
    console.error('❌ 相对移动失败:', error.message || error);
    
    // 如果相对移动失败，尝试使用 ContinuousMove（连续移动）
    console.log('\n尝试使用连续移动 (ContinuousMove)...');
    try {
      // 获取当前位置以确定移动方向
      let velocityY = 0.1
      try {
        const status = await device.services.ptz.getStatus({
          ProfileToken: currentProfile.token
        })
        const ptzStatus = status?.data?.GetStatusResponse?.PTZStatus
        if (ptzStatus?.Position?.PanTilt?.$) {
          const tilt = parseFloat(ptzStatus.Position.PanTilt.$.y)
          if (tilt <= -0.99) {
            velocityY = -0.1  // 向上移动
          }
        }
      } catch (e) {
        // 忽略错误，使用默认值
      }
      
      // 根据 ONVIF 规范 5.3.3，Timeout 应该是整数（秒数），不是 ISO 8601 格式
      const continuousParams: any = {
        'ProfileToken': currentProfile.token,
        'Velocity': {
          'x': 0,      // pan: 不移动
          'y': velocityY,  // tilt: 根据边界选择方向
          'z': 0       // zoom: 不改变
        }
      }
      
      // Timeout 是可选的，如果提供应该是整数（秒）
      // 如果不提供，需要手动调用 stop
      console.log('连续移动参数:', JSON.stringify(continuousParams, null, 2))
      const continuousResult = await device.services.ptz.continuousMove(continuousParams)
      console.log('✅ 连续移动成功:', JSON.stringify(continuousResult?.data, null, 2));
      
      // 等待 1 秒后停止
      setTimeout(async () => {
        try {
          await device.services.ptz.stop({
            ProfileToken: currentProfile.token,
            PanTilt: true,
            Zoom: false
          })
          console.log('✅ 已停止连续移动')
        } catch (stopError: any) {
          console.error('❌ 停止移动失败:', stopError.message)
        }
      }, 1000)
      
    } catch (continuousError: any) {
      console.error('❌ 连续移动也失败:', continuousError.message || continuousError);
      console.error('\n💡 建议：');
      console.error('1. 检查设备是否支持相对移动操作');
      console.error('2. 检查设备当前 PTZ 位置是否在边界');
      console.error('3. 尝试使用 AbsoluteMove 移动到中间位置');
    }
  }

}).catch((error: any) => {
  console.error('初始化失败:', error);
});