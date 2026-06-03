const { verifyToken } = require('../utils/jwt');
const config = require('../config/config');
const { getDB } = require('../utils/db');
const { getCache, setCache, delCache } = require('../utils/redis');
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants');

// 会话缓存TTL（秒）- 与JWT过期时间一致
const SESSION_CACHE_TTL = 7 * 24 * 60 * 60; // 7天

/**
 * 从请求头或Cookie中提取token
 */
function extractTokenFromHeader(req) {
  const isAdminPath = req.path && (req.path.startsWith('/admin') || req.path.startsWith('/api/admin'))
  
  if (isAdminPath && req.cookies && req.cookies.admin_token) {
    return req.cookies.admin_token;
  }
  
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }

  if (req.cookies && req.cookies.admin_token) {
    return req.cookies.admin_token;
  }

  return null;
}

/**
 * 认证中间件 - 验证JWT token（带Redis会话缓存）
 * Redis缓存命中时跳过数据库查询，大幅降低DB压力
 */
async function authenticateToken(req, res, next) {
  try {
    const token = extractTokenFromHeader(req);
    const db = getDB();

    let decoded;

    if (!token) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '访问令牌缺失'
      });
    }

    try {
      decoded = verifyToken(token);
    } catch (verifyError) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '无效的访问令牌'
      });
    }

    // 检查是否为管理员token
    if (decoded && (decoded.type === 'admin' || decoded.adminId)) {
      // 尝试从Redis缓存获取管理员会话
      const cacheKey = `session:admin:${token}`;
      const cached = await getCache(cacheKey);
      
      if (cached) {
        req.user = cached;
        req.token = token;
        return next();
      }

      // 缓存未命中，查询数据库
      const adminRows = await db('admin')
        .where({ id: decoded.adminId })
        .select('id', 'username', 'is_super', 'permissions');

      if (adminRows.length === 0) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '管理员不存在'
        });
      }

      const sessionRows = await db('admin_sessions')
        .where({
          admin_id: decoded.adminId,
          token: token,
          is_active: 1
        })
        .where('expires_at', '>', db.fn.now())
        .select('id');

      if (sessionRows.length === 0) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '会话已过期，请重新登录'
        });
      }

      const admin = adminRows[0];
      let adminPermissions = [];
      let isSuper = admin.is_super === 1;
      if (admin.permissions) {
        try {
          adminPermissions = typeof admin.permissions === 'string' 
            ? JSON.parse(admin.permissions) 
            : admin.permissions;
        } catch (e) {
          adminPermissions = [];
        }
      }

      const userInfo = {
        ...admin,
        type: 'admin',
        adminId: decoded.adminId,
        adminPermissions,
        isSuper
      };

      // 写入Redis缓存
      await setCache(cacheKey, userInfo, SESSION_CACHE_TTL);

      req.user = userInfo;
      req.token = token;

      return next();
    } else {
      // 普通用户token验证
      if (!decoded.userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '无效的访问令牌'
        });
      }

      // 尝试从Redis缓存获取用户会话
      const cacheKey = `session:user:${token}`;
      const cached = await getCache(cacheKey);
      
      if (cached) {
        req.user = cached;
        req.token = token;
        return next();
      }

      // 缓存未命中，查询数据库
      const userRows = await db('users')
        .where({ id: decoded.userId, is_active: 1 })
        .select('id', 'user_id', 'nickname', 'avatar', 'is_active');

      if (userRows.length === 0) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '用户不存在或已被禁用'
        });
      }

      const sessionRows = await db('user_sessions')
        .where({
          user_id: decoded.userId,
          token: token,
          is_active: 1
        })
        .where('expires_at', '>', db.fn.now())
        .select('id');

      if (sessionRows.length === 0) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '会话已过期，请重新登录'
        });
      }

      const userInfo = userRows[0];

      // 写入Redis缓存
      await setCache(cacheKey, userInfo, SESSION_CACHE_TTL);

      req.user = userInfo;
      req.token = token;

      return next();
    }
  } catch (error) {
    console.error('Token验证失败:', error);
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      code: RESPONSE_CODES.UNAUTHORIZED,
      message: '无效的访问令牌'
    });
  }
}

/**
 * 可选认证中间件 - 如果有token则验证，没有则跳过（带Redis缓存）
 */
async function optionalAuth(req, res, next) {
  try {
    const token = extractTokenFromHeader(req);

    if (!token) {
      req.user = null;
      return next();
    }

    // 验证token
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (e) {
      req.user = null;
      return next();
    }

    // 尝试从Redis缓存获取
    const cacheKey = `session:user:${token}`;
    const cached = await getCache(cacheKey);
    
    if (cached) {
      req.user = cached;
      req.token = token;
      return next();
    }

    // 缓存未命中，查询数据库
    const db = getDB();
    const userRows = await db('users')
      .where({ id: decoded.userId, is_active: 1 })
      .select('id', 'user_id', 'nickname', 'avatar', 'is_active');

    if (userRows.length > 0) {
      const sessionRows = await db('user_sessions')
        .where({
          user_id: decoded.userId,
          token: token,
          is_active: 1
        })
        .where('expires_at', '>', db.fn.now())
        .select('id');

      if (sessionRows.length > 0) {
        const userInfo = userRows[0];
        // 写入Redis缓存
        await setCache(cacheKey, userInfo, SESSION_CACHE_TTL);
        req.user = userInfo;
        req.token = token;
      } else {
        req.user = null;
      }
    } else {
      req.user = null;
    }

    next();
  } catch (error) {
    req.user = null;
    next();
  }
}

module.exports = {
  authenticateToken,
  optionalAuth
};
