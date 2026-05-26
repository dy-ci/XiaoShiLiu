const { verifyToken } = require('../utils/jwt');
const config = require('../config/config');

/**
 * 从请求头或Cookie中提取token
 * @param {Object} req - Express请求对象
 * @returns {String|null} token
 */
function extractTokenFromHeader(req) {
  // 优先从Authorization头获取（兼容旧客户端）
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // 从Cookie中获取（新的安全方式）
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }

  // 管理员token（从Cookie）
  if (req.cookies && req.cookies.admin_token) {
    return req.cookies.admin_token;
  }

  return null;
}
const { pool } = require('../config/config');
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants');

/**
 * 认证中间件 - 验证JWT token
 */
async function authenticateToken(req, res, next) {
  try {
    const token = extractTokenFromHeader(req);

    // 用于存储解码后的token
    let decoded;

    // 🔍 详细调试日志 - 帮助定位生产环境问题
    if (req.path && (req.path.includes('/admin') || req.path.includes('/me'))) {
      console.log('\n🔐 ===== 认证调试信息 =====');
      console.log('📅 时间:', new Date().toISOString());
      console.log('🌐 请求路径:', req.path || req.originalUrl);
      console.log('📮 请求方法:', req.method);
      console.log('🍪 所有Cookies:', Object.keys(req.cookies || {}));
      
      if (req.cookies?.admin_token) {
        console.log('✅ admin_token Cookie存在');
        console.log('   长度:', req.cookies.admin_token.length);
        console.log('   前50字符:', req.cookies.admin_token.substring(0, 50));
        console.log('   后10字符:', req.cookies.admin_token.slice(-10));
        // 检查是否是有效的JWT格式（3部分用.分隔）
        const parts = req.cookies.admin_token.split('.');
        console.log('   JWT部分数:', parts.length, '(应该是3)');
      } else {
        console.log('❌ admin_token Cookie不存在');
      }
      
      if (req.cookies?.token) {
        console.log('✅ token Cookie存在 (用户Token)');
      } else {
        console.log('⚠️ token Cookie不存在');
      }
      
      console.log('🔑 Authorization头:', req.headers.authorization ? '存在' : '不存在');
      console.log('📤 提取到的最终token:', token ? '存在' : '❌ 不存在！');
      
      if (!token) {
        console.log('💥 问题: 无法从任何来源提取到token\n');
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '访问令牌缺失'
        });
      }

      // 验证token前打印JWT Secret信息
      const jwtSecret = config.jwt.secret;
      console.log('🔐 JWT Secret信息:');
      console.log('   长度:', jwtSecret ? jwtSecret.length : 0);
      console.log('   前20字符:', jwtSecret ? jwtSecret.substring(0, 20) : '(未设置)');
      console.log('   是否为默认值?:', jwtSecret ? jwtSecret.includes('xiaoshiliu_secret_key') : false);
      
      // 验证token
      try {
        decoded = verifyToken(token);
        console.log('✅ Token解码成功:');
        console.log('   类型:', decoded.type);
        console.log('   adminId/userId:', decoded.adminId || decoded.userId);
        console.log('   username:', decoded.username);
        console.log('🔐 ===== 认证调试结束 =====\n');
      } catch (verifyError) {
        console.error('❌ Token验证失败详情:');
        console.error('   错误类型:', verifyError.name);
        console.error('   错误消息:', verifyError.message);
        console.error('   Token前100字符:', token.substring(0, 100));
        if (verifyError.message === 'jwt expired') {
          console.error('   ⚠️ Token已过期！');
        } else if (verifyError.message === 'invalid signature') {
          console.error('   ⚠️ 签名无效 - JWT Secret不匹配！');
          console.error('   💡 可能原因：服务器重启后Secret改变了');
        }
        console.error('🔐 ===== 认证调试结束 =====\n');
        
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '无效的访问令牌'
        });
      }
    } else {
      // 非admin/me路径，简化处理
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
    }

    // 检查是否为管理员token
    if (decoded.type === 'admin') {
      // 管理员token验证 - 需要获取is_super和permissions字段！
      const [adminRows] = await pool.execute(
        'SELECT id, username, is_super, permissions FROM admin WHERE id = ?',
        [decoded.adminId]
      );

      if (adminRows.length === 0) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '管理员不存在'
        });
      }

      // 检查管理员会话是否有效
      const [sessionRows] = await pool.execute(
        'SELECT id FROM admin_sessions WHERE admin_id = ? AND token = ? AND is_active = 1 AND expires_at > NOW()',
        [decoded.adminId, token]
      );

      if (sessionRows.length === 0) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '会话已过期，请重新登录'
        });
      }

      // 获取管理员权限
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

      // 将管理员信息添加到请求对象
      req.user = {
        ...admin,
        type: 'admin',
        adminId: decoded.adminId,
        adminPermissions,
        isSuper
      };
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

      // 检查用户是否存在且活跃
      const [userRows] = await pool.execute(
        'SELECT id, user_id, nickname, avatar, is_active FROM users WHERE id = ? AND is_active = 1',
        [decoded.userId]
      );

      if (userRows.length === 0) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '用户不存在或已被禁用'
        });
      }

      // 检查会话是否有效
      const [sessionRows] = await pool.execute(
        'SELECT id FROM user_sessions WHERE user_id = ? AND token = ? AND is_active = 1 AND expires_at > NOW()',
        [decoded.userId, token]
      );

      if (sessionRows.length === 0) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '会话已过期，请重新登录'
        });
      }

      // 将用户信息添加到请求对象
      req.user = userRows[0];
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
 * 可选认证中间件 - 如果有token则验证，没有则跳过
 */
async function optionalAuth(req, res, next) {
  try {
    const token = extractTokenFromHeader(req);

    if (!token) {
      req.user = null;
      return next();
    }

    // 验证token
    const decoded = verifyToken(token);

    // 检查用户是否存在且活跃
    const [userRows] = await pool.execute(
      'SELECT id, user_id, nickname, avatar, is_active FROM users WHERE id = ? AND is_active = 1',
      [decoded.userId]
    );

    if (userRows.length > 0) {
      // 检查会话是否有效
      const [sessionRows] = await pool.execute(
        'SELECT id FROM user_sessions WHERE user_id = ? AND token = ? AND is_active = 1 AND expires_at > NOW()',
        [decoded.userId, token]
      );

      if (sessionRows.length > 0) {
        req.user = userRows[0];
        req.token = token;
      } else {
        req.user = null;
      }
    } else {
      req.user = null;
    }

    next();
  } catch (error) {
    // 如果token无效，设置user为null继续执行
    req.user = null;
    next();
  }
}

module.exports = {
  authenticateToken,
  optionalAuth
};