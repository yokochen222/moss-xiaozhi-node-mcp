import { Cam } from 'onvif/promises'

const camera = new Cam({
  hostname: '192.168.31.10',
  port: 80,
  username: 'admin',
  password: 'admin123',
})

camera.connect().then(async () => {
  // console.log('camera connect done');
  console.time('ptzMove')
  await camera.continuousMove({
    x: 0,
    y: 1,
    zoom:0
  });

  // Y 轴 转动到90度需要3500ms 转动1度需要38.888ms
  setTimeout(() => {
    camera.stop().then(() => {
      console.log('done');
    }).catch((error: any) => {
      console.error('stop error', error);
    });
  }, 38.888)
  console.timeEnd('ptzMove')
}).catch((error: any) => {
  console.error('camera connect error', error);
});
