declare module 'node-onvif'
declare module 'onvif' {
  export interface CamOptions {
    hostname: string
    port?: number
    username?: string
    password?: string
    useSecure?: boolean
    secureOpts?: Record<string, any>
    useWSSecurity?: boolean
    path?: string
    timeout?: number
    autoconnect?: boolean
    preserveAddress?: boolean
    agent?: any
  }

  export interface Service {
    [key: string]: any
  }

  export class Cam {
    constructor(options: CamOptions, callback?: (error?: Error) => void)
    getServices(callback?: (error: Error | null, services: Service[]) => void): Promise<Service[]>
    [key: string]: any
  }

  export class Discovery {
    [key: string]: any
  }

  // 默认导出包含 Cam 和 Discovery（CommonJS 模块导出方式）
  const onvif: {
    Cam: typeof Cam
    Discovery: typeof Discovery
  }
  
  export default onvif
}