const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants');
const { pool } = require('../config/config');
const config = require('../config/config');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');
const { getIPLocation, getRealIP } = require('../utils/ipLocation');
const axios = require('axios');

// Logto SDK 相关配置
const LOGTO_CONFIG = {
  endpoint: config.logto.endpoint,
  appId: config.logto.appId,
  appSecret: config.logto.appSecret
};

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

// 获取 Logto Token
async function getLogtoToken(code) {
  const tokenUrl = `${LOGTO_CONFIG.endpoint}/oidc/token`;
  
  const params = new URLSearchParams();
  params.append('grant_type', 'authorization_code');
  params.append('code', code);
  params.append('redirect_uri', config.logto.redirectUri);
  params.append('client_id', LOGTO_CONFIG.appId);
  params.append('client_secret', LOGTO_CONFIG.appSecret);

  console.log('正在请求 Logto Token...');
  console.log('Token URL:', tokenUrl);
  
  const response = await axios.post(tokenUrl, params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  console.log('Token 请求成功:', {
    hasAccessToken: !!response.data.access_token,
    tokenType: response.data.token_type,
    expiresIn: response.data.expires_in
  });

  return response.data;
}

// 使用 Access Token 获取 Logto 用户信息
async function getLogtoUserInfo(accessToken) {
  const userInfoUrl = `${LOGTO_CONFIG.endpoint}/oidc/me`;

  console.log('正在请求 Logto 用户信息...');
  console.log('用户信息 URL:', userInfoUrl);

  const response = await axios.get(userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  console.log('用户信息请求成功:', {
    sub: response.data.sub,
    name: response.data.name,
    nickname: response.data.nickname,
    username: response.data.username,
    email: response.data.email,
    picture: response.data.picture ? '有头像' : '无头像'
  });

  return response.data;
}

// 从 Logto 用户 ID 查找或创建本地用户
async function findOrCreateUser(logtoUser, req) {
  const logtoColumnExists = await checkLogtoColumnExists();
  const logtoId = logtoUser.sub;
  const nickname = logtoUser.name || logtoUser.nickname || logtoUser.username || 'Logto 用户';
  const avatar = logtoUser.picture || '';
  const email = logtoUser.email || '';
  
  console.log('处理用户数据:', {
    logtoId,
    nickname,
    hasAvatar: !!avatar,
    email
  });
  
  let user;
  
  if (logtoColumnExists) {
    console.log('检测到 logto_id 列存在，使用 Logto ID 查找用户');
    
    let [users] = await pool.execute(
      'SELECT * FROM users WHERE logto_id = ?',
      [logtoId]
    );
    
    console.log('数据库查询结果:', {
      found: users.length > 0,
      userId: users.length > 0 ? users[0].id : null,
      nickname: users.length > 0 ? users[0].nickname : null
    });
    
    if (users.length > 0) {
      user = users[0];
      console.log('找到已存在的 Logto 用户，更新登录时间');
      
      await pool.execute(
        'UPDATE users SET last_login_at = NOW() WHERE id = ?',
        [user.id]
      );
      return user;
    }
    
    console.log('未找到 Logto 用户，创建新用户');
    const userIP = getRealIP(req);
    let ipLocation = '未知';
    try {
      ipLocation = await getIPLocation(userIP);
    } catch (error) {
      console.log('IP 属地查询失败:', error.message);
    }
    
    const userId = 'l' + Date.now().toString(36);
    const [result] = await pool.execute(
      'INSERT INTO users (logto_id, user_id, nickname, avatar, bio, email, location, last_login_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [
        logtoId,
        userId.slice(0, 15),
        nickname,
        avatar,
        '',
        email,
        ipLocation
      ]
    );
    
    console.log('新用户创建成功:', {
      databaseId: result.insertId,
      userId: userId.slice(0, 15),
      nickname
    });
    
    const [newUsers] = await pool.execute(
      'SELECT * FROM users WHERE id = ?',
      [result.insertId]
    );
    
    return newUsers[0];
  } else {
    console.log('logto_id 列不存在，使用备用方式查找用户');
    
    // 如果没有 logto_id 列，就不能保证用户唯一性了
    // 这里简化处理，为每次登录创建新用户
    const userIP = getRealIP(req);
    let ipLocation = '未知';
    try {
      ipLocation = await getIPLocation(userIP);
    } catch (error) {
      console.log('IP 属地查询失败:', error.message);
    }
    
    const userId = 'l' + Date.now().toString(36);
    const [result] = await pool.execute(
      'INSERT INTO users (user_id, nickname, avatar, bio, email, location, last_login_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [
        userId.slice(0, 15),
        nickname,
        avatar,
        '',
        email,
        ipLocation
      ]
    );
    
    const [newUsers] = await pool.execute(
      'SELECT * FROM users WHERE id = ?',
      [result.insertId]
    );
    
    return newUsers[0];
  }
}

// Logto 登录 URL 生成
router.get('/sign-in', async (req, res) => {
  try {
    if (!LOGTO_CONFIG.endpoint || !LOGTO_CONFIG.appId) {
      console.error('Logto 配置不完整，无法生成登录 URL');
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.ERROR,
        message: 'Logto 配置未完成，请检查环境变量配置'
      });
    }

    const redirectUri = encodeURIComponent(config.logto.redirectUri);
    const state = Math.random().toString(36).substring(2, 15);
    
    const signInUrl = `${LOGTO_CONFIG.endpoint}/oidc/auth?` +
      `client_id=${LOGTO_CONFIG.appId}` +
      `&redirect_uri=${redirectUri}` +
      `&response_type=code` +
      `&scope=openid profile email` +
      `&state=${state}`;
    
    console.log('生成 Logto 登录 URL:', signInUrl);
    
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

// Logto 回调处理
router.post('/callback', async (req, res) => {
  try {
    const { code, state } = req.body;
    
    if (!code) {
      console.error('回调请求缺少授权码');
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少授权码'
      });
    }

    console.log('=== Logto 登录开始 ===');
    console.log('Logto 配置检查:');
    console.log('  - endpoint:', LOGTO_CONFIG.endpoint);
    console.log('  - appId:', LOGTO_CONFIG.appId ? '已设置' : '未设置');
    console.log('  - appSecret:', LOGTO_CONFIG.appSecret ? '已设置' : '未设置');

    if (!LOGTO_CONFIG.endpoint || !LOGTO_CONFIG.appId || !LOGTO_CONFIG.appSecret) {
      console.error('Logto 配置不完整，无法进行 OAuth 登录');
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.ERROR,
        message: 'Logto 配置未完成，请检查环境变量 LOGTO_ENDPOINT, LOGTO_APP_ID, LOGTO_APP_SECRET'
      });
    }

    console.log('处理 Logto 回调，code:', code);
    
    const tokenData = await getLogtoToken(code);
    
    const logtoUser = await getLogtoUserInfo(tokenData.access_token);
    
    // 验证 Logto 用户数据
    if (!logtoUser || !logtoUser.sub) {
      console.error('Logto 用户信息无效:', logtoUser);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        code: RESPONSE_CODES.ERROR,
        message: '无法获取 Logto 用户信息'
      });
    }
    
    const user = await findOrCreateUser(logtoUser, req);
    
    if (!user) {
      console.error('用户创建失败');
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        code: RESPONSE_CODES.ERROR,
        message: '用户登录失败'
      });
    }
    
    // 生成 JWT 令牌
    const accessToken = generateAccessToken({ userId: user.id, user_id: user.user_id });
    const refreshToken = generateRefreshToken({ userId: user.id, user_id: user.user_id });
    
    // 获取用户IP和User-Agent
    const userIP = getRealIP(req);
    const userAgent = req.headers['user-agent'] || '';
    
    // 获取IP地理位置并更新用户location和最后登录时间
    const ipLocation = await getIPLocation(userIP);
    await pool.execute(
      'UPDATE users SET location = ?, last_login_at = NOW() WHERE id = ?',
      [ipLocation, user.id.toString()]
    );
    
    // 清除旧会话并保存新会话
    await pool.execute('UPDATE user_sessions SET is_active = 0 WHERE user_id = ?', [user.id.toString()]);
    await pool.execute(
      'INSERT INTO user_sessions (user_id, token, refresh_token, expires_at, user_agent, is_active) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), ?, 1)',
      [user.id.toString(), accessToken, refreshToken, userAgent]
    );
    
    // 更新用户对象中的location字段
    user.location = ipLocation;
    
    delete user.password;
    
    console.log('=== Logto 登录成功 ===');
    console.log('本地用户信息:', {
      id: user.id,
      user_id: user.user_id,
      nickname: user.nickname,
      logto_id: user.logto_id
    });
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '登录成功',
      data: {
        user,
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          logto_access_token: tokenData.access_token,
          logto_refresh_token: tokenData.refresh_token || '',
          expires_in: tokenData.expires_in || 3600 * 24 * 7
        }
      }
    });
  } catch (error) {
    console.error('登录回调处理失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: error.message || '登录失败'
    });
  }
});

// 获取登出 URL
router.get('/sign-out', async (req, res) => {
  try {
    const postLogoutRedirectUri = encodeURIComponent(config.logto.postLogoutRedirectUri);
    const signOutUrl = `${LOGTO_CONFIG.endpoint}/oidc/session/end?` +
      `client_id=${LOGTO_CONFIG.appId}` +
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
