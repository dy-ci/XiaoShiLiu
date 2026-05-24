const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants');
const { pool } = require('../config/config');
const config = require('../config/config');
const { generateAccessToken } = require('../utils/jwt');
const { getIPLocation, getRealIP } = require('../utils/ipLocation');

// 检查数据库中是否存在 logto_id 列
async function checkLogtoColumnExists() {
  try {
    const [columns] = await pool.execute(
      "SHOW COLUMNS FROM users LIKE 'logto_id'"
    );
    return columns.length > 0;
  } catch (error) {
    console.warn('检查 logto_id 列失败:', error.message);
    return false;
  }
}

// 简单的 Logto 登录 URL 生成
router.get('/sign-in', async (req, res) => {
  try {
    if (!config.logto.endpoint || !config.logto.appId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.ERROR,
        message: 'Logto 配置未完成，请检查环境变量配置'
      });
    }

    const redirectUri = encodeURIComponent(config.logto.redirectUri);
    const state = Math.random().toString(36).substring(2, 15);
    
    const signInUrl = `${config.logto.endpoint}/oidc/auth?` +
      `client_id=${config.logto.appId}` +
      `&redirect_uri=${redirectUri}` +
      `&response_type=code` +
      `&scope=openid profile email` +
      `&state=${state}`;
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取登录地址成功',
      data: {
        signInUrl,
        state
      }
    });
  } catch (error) {
    console.error('获取登录地址失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '获取登录地址失败'
    });
  }
});

// 有 logto_id 列的处理方式
async function handleLogtoWithColumn(req, code) {
  try {
    const mockLogtoUserId = 'logto_' + Date.now();
    let [users] = await pool.execute(
      'SELECT * FROM users WHERE logto_id = ?',
      [mockLogtoUserId]
    );
    
    let user;
    
    if (users.length === 0) {
      // 创建新用户
      const userIP = getRealIP(req);
      let ipLocation = '未知';
      try {
        ipLocation = await getIPLocation(userIP);
      } catch (error) {
        console.log('IP 属地查询失败，使用默认值:', error.message);
      }
      
      const userId = 'logto_' + Date.now().toString(36);
      const [result] = await pool.execute(
        'INSERT INTO users (logto_id, user_id, nickname, avatar, bio, email, location, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [
          mockLogtoUserId,
          userId.slice(0, 15),
          'Logto 用户',
          '',
          '',
          '',
          ipLocation
        ]
      );
      
      const [newUsers] = await pool.execute(
        'SELECT * FROM users WHERE id = ?',
        [result.insertId]
      );
      user = newUsers[0];
    } else {
      // 更新用户信息
      user = users[0];
      await pool.execute(
        'UPDATE users SET last_login_at = NOW() WHERE id = ?',
        [user.id]
      );
    }
    
    return user;
  } catch (error) {
    console.error('处理有 logto_id 列登录失败:', error);
    return null;
  }
}

// 没有 logto_id 列的处理方式（兼容旧版本）
async function handleLogtoWithoutColumn(req) {
  try {
    // 创建临时用户或使用已有的用户
    // 这里简化处理，直接用常规用户
    const userIP = getRealIP(req);
    let ipLocation = '未知';
    try {
      ipLocation = await getIPLocation(userIP);
    } catch (error) {
      console.log('IP 属地查询失败，使用默认值:', error.message);
    }
    
    const userId = 'logto_' + Date.now().toString(36);
    const [result] = await pool.execute(
      'INSERT INTO users (user_id, nickname, avatar, bio, email, location, last_login_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [
        userId.slice(0, 15),
        'Logto 用户',
        '',
        '',
        '',
        ipLocation
      ]
    );
    
    const [newUsers] = await pool.execute(
      'SELECT * FROM users WHERE id = ?',
      [result.insertId]
    );
    
    return newUsers[0];
  } catch (error) {
    console.error('无 logto_id 列登录失败:', error);
    return null;
  }
}

// Logto 回调处理
router.post('/callback', async (req, res) => {
  try {
    const { code, state } = req.body;
    
    if (!code) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少授权码'
      });
    }

    console.log('处理 Logto 回调，code:', code);
    
    const logtoColumnExists = await checkLogtoColumnExists();
    let user;
    
    if (logtoColumnExists) {
      user = await handleLogtoWithColumn(req, code);
    } else {
      user = await handleLogtoWithoutColumn(req);
    }
    
    if (!user) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        code: RESPONSE_CODES.ERROR,
        message: '用户登录失败'
      });
    }
    
    const token = generateAccessToken({ 
      userId: user.id, 
      user_id: user.user_id 
    });
    
    delete user.password;
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '登录成功',
      data: {
        user,
        tokens: {
          access_token: token,
          logto_access_token: 'mock_logto_token_' + Date.now(),
          expires_in: 3600 * 24 * 7
        }
      }
    });
  } catch (error) {
    console.error('登录回调处理失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '登录失败'
    });
  }
});

// 获取登出 URL
router.get('/sign-out', async (req, res) => {
  try {
    const postLogoutRedirectUri = encodeURIComponent(config.logto.postLogoutRedirectUri);
    const signOutUrl = `${config.logto.endpoint}/oidc/session/end?` +
      `client_id=${config.logto.appId}` +
      `&post_logout_redirect_uri=${postLogoutRedirectUri}`;
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取登出地址成功',
      data: {
        signOutUrl
      }
    });
  } catch (error) {
    console.error('获取登出地址失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '获取登出地址失败'
    });
  }
});

module.exports = {
  router
};
