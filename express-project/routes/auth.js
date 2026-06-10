const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { getDB } = require('../utils/db');
const { email: emailConfig, server: serverConfig } = require('../config/config');
const { generateAccessToken, generateRefreshToken, verifyToken } = require('../utils/jwt');
const { authenticateToken } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');
const { getIPLocation, getRealIP } = require('../utils/ipLocation');
const { sendEmailCode } = require('../utils/email');
const { delCache } = require('../utils/redis');
const svgCaptcha = require('svg-captcha');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * 使用 Node.js crypto 生成 SHA256 哈希（兼容所有数据库，不依赖 MySQL 的 SHA2 函数）
 * @param {string} str - 待哈希字符串
 * @returns {string} 十六进制哈希值
 */
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  if (email.length < 3 || email.length > 320) return false;
  if (/\s/.test(email)) return false;

  const atIndex = email.indexOf('@');
  if (atIndex <= 0 || atIndex !== email.lastIndexOf('@')) return false;

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (local.length < 1 || local.length > 64) return false;
  if (domain.length < 1 || domain.length > 255) return false;
  if (!domain.includes('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.includes('..')) return false;

  for (let i = 0; i < local.length; i++) {
    const c = local.charCodeAt(i);
    const isAlphaNum = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    const isAllowedSymbol = "!#$%&'*+/=?^_`{|}~.-".includes(local[i]);
    if (!isAlphaNum && !isAllowedSymbol) return false;
  }

  for (let i = 0; i < domain.length; i++) {
    const c = domain.charCodeAt(i);
    const isAlphaNum = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    const isAllowedSymbol = domain[i] === '-' || domain[i] === '.';
    if (!isAlphaNum && !isAllowedSymbol) return false;
  }

  return true;
}

// 存储验证码的临时对象（最大容量限制，防止内存泄漏）
const MAX_STORE_SIZE = 10000;
const captchaStore = new Map();
// 存储邮箱验证码的临时对象（最大容量限制，防止内存泄漏）
const emailCodeStore = new Map();
// 邮箱验证码发送频率限制（每个邮箱每5分钟最多发送1次）
const EMAIL_CODE_RATE_LIMIT = 5 * 60 * 1000; // 5分钟
const emailCodeRateLimit = new Map();

/**
 * 清理过期条目并在超过容量时移除最旧的
 * @param {Map} store - 目标Map
 * @param {number} maxSize - 最大容量
 */
function cleanupAndTrimStore(store, maxSize) {
  // 清理过期的验证码
  for (const [key, value] of store.entries()) {
    if (Date.now() > value.expires) {
      store.delete(key);
    }
  }
  // 超出容量时删除最旧的一半条目
  if (store.size > maxSize) {
    const entriesToRemove = Array.from(store.keys()).slice(0, Math.floor(maxSize / 2));
    entriesToRemove.forEach(key => store.delete(key));
  }
}

// 获取邮件功能配置状态
router.get('/email-config', (req, res) => {
  res.json({
    code: RESPONSE_CODES.SUCCESS,
    data: {
      emailEnabled: emailConfig.enabled
    },
    message: 'success'
  });
});

// 生成验证码
router.get('/captcha', (req, res) => {
  try {
    // 字体文件路径
    const fontDir = path.join(__dirname, '..', 'fonts');

    // 自动读取字体文件夹中的所有.ttf文件
    let fontFiles = [];
    if (fs.existsSync(fontDir)) {
      fontFiles = fs.readdirSync(fontDir).filter(file => file.endsWith('.ttf'));
    }

    // 如果有字体文件，随机选择一个加载
    if (fontFiles.length > 0) {
      const randomFont = fontFiles[Math.floor(Math.random() * fontFiles.length)];
      const fontPath = path.join(fontDir, randomFont);
      svgCaptcha.loadFont(fontPath);
    }

    const captcha = svgCaptcha.create({
      size: 4, // 验证码长度
      ignoreChars: '0o1ilcIC', // 排除容易混淆的字符
      noise: 4, // 干扰线条数
      color: true, // 彩色验证码
      fontSize: 40,
      background: `#${Math.floor(Math.random() * 16777215).toString(16)}`, // 随机颜色
    });

    // 生成唯一的captchaId
    const captchaId = Date.now() + Math.random().toString(36).substr(2, 9);

    // 存储验证码（半分钟过期）
    captchaStore.set(captchaId, {
      text: captcha.text, // 保持原始大小写
      expires: Date.now() + 30 * 1000 // 半分钟过期
    });

    // 清理过期的验证码并限制容量
    cleanupAndTrimStore(captchaStore, MAX_STORE_SIZE);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        captchaId,
        captchaSvg: captcha.data
      },
      message: '验证码生成成功'
    });
  } catch (error) {
    console.error('生成验证码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 检查用户ID是否已存在
router.get('/check-user-id', async (req, res) => {
  try {
    const { user_id } = req.query; // 前端传过来的悦社号
    if (!user_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入悦社号' });
    }
    // 查数据库是否已有该ID
    const db = getDB();
    const existingUser = await db('users').where({ user_id: user_id.toString() }).select('id');
    // 存在返回false，不存在返回true（供前端判断是否可继续）
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { isUnique: existingUser.length === 0 },
      message: existingUser.length > 0 ? '悦社号已存在' : '悦社号可用'
    });
  } catch (error) {
    console.error('检查用户ID失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 发送邮箱验证码
router.post('/send-email-code', async (req, res) => {
  try {
    // 检查邮件功能是否启用
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入邮箱地址' });
    }

    // 验证邮箱格式
    if (!isValidEmail(email)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱格式不正确' });
    }

    // 检查邮箱是否已被注册
    const db = getDB();
    const existingUser = await db('users').where({ email: email }).select('id');

    if (existingUser.length > 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '该邮箱已被注册' });
    }

    // 检查发送频率限制
    const lastSent = emailCodeRateLimit.get(email);
    if (lastSent && Date.now() - lastSent < EMAIL_CODE_RATE_LIMIT) {
      const remainingSeconds = Math.ceil((EMAIL_CODE_RATE_LIMIT - (Date.now() - lastSent)) / 1000);
      return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        code: RESPONSE_CODES.TOO_MANY_REQUESTS,
        message: `发送过于频繁，请${remainingSeconds}秒后再试`
      });
    }

    // 生成6位随机验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 发送验证码到邮箱
    await sendEmailCode(email, code);

    // 记录发送时间（用于频率限制）
    emailCodeRateLimit.set(email, Date.now());

    // 存储验证码（10分钟过期）
    const expires = Date.now() + 10 * 60 * 1000;
    emailCodeStore.set(email, {
      code,
      expires
    });

    // 清理过期的验证码并限制容量
    cleanupAndTrimStore(emailCodeStore, MAX_STORE_SIZE);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '验证码发送成功，请查收邮箱'
    });

  } catch (error) {
    console.error('发送邮箱验证码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '验证码发送失败，请稍后重试' });
  }
});

// 绑定邮箱
router.post('/bind-email', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    // 检查邮件功能是否启用
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }

    const { email, emailCode } = req.body;
    const userId = req.user.id;

    if (!email || !emailCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入邮箱和验证码' });
    }

    // 验证邮箱格式
    if (!isValidEmail(email)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱格式不正确' });
    }

    // 检查邮箱是否已被其他用户使用
    const existingUser = await db('users').where({ email: email }).whereNot({ id: userId.toString() }).select('id');

    if (existingUser.length > 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '该邮箱已被其他用户绑定' });
    }

    // 验证邮箱验证码
    const storedEmailCode = emailCodeStore.get(email);
    if (!storedEmailCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱验证码已过期或不存在' });
    }

    if (Date.now() > storedEmailCode.expires) {
      emailCodeStore.delete(email);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱验证码已过期' });
    }

    if (emailCode !== storedEmailCode.code) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱验证码错误' });
    }

    // 验证码验证成功，删除已使用的验证码
    emailCodeStore.delete(email);

    // 更新用户邮箱
    await db('users').where({ id: userId.toString() }).update({ email: email });

    console.log(`用户绑定邮箱成功 - 用户ID: ${userId}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '邮箱绑定成功',
      data: { email }
    });

  } catch (error) {
    console.error('绑定邮箱失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '绑定邮箱失败，请稍后重试' });
  }
});

// 发送找回密码验证码
router.post('/send-reset-code', async (req, res) => {
  try {
    // 检查邮件功能是否启用
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入邮箱地址' });
    }

    // 验证邮箱格式
    if (!isValidEmail(email)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱格式不正确' });
    }

    // 检查邮箱是否已注册
    const db = getDB();
    const existingUser = await db('users').where({ email: email }).select('id', 'user_id');

    if (existingUser.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.NOT_FOUND, message: '该邮箱未绑定任何账号' });
    }

    // 生成6位随机验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 发送验证码到邮箱
    await sendEmailCode(email, code);

    // 存储验证码（10分钟过期）
    const expires = Date.now() + 10 * 60 * 1000;
    emailCodeStore.set(`reset_${email}`, {
      code,
      expires,
      userId: existingUser[0].id
    });

    // 清理过期的验证码并限制容量
    cleanupAndTrimStore(emailCodeStore, MAX_STORE_SIZE);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '验证码发送成功，请查收邮箱',
      data: {
        user_id: existingUser[0].user_id
      }
    });

  } catch (error) {
    console.error('发送找回密码验证码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '验证码发送失败，请稍后重试' });
  }
});

// 验证找回密码验证码
router.post('/verify-reset-code', async (req, res) => {
  try {
    // 检查邮件功能是否启用
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }

    const { email, emailCode } = req.body;

    if (!email || !emailCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
    }

    // 验证邮箱验证码
    const storedData = emailCodeStore.get(`reset_${email}`);
    if (!storedData) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码已过期，请重新获取' });
    }

    if (Date.now() > storedData.expires) {
      emailCodeStore.delete(`reset_${email}`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码已过期，请重新获取' });
    }

    if (storedData.code !== emailCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码错误' });
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '验证码验证成功'
    });

  } catch (error) {
    console.error('验证找回密码验证码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '验证失败，请稍后重试' });
  }
});

// 重置密码
router.post('/reset-password', async (req, res) => {
  try {
    // 检查邮件功能是否启用
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }

    const { email, emailCode, newPassword } = req.body;

    if (!email || !emailCode || !newPassword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
    }

    // 验证密码长度
    if (newPassword.length < 6 || newPassword.length > 20) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码长度必须在6-20位之间' });
    }

    // 验证邮箱验证码
    const storedData = emailCodeStore.get(`reset_${email}`);
    if (!storedData) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码已过期，请重新获取' });
    }

    if (Date.now() > storedData.expires) {
      emailCodeStore.delete(`reset_${email}`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码已过期，请重新获取' });
    }

    if (storedData.code !== emailCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码错误' });
    }

    // 更新密码（使用 Node.js crypto 哈希，兼容 PostgreSQL）
    const db = getDB();
    await db('users').where({ email: email }).update({ password: sha256(newPassword) });

    // 删除已使用的验证码
    emailCodeStore.delete(`reset_${email}`);

    console.log(`用户重置密码成功`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '密码重置成功，请使用新密码登录'
    });

  } catch (error) {
    console.error('重置密码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '重置密码失败，请稍后重试' });
  }
});

// 解除邮箱绑定
router.delete('/unbind-email', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    // 检查邮件功能是否启用
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }

    const userId = req.user.id;

    // 检查用户是否已绑定邮箱
    const userRows = await db('users').where({ id: userId.toString() }).select('email');

    if (userRows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    const currentEmail = userRows[0].email;
    if (!currentEmail || currentEmail.trim() === '') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '您尚未绑定邮箱' });
    }

    // 解除邮箱绑定（将email设为空字符串）
    await db('users').where({ id: userId.toString() }).update({ email: '' });

    console.log(`用户解除邮箱绑定成功 - 用户ID: ${userId}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '邮箱解绑成功'
    });

  } catch (error) {
    console.error('解除邮箱绑定失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '解除邮箱绑定失败，请稍后重试' });
  }
});

// 用户注册
router.post('/register', async (req, res) => {
  try {
    const db = getDB();
    const { user_id, nickname, password, captchaId, captchaText, email, emailCode } = req.body;

    // 根据邮件功能是否启用，决定必填参数
    const isEmailEnabled = emailConfig.enabled;

    if (isEmailEnabled) {
      // 邮件功能启用时，邮箱和邮箱验证码必填
      if (!user_id || !nickname || !password || !captchaId || !captchaText || !email || !emailCode) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
      }
    } else {
      // 邮件功能未启用时，邮箱和邮箱验证码可选
      if (!user_id || !nickname || !password || !captchaId || !captchaText) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
      }
    }

    // 检查用户ID是否已存在
    const existingUser = await db('users').where({ user_id: user_id.toString() }).select('id');
    if (existingUser.length > 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '用户ID已存在' });
    }

    // 验证验证码
    const storedCaptcha = captchaStore.get(captchaId);
    if (!storedCaptcha) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码已过期或不存在' });
    }

    if (Date.now() > storedCaptcha.expires) {
      captchaStore.delete(captchaId);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码已过期' });
    }

    if (captchaText !== storedCaptcha.text) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码错误' });
    }

    // 验证码验证成功，删除已使用的验证码
    captchaStore.delete(captchaId);

    // 邮件功能启用时才验证邮箱
    if (isEmailEnabled) {
      // 验证邮箱格式
      if (!isValidEmail(email)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱格式不正确' });
      }

      // 验证邮箱验证码
      const storedEmailCode = emailCodeStore.get(email);
      if (!storedEmailCode) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱验证码已过期或不存在' });
      }

      if (Date.now() > storedEmailCode.expires) {
        emailCodeStore.delete(email);
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱验证码已过期' });
      }

      if (emailCode !== storedEmailCode.code) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱验证码错误' });
      }

      // 邮箱验证码验证成功，删除已使用的验证码
      emailCodeStore.delete(email);
    }

    if (user_id.length < 3 || user_id.length > 15) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '悦社号长度必须在3-15位之间' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(user_id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '悦社号只能包含字母、数字和下划线' });
    }

    if (nickname.length > 10) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '昵称长度必须少于10位' });
    }

    if (password.length < 6 || password.length > 20) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码长度必须在6-20位之间' });
    }

    // 获取用户IP属地
    const userIP = getRealIP(req);
    let ipLocation;
    try {
      ipLocation = await getIPLocation(userIP);
    } catch (error) {
      ipLocation = '未知';
      console.error('IP属地查询失败:', error.message);
    }
    // 获取用户User-Agent
    const userAgent = req.headers['user-agent'] || '';
    // 默认头像使用空字符串，前端会使用本地默认头像
    const defaultAvatar = '';

    // 插入新用户（密码使用SHA2哈希加密）
    // 邮件功能未启用时，email字段存储空字符串
    const userEmail = isEmailEnabled ? email : '';
    // 使用 .returning('id') 获取自增ID（PostgreSQL兼容）
    const insertedUsers = await db('users').insert({
      user_id: user_id,
      nickname: nickname,
      password: sha256(password),
      email: userEmail,
      avatar: defaultAvatar,
      bio: '',
      location: ipLocation,
      last_login_at: db.fn.now()
    }).returning('id');

    const userId = Array.isArray(insertedUsers) && insertedUsers.length > 0 ? insertedUsers[0].id : null;
    if (!userId) {
      throw new Error('创建用户失败：无法获取用户ID');
    }

    // 生成JWT令牌
    const accessToken = generateAccessToken({ userId, user_id });
    const refreshToken = generateRefreshToken({ userId, user_id });

    // 保存会话
    await db('user_sessions').insert({
      user_id: userId.toString(),
      token: accessToken,
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      user_agent: userAgent,
      is_active: 1
    });

    // 获取完整用户信息
    const userRows = await db('users').where({ id: userId.toString() }).select(
      'id', 'user_id', 'nickname', 'avatar', 'bio', 'location', 
      'follow_count', 'fans_count', 'like_count'
    );

    console.log(`用户注册成功 - 用户ID: ${userId}, 悦社号: ${userRows[0].user_id}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '注册成功',
      data: {
        user: userRows[0],
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 3600
        }
      }
    });
  } catch (error) {
    console.error('用户注册失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 用户登录
router.post('/login', async (req, res) => {
  try {
    const db = getDB();
    const { user_id, password } = req.body;
    if (!user_id || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
    }

    // 查找用户
    const userRows = await db('users').where({ user_id: user_id.toString() }).select(
      'id', 'user_id', 'nickname', 'avatar', 'bio', 'location', 
      'follow_count', 'fans_count', 'like_count', 'is_active', 
      'gender', 'zodiac_sign', 'mbti', 'education', 'major', 'interests'
    );

    if (userRows.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    const user = userRows[0];

    if (!user.is_active) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '账户已被禁用' });
    }

    // 验证密码（哈希比较，使用 Node.js crypto 兼容 PostgreSQL）
    const hashedPassword = sha256(password);
    const passwordCheck = await db('users')
      .where({ id: user.id.toString(), password: hashedPassword })
      .select(1);

    if (passwordCheck.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码错误' });
    }

    // 生成JWT令牌
    const accessToken = generateAccessToken({ userId: user.id, user_id: user.user_id });
    const refreshToken = generateRefreshToken({ userId: user.id, user_id: user.user_id });

    // 获取用户IP和User-Agent
    const userIP = getRealIP(req);
    const userAgent = req.headers['user-agent'] || '';

    // 获取IP地理位置并更新用户location和最后登录时间
    const ipLocation = await getIPLocation(userIP);
    await db('users').where({ id: user.id.toString() }).update({ 
      location: ipLocation, 
      last_login_at: db.fn.now() 
    });

    // 清除旧会话并保存新会话
    await db('user_sessions').where({ user_id: user.id.toString() }).update({ is_active: 0 });
    await db('user_sessions').insert({
      user_id: user.id.toString(),
      token: accessToken,
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      user_agent: userAgent,
      is_active: 1
    });

    // 更新用户对象中的location字段
    user.location = ipLocation;

    // 移除密码字段
    delete user.password;

    // 处理interests字段（如果是JSON字符串则解析）
    if (user.interests) {
      try {
        user.interests = typeof user.interests === 'string'
          ? JSON.parse(user.interests)
          : user.interests;
      } catch (e) {
        user.interests = null;
      }
    }

    console.log(`用户登录成功 - 用户ID: ${user.id}, 悦社号: ${user.user_id}`);

    // 设置最严格的HttpOnly Cookie
    const isProduction = serverConfig.env === 'production';
    const cookieOptions = {
      httpOnly: true,           // JavaScript无法访问
      secure: isProduction,     // 生产环境必须HTTPS
      sameSite: 'lax',          // 统一使用lax，确保OAuth回调正常
      maxAge: 7 * 24 * 60 * 60 * 1000,  // 7天
      path: '/'
    };

    res.cookie('token', accessToken, cookieOptions);

    // Refresh Token Cookie（用于自动刷新）
    res.cookie('refresh_token', refreshToken, {
      ...cookieOptions,
      maxAge: 30 * 24 * 60 * 60 * 1000  // 30天
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '登录成功',
      data: {
        user
        // 不再返回tokens，token已通过安全Cookie传输
      }
    });
  } catch (error) {
    console.error('用户登录失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 刷新令牌
router.post('/refresh', async (req, res) => {
  try {
    const db = getDB();
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少刷新令牌' });
    }

    // 验证刷新令牌
    const decoded = verifyToken(refresh_token);

    // 检查会话是否有效
    const sessionRows = await db('user_sessions')
      .where({ 
        user_id: decoded.userId.toString(), 
        refresh_token: refresh_token,
        is_active: 1
      })
      .where('expires_at', '>', db.fn.now())
      .select('id');

    if (sessionRows.length === 0) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ code: RESPONSE_CODES.UNAUTHORIZED, message: '刷新令牌无效或已过期' });
    }

    // 生成新的令牌
    const newAccessToken = generateAccessToken({ userId: decoded.userId, user_id: decoded.user_id });
    const newRefreshToken = generateRefreshToken({ userId: decoded.userId, user_id: decoded.user_id });

    // 获取用户IP和User-Agent
    const userIP = getRealIP(req);
    const userAgent = req.headers['user-agent'] || '';

    // 获取IP地理位置并更新用户location
    const ipLocation = await getIPLocation(userIP);
    await db('users').where({ id: decoded.userId.toString() }).update({ location: ipLocation });

    // 更新会话
    await db('user_sessions').where({ id: sessionRows[0].id.toString() }).update({
      token: newAccessToken,
      refresh_token: newRefreshToken,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      user_agent: userAgent
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '令牌刷新成功',
      data: {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_in: 3600
      }
    });
  } catch (error) {
    console.error('刷新令牌失败:', error);
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ code: RESPONSE_CODES.UNAUTHORIZED, message: '刷新令牌无效' });
  }
});

// 退出登录
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const token = req.token;

    // 将当前会话设为无效
    const db = getDB();
    await db('user_sessions').where({ 
      user_id: userId.toString(), 
      token: token 
    }).update({ is_active: 0 });

    console.log(`用户退出成功 - 用户ID: ${userId}`);

    // 清理Redis缓存
    await delCache(`session:user:${token}`);

    // 只清除用户自己的Cookie（使用与设置时相同的选项）
    const isProduction = serverConfig.env === 'production';
    const clearOptions = {
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax'
    };

    res.clearCookie('token', clearOptions);
    res.clearCookie('refresh_token', clearOptions);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '退出成功'
    });
  } catch (error) {
    console.error('退出登录失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取当前用户信息
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const userRows = await db({ u: 'users' })
      .leftJoin({ uv: 'user_verification' }, function() {
        this.on('u.id', '=', 'uv.user_id').andOn('uv.status', '=', 1);
      })
      .where({ 'u.id': userId.toString() })
      .select(
        'u.id', 'u.user_id', 'u.nickname', 'u.avatar', 'u.bio', 'u.location',
        'u.email', 'u.follow_count', 'u.fans_count', 'u.like_count',
        'u.is_active', 'u.created_at', 'u.gender', 'u.zodiac_sign',
        'u.mbti', 'u.education', 'u.major', 'u.interests', 'u.verified',
        'uv.title as verified_title'
      );

    if (userRows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    const user = userRows[0];

    // 处理interests字段（如果是JSON字符串则解析）
    if (user.interests) {
      try {
        user.interests = typeof user.interests === 'string'
          ? JSON.parse(user.interests)
          : user.interests;
      } catch (e) {
        user.interests = null;
      }
    }

    // 查询用户的封禁状态
    const banResult = await db('user_ban')
      .where({ user_id: user.id.toString() })
      .whereIn('status', [0, 3])
      .select('reason', 'end_time', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(1);

    // 添加封禁状态信息
    if (banResult.length > 0) {
      const ban = banResult[0];
      user.ban = {
        end_time: ban.end_time,
        reason: ban.reason,
        created_at: ban.created_at
      };
    } else {
      user.ban = null;
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: user
    });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 管理员登录
router.post('/admin/login', async (req, res) => {
  try {
    return res.status(HTTP_STATUS.METHOD_NOT_ALLOWED).json({
      code: RESPONSE_CODES.ERROR,
      message: '管理员登录仅支持 Logto OAuth，请使用 /admin/login 页面登录'
    });
  } catch (error) {
    console.error('管理员登录失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取当前管理员信息
router.get('/admin/me', authenticateToken, async (req, res) => {
  try {
    const adminId = req.user.adminId;

    if (!adminId) {
      console.error('获取管理员信息失败: req.user.adminId 不存在');
      console.error('req.user 对象:', req.user);
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '无效的管理员会话，请重新登录'
      });
    }

    const db = getDB();
    const adminRows = await db('admin').where({ id: String(adminId) }).select(
      'id', 'username', 'nickname', 'is_super', 'permissions', 'logto_id'
    );

    if (adminRows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' });
    }

    const admin = adminRows[0];
    let permissions = [];
    if (admin.permissions) {
      try {
        permissions = typeof admin.permissions === 'string' ? JSON.parse(admin.permissions) : admin.permissions;
      } catch (e) {
        permissions = [];
      }
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        id: admin.id,
        username: admin.username,
        nickname: admin.nickname,
        isSuper: admin.is_super === 1,
        permissions,
        logtoId: admin.logto_id
      }
    });
  } catch (error) {
    console.error('获取管理员信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取管理员列表
router.get('/admin/admins', authenticateToken, async (req, res) => {
  try {
    // 权限检查
    if (!checkPermission(req.user.adminPermissions, 'admins:view', req.user.isSuper)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ 
        code: RESPONSE_CODES.FORBIDDEN, 
        message: '无权限查看管理员列表' 
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // 搜索条件
    let whereClause = '';
    const params = [];

    if (req.query.username) {
      whereClause += ' WHERE username LIKE ?';
      params.push(`%${req.query.username}%`);
    }

    // 验证排序字段
    const allowedSortFields = ['username', 'created_at'];
    const finalSortField = allowedSortFields.includes(req.query.sortField) ? req.query.sortField : 'created_at';
    const finalSortOrder = req.query.sortOrder && req.query.sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 获取总数
    const db = getDB();
    let countQuery = db('admin').count('* as total');
    
    if (req.query.username) {
      countQuery = countQuery.where('username', 'like', `%${req.query.username}%`);
    }
    
    const countResult = await countQuery.first();
    const total = parseInt(countResult.total);

    // 查询管理员列表
    let dataQuery = db('admin').select(
      'id', 'username', 'nickname', 'is_super', 'permissions', 'logto_id', 'created_at'
    );
    
    if (req.query.username) {
      dataQuery = dataQuery.where('username', 'like', `%${req.query.username}%`);
    }
    
    // 严格验证排序字段，防止SQL注入
    const validSortField = allowedSortFields.includes(req.query.sortField) ? req.query.sortField : 'created_at';
    // 严格验证排序方向，只允许 asc 或 desc
    const validSortOrder = req.query.sortOrder && req.query.sortOrder.toLowerCase() === 'asc' ? 'asc' : 'desc';
    
    const adminRows = await dataQuery.orderBy(validSortField, validSortOrder).limit(limit).offset(offset);
    
    // 处理权限字段
    const processedRows = adminRows.map(admin => {
      let permissions = [];
      if (admin.permissions) {
        try {
          permissions = typeof admin.permissions === 'string' ? JSON.parse(admin.permissions) : admin.permissions;
        } catch (e) {
          permissions = [];
        }
      }
      return {
        id: admin.id,
        username: admin.username,
        nickname: admin.nickname,
        isSuper: admin.is_super === 1,
        permissions,
        logtoId: admin.logto_id,
        createdAt: admin.created_at
      };
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        items: processedRows,
        total
      }
    });
  } catch (error) {
    console.error('获取管理员列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 创建管理员
router.post('/admin/admins', authenticateToken, async (req, res) => {
  try {
    // 权限检查 - 需要创建管理员权限
    if (!checkPermission(req.user.adminPermissions, 'admins:create', req.user.isSuper)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ 
        code: RESPONSE_CODES.FORBIDDEN, 
        message: '无权限创建管理员' 
      });
    }

    const { username, logtoId, nickname, permissions, isSuper } = req.body;

    if (!username) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '用户名不能为空' });
    }

    // 检查用户名是否已存在
    const db = getDB();
    const existingRows = await db('admin').where({ username: username }).select('id');

    if (existingRows.length > 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '该用户名已存在' });
    }

    // 创建管理员（Logto关联，无需密码）
    // 使用 .returning('id') 获取自增ID（PostgreSQL兼容）
    const insertedAdmins = await db('admin').insert({
      username: username,
      logto_id: logtoId || null,
      nickname: nickname || username,
      permissions: JSON.stringify(permissions || []),
      is_super: isSuper ? 1 : 0,
      created_at: db.fn.now()
    }).returning('id');

    const adminId = Array.isArray(insertedAdmins) && insertedAdmins.length > 0 ? insertedAdmins[0].id : null;

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '创建管理员成功',
      data: {
        id: adminId
      }
    });
  } catch (error) {
    console.error('创建管理员失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 更新管理员信息
router.put('/admin/admins/:id', authenticateToken, async (req, res) => {
  try {
    // 权限检查 - 需要编辑管理员权限
    if (!checkPermission(req.user.adminPermissions, 'admins:edit', req.user.isSuper)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ 
        code: RESPONSE_CODES.FORBIDDEN, 
        message: '无权限编辑管理员' 
      });
    }

    const adminId = req.params.id;
    const { nickname, permissions, isSuper, logtoId } = req.body;

    // 检查管理员是否存在
    const db = getDB();
    const adminRows = await db('admin').where({ id: adminId }).select('id');

    if (adminRows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' });
    }

    // 更新管理员信息（Logto关联，无密码）
    const updateData = {};
    
    if (nickname !== undefined) {
      updateData.nickname = nickname;
    }
    if (permissions !== undefined) {
      updateData.permissions = JSON.stringify(permissions);
    }
    if (isSuper !== undefined) {
      updateData.is_super = isSuper ? 1 : 0;
    }
    if (logtoId !== undefined) {
      updateData.logto_id = logtoId || null;
    }

    if (Object.keys(updateData).length > 0) {
      await db('admin').where({ id: adminId }).update(updateData);
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '更新管理员信息成功'
    });
  } catch (error) {
    console.error('更新管理员信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 删除管理员
router.delete('/admin/admins/:id', authenticateToken, async (req, res) => {
  try {
    // 权限检查 - 需要删除管理员权限
    if (!checkPermission(req.user.adminPermissions, 'admins:delete', req.user.isSuper)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权限删除管理员'
      });
    }

    const adminId = req.params.id;

    // 检查管理员是否存在
    const db = getDB();
    const adminRows = await db('admin').where({ id: adminId }).select('id', 'username', 'logto_id');

    if (adminRows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' });
    }

    const admin = adminRows[0];

    // 优先按 id 删除，如果 logto_id 存在也可以用它来确保准确性
    if (admin.logto_id) {
      await db('admin').where({ id: adminId, logto_id: admin.logto_id }).del();
    } else {
      // 没有 logto_id 的管理员按 username 删除
      await db('admin').where({ id: adminId, username: admin.username }).del();
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '删除管理员成功'
    });
  } catch (error) {
    console.error('删除管理员失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 重置管理员密码
// 管理员刷新令牌
router.post('/admin/refresh', async (req, res) => {
  try {
    const db = getDB();
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少刷新令牌' });
    }

    // 验证刷新令牌
    const decoded = verifyToken(refresh_token);

    // 检查是否为管理员令牌
    if (!decoded.type || decoded.type !== 'admin') {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ code: RESPONSE_CODES.UNAUTHORIZED, message: '无效的刷新令牌' });
    }

    // 检查会话是否有效
    const sessionRows = await db('admin_sessions')
      .where({ 
        admin_id: decoded.adminId.toString(), 
        refresh_token: refresh_token,
        is_active: 1
      })
      .where('expires_at', '>', db.fn.now())
      .select('id');

    if (sessionRows.length === 0) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ code: RESPONSE_CODES.UNAUTHORIZED, message: '刷新令牌无效或已过期' });
    }

    // 生成新的令牌
    const newAccessToken = generateAccessToken({
      adminId: decoded.adminId,
      username: decoded.username,
      type: 'admin'
    });
    const newRefreshToken = generateRefreshToken({
      adminId: decoded.adminId,
      username: decoded.username,
      type: 'admin'
    });

    // 获取用户IP和User-Agent
    const userAgent = req.headers['user-agent'] || '';

    // 更新会话
    await db('admin_sessions').where({ id: sessionRows[0].id.toString() }).update({
      token: newAccessToken,
      refresh_token: newRefreshToken,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      user_agent: userAgent
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '令牌刷新成功',
      data: {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_in: 3600
      }
    });
  } catch (error) {
    console.error('刷新令牌失败:', error);
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ code: RESPONSE_CODES.UNAUTHORIZED, message: '刷新令牌无效' });
  }
});

// 管理员登出
router.post('/admin/logout', authenticateToken, async (req, res) => {
  try {
    const adminId = req.user.adminId || req.user.id;
    const token = req.token;

    // 注销会话
    const db = getDB();
    await db('admin_sessions').where({ 
      admin_id: String(adminId), 
      token: String(token) 
    }).update({ is_active: 0 });

    console.log(`管理员退出成功 - 管理员ID: ${adminId}`);

    // 清理Redis缓存
    await delCache(`session:admin:${token}`);

    // 只清除管理员自己的Cookie
    const isProduction = serverConfig.env === 'production';
    const clearOptions = {
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax'
    };

    res.clearCookie('admin_token', clearOptions);
    res.clearCookie('admin_refresh_token', clearOptions);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '登出成功'
    });
  } catch (error) {
    console.error('管理员登出失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

module.exports = router;