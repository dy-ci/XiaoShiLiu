/**
 * 悦社动态社区 - 应用配置文件
 * 集中管理所有配置项
 * 
 * @author ZTMYO
 * @github https://github.com/ZTMYO
 * @description Express应用的核心配置管理
 * @version v1.3.2
 */

const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');

// 加载环境变量
const envPath = path.resolve(__dirname, '..', '.env');

try {
  const fs = require('fs');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    // 检查是否包含JWT_SECRET
    if (envContent.includes('JWT_SECRET')) {
      const jwtMatch = envContent.match(/JWT_SECRET=(.+)/);
      if (jwtMatch) {
        console.log('JWT_SECRET已设置，长度:', jwtMatch[1].length);
      }
    } else {
      console.log('警告: .env文件中不包含JWT_SECRET');
    }
  } else {
    console.log('警告: .env文件不存在');
  }
} catch (err) {
  console.error('读取.env文件失败:', err.message);
}

require('dotenv').config({ path: envPath });


const config = {
  // 服务器配置
  server: {
    port: process.env.PORT || 3001,
    env: process.env.NODE_ENV || 'development'
  },

  // CORS配置
  cors: {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()) : ['http://localhost:5173', 'http://localhost:3001']
  },

  // JWT配置
  jwt: (() => {
    const secret = process.env.JWT_SECRET;
    
    if (!secret) {
      console.error('警告: JWT_SECRET 环境变量未设置，将使用随机生成的密钥（每次重启都会改变）');
      console.error('请在 .env 文件中设置固定的 JWT_SECRET');
    }
    
    return {
      secret: secret || crypto.randomBytes(32).toString('hex'),
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d'
    };
  })(),

  // 数据库配置
  database: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'yuecommunity',
    port: process.env.DB_PORT || 3306,
    charset: 'utf8mb4',
    timezone: '+08:00'
  },

  // 上传配置
  upload: {
    // 图片上传配置
    image: {
      maxSize: process.env.IMAGE_MAX_SIZE || '10mb',
      allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      // 图片上传策略配置
      strategy: process.env.IMAGE_UPLOAD_STRATEGY || 'imagehost', // 'local', 'imagehost', 'r2' 或 's3'
      // 本地存储配置
      local: {
        uploadDir: process.env.IMAGE_LOCAL_UPLOAD_DIR || 'uploads/images',
        baseUrl: process.env.LOCAL_BASE_URL || 'http://localhost:3001'
      },
      // 第三方图床配置
      imagehost: {
        apiUrl: process.env.IMAGEHOST_API_URL || 'https://api.xinyew.cn/api/360tc',
        timeout: parseInt(process.env.IMAGEHOST_TIMEOUT) || 60000
      },
      // Cloudflare R2配置（S3兼容）
      r2: {
        accountId: process.env.R2_ACCOUNT_ID,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        bucketName: process.env.R2_BUCKET_NAME,
        endpoint: process.env.R2_ENDPOINT,
        publicUrl: process.env.R2_PUBLIC_URL, // 可选：自定义域名
        region: process.env.R2_REGION || 'auto'
      },
      // 通用 S3 兼容存储配置（阿里云OSS、腾讯云COS、MinIO等）
      s3: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        bucketName: process.env.S3_BUCKET_NAME,
        endpoint: process.env.S3_ENDPOINT,         // 例如: https://oss-cn-hangzhou.aliyuncs.com
        region: process.env.S3_REGION || 'us-east-1',
        publicUrl: process.env.S3_PUBLIC_URL,     // 例如: https://bucket.oss-cn-hangzhou.aliyuncs.com
        pathStyle: process.env.S3_PATH_STYLE === 'true',  // MinIO 需要设为 true
        prefix: process.env.S3_IMAGE_PREFIX || 'images/'  // 文件前缀路径
      }
    },
    // 视频上传配置
    video: {
      maxSize: process.env.VIDEO_MAX_SIZE || '100mb',
      allowedTypes: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/webm'],
      // 视频上传策略配置
      strategy: process.env.VIDEO_UPLOAD_STRATEGY || 'local', // 'local', 'r2' 或 's3'
      // 本地存储配置
      local: {
        uploadDir: process.env.VIDEO_LOCAL_UPLOAD_DIR || 'uploads/videos',
        baseUrl: process.env.LOCAL_BASE_URL || 'http://localhost:3001'
      },
      // Cloudflare R2配置（S3兼容）
      r2: {
        accountId: process.env.R2_ACCOUNT_ID,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        bucketName: process.env.R2_BUCKET_NAME,
        endpoint: process.env.R2_ENDPOINT,
        publicUrl: process.env.R2_PUBLIC_URL, // 可选：自定义域名
        region: process.env.R2_REGION || 'auto'
      },
      // 通用 S3 兼容存储配置
      s3: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        bucketName: process.env.S3_BUCKET_NAME,
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION || 'us-east-1',
        publicUrl: process.env.S3_PUBLIC_URL,
        pathStyle: process.env.S3_PATH_STYLE === 'true',
        prefix: process.env.S3_VIDEO_PREFIX || 'videos/'
      }
    }
  },

  // API配置
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3001',
    timeout: 30000
  },

  // 分页配置
  pagination: {
    defaultLimit: 20,
    maxLimit: 100
  },

  // 缓存配置
  cache: {
    ttl: 300 // 5分钟
  },

  // 邮件服务配置
  email: {
    // 是否启用邮件功能
    enabled: process.env.EMAIL_ENABLED === 'true', // 默认不启用
    // SMTP服务器配置
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.qq.com',
      port: parseInt(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE === 'false' ? false : true, // 默认使用SSL
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASSWORD || ''
      }
    },
    // 发件人配置
    from: {
      email: process.env.EMAIL_FROM || '',
      name: process.env.EMAIL_FROM_NAME || '悦社动态社区'
    }
  },

  // IP属地查询配置
  ipLocation: {
    primaryApi: process.env.IP_LOCATION_PRIMARY_API || 'https://ip9.com.cn/get',
    backupApi: process.env.IP_LOCATION_BACKUP_API || 'https://api.pearktrue.cn/api/ip/details',
    primaryTimeout: parseInt(process.env.IP_LOCATION_PRIMARY_TIMEOUT) || 10000,
    backupTimeout: parseInt(process.env.IP_LOCATION_BACKUP_TIMEOUT) || 5000
  },

  // Logto 配置
  logto: {
    endpoint: process.env.LOGTO_ENDPOINT || 'https://logto.example.com',
    appId: process.env.LOGTO_APP_ID || '',
    appSecret: process.env.LOGTO_APP_SECRET || '',
    redirectUri: process.env.LOGTO_REDIRECT_URI || 'http://localhost:5173/callback',
    adminRedirectUri: process.env.LOGTO_ADMIN_REDIRECT_URI || 'http://localhost:5173/admin/callback',
    postLogoutRedirectUri: process.env.LOGTO_POST_LOGOUT_REDIRECT_URI || 'http://localhost:5173',
    cookieSecret: process.env.LOGTO_COOKIE_SECRET || crypto.randomBytes(32).toString('hex')
  }
};

// 数据库连接池配置
const dbConfig = {
  ...config.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// 创建连接池
const pool = mysql.createPool(dbConfig);

module.exports = {
  ...config,
  pool
};