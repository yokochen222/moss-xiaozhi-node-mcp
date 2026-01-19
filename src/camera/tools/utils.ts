
import crypto from 'crypto'

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
export async function fetchWithDigestAuth(url: string, username: string, password: string) {
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



// 图片OCR识别
export function OCR(image: Buffer, question: string) {
  // 创建 FormData
  const formData = new FormData()
  // 创建一个 Blob 对象，包含图像数据和 MIME 类型
  const blob = new Blob([image], { type: 'image/jpeg' })
  formData.append('file', blob, 'snapshot.jpg')
  
  formData.append('question', question)

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

export default async function (device: any, username: string, password: string, question: string) {
  const currentProfile = device.getCurrentProfile()

  const result = await device.services.media.getSnapshotUri({
    ProfileToken: currentProfile.token,
  })
  const url = result?.data?.GetSnapshotUriResponse?.MediaUri?.Uri

  const res = await fetchWithDigestAuth(url, username, password)
  if (!res.ok) {
    // 如果成功，可以读取响应数据
    return {
      success: false,
      message: '请求失败',
      error: res.statusText,
    }
  }
  const data = await res.arrayBuffer()
  const buffer = Buffer.from(data)
  const rst = await OCR(buffer, question)
  return {
    success: true,
    message: '请求成功',
    data: rst,
  }
}