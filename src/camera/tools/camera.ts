import onvif from 'onvif'
import crypto from 'crypto'

const username = 'admin'
const password = 'admin123'

// 解析 Digest 挑战信息
function parseDigestChallenge(wwwAuthenticate: string) {
  const params: Record<string, string> = {}
  const regex = /(\w+)="([^"]+)"/g
  let match
  while ((match = regex.exec(wwwAuthenticate)) !== null) {
    params[match[1]] = match[2]
  }
  return params
}

// 生成 Digest 认证响应
function generateDigestAuth(
  username: string,
  password: string,
  method: string,
  uri: string,
  realm: string,
  nonce: string,
  qop?: string
): string {
  // HA1 = MD5(username:realm:password)
  const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex')
  
  // HA2 = MD5(method:uri)
  const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex')
  
  let response: string
  if (qop) {
    // 使用 qop 时生成 clientNonce 和 nc
    const clientNonce = crypto.randomBytes(8).toString('hex')
    const nc = '00000001'
    // response = MD5(HA1:nonce:nc:clientNonce:qop:HA2)
    response = crypto.createHash('md5')
      .update(`${ha1}:${nonce}:${nc}:${clientNonce}:${qop}:${ha2}`)
      .digest('hex')
    
    return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop="${qop}", nc=${nc}, cnonce="${clientNonce}", response="${response}"`
  } else {
    // 不使用 qop 时
    // response = MD5(HA1:nonce:HA2)
    response = crypto.createHash('md5')
      .update(`${ha1}:${nonce}:${ha2}`)
      .digest('hex')
    
    return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`
  }
}

// 使用 Digest 认证获取快照
async function fetchWithDigestAuth(url: string, username: string, password: string) {
  // 第一次请求，不带认证，获取挑战信息
  const firstResponse = await fetch(url)
  
  if (firstResponse.status === 401) {
    const wwwAuthenticate = firstResponse.headers.get('www-authenticate')
    if (wwwAuthenticate && wwwAuthenticate.startsWith('Digest')) {
      // 解析挑战信息
      const challenge = parseDigestChallenge(wwwAuthenticate)
      const realm = challenge.realm || ''
      const nonce = challenge.nonce || ''
      const qop = challenge.qop || ''
      
      // 从 URL 中提取路径部分
      const urlObj = new URL(url)
      const uri = urlObj.pathname + urlObj.search
      
      // 生成 Digest 认证头
      const authHeader = generateDigestAuth(username, password, 'GET', uri, realm, nonce, qop || undefined)
      
      // 使用 Digest 认证重新请求
      const secondResponse = await fetch(url, {
        headers: {
          'Authorization': authHeader
        }
      })
      
      return secondResponse
    }
  }
  
  return firstResponse
}

// 14:5D:34:F4:A5:E0
const camera = new onvif.Cam({
  hostname: '192.168.31.223',
  port: 80,
  username,
  password,
}, () => {

  // camera.getSnapshotUri((error: any, snapshotUri: {
  //   uri: string
  // }) => {
  //   if (error) {
  //     console.error('error', error)
  //   } else {
  //     console.log('snapshotUri', snapshotUri)
  //     // 移除URL中的端口号（如果有）并清理URL
  //     const url = snapshotUri.uri.replace(':80', '')
      
  //     // 使用 Digest 认证获取快照
  //     fetchWithDigestAuth(url, username, password)
  //       .then((res: any) => {
  //         console.log('res status:', res.status, res.statusText)
  //         if (res.ok) {
  //           // 如果成功，可以读取响应数据
  //           return res.arrayBuffer()
  //         } else {
  //           console.error('请求失败:', res.status, res.statusText)
  //         }
  //       })
  //       .then(async (data: any) => {
  //         if (data) {
  //           // 将 ArrayBuffer 转换为 Buffer
  //           const buffer = Buffer.from(data)
  //           OCR(buffer).then((res: any) => {
  //             console.log('res', res)
  //           }).catch((error: any) => {
  //             console.error('error', error)
  //           })
  //         }
  //       })
  //       .catch((error: any) => {
  //         console.error('error', error)
  //       })
  //   }
  // })

  // camera.getStatus((error: any, status: {
  //   position: {
  //     x: number
  //     y: number,
  //     zoom: number
  //   },
  //   moveStatus: {
  //     panTilt: string
  //     zoom: string
  //   },
  //   error?: string
  //   utcTime: string
  // }) => {
  //   if (error) {
  //     console.error('error', error)
  //   } else {
  //     console.log('status', status)
  //   }
  // })

  // console.log('camera activeSource:', camera.activeSource)
  // camera.getNodes((error: any, nodes: any) => {
  //   if (error) {
  //     console.error('error', error)
  //   } else {
  //     console.log('nodes', nodes.node_0001.supportedPTZSpaces)
  //   }
  // })

  // camera.getProfiles((error: any, profiles: any) => {
  //   if (error) {
  //     console.error('error', error)
  //     return
  //   } 
  //   let ptzProfile: any = null;

  //   profiles.forEach((profile: any, index: number) => {
  //     console.log('profile', profile)
  //   });
  // })

  camera.continuousMove({
    x: 0.1,
    y: 0.1,
    profileToken: camera.activeSource.ptz.token,
  }, (error: any, result: any) => {
    if (error) {
      console.error('error', error)
    } else {
      console.log('result', result)
    }
  })
})


function OCR(image: Buffer) {
  // 创建 FormData
  const formData = new FormData()
  // 创建一个 Blob 对象，包含图像数据和 MIME 类型
  const blob = new Blob([image], { type: 'image/jpeg' })
  formData.append('file', blob, 'snapshot.jpg')
  
  formData.append('question', '你看见了什么')

  return fetch('https://api.xiaozhi.me/vision/explain', {
    method: 'POST',
    body: formData,
    headers: {
      "Authorization": "Bearer test-token",
      "Device-Id": "5c:1b:f4:7e:b8:58",
      "Client-Id": "5c:1b:f4:7e:b8:58",
    }
  }).then(async (res: any) => {
    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`HTTP error! status: ${res.status}, message: ${errorText}`)
    }
    return res.json()
  }).catch((error: any) => {
    console.error('OCR error:', error)
    throw error
  })
}