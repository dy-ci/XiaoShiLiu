/**
 * 悦社社区 - Yggdrasil API 工具函数库
 * 提供 Token 管理、密码加密、UUID 生成、纹理编码等核心功能
 * 
 * @author zhaishis
 * @version v1.1.0
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { getDB } = require('./db');

// 简易日志辅助函数，统一格式，便于追踪
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[Yggdrasil-${level.toUpperCase()}] ${timestamp}`;
  if (data) {
    console.log(`${prefix} ${message}`, JSON.stringify(data));
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// 不再缓存 db 实例，每次都从 db.js 获取，确保连接生命周期一致
const getDbInstance = () => getDB();

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.error('警告: YGGDRASIL JWT_SECRET 环境变量未设置，将使用随机生成的密钥（每次重启都会改变，导致所有Token失效）');
  console.error('请在 .env 文件中设置固定的 JWT_SECRET');
  return crypto.randomBytes(32).toString('hex');
})();

// RSA 签名密钥路径（优先从 .env 读取，兼容旧配置）
const PRIVATE_KEY_PATH = process.env.YGGDRASIL_PRIVATE_KEY_PATH
  ? path.resolve(process.env.YGGDRASIL_PRIVATE_KEY_PATH)
  : path.join(__dirname, '..', 'keys', 'yggdrasil-private.pem');
const PUBLIC_KEY_PATH = process.env.YGGDRASIL_PUBLIC_KEY_PATH
  ? path.resolve(process.env.YGGDRASIL_PUBLIC_KEY_PATH)
  : path.join(__dirname, '..', 'keys', 'yggdrasil-public.pem');

// 缓存私钥和公钥
let privateKeyCache = null;
let publicKeyCache = null;

/**
 * 加载 RSA 私钥
 */
function loadPrivateKey() {
  if (privateKeyCache) return privateKeyCache;
  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    log('debug', '加载私钥', { path: PRIVATE_KEY_PATH });
    privateKeyCache = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
    return privateKeyCache;
  }
  log('warn', '私钥文件不存在', { path: PRIVATE_KEY_PATH });
  return null;
}

/**
 * 加载 RSA 公钥
 */
function loadPublicKey() {
  if (publicKeyCache) return publicKeyCache;
  if (fs.existsSync(PUBLIC_KEY_PATH)) {
    log('debug', '加载公钥', { path: PUBLIC_KEY_PATH });
    publicKeyCache = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
    return publicKeyCache;
  }
  log('warn', '公钥文件不存在', { path: PUBLIC_KEY_PATH });
  return null;
}

/**
 * 对数据进行 RSA-SHA1 签名（规范要求 SHA1withRSA）
 */
function signData(data) {
  const privateKey = loadPrivateKey();
  if (!privateKey) {
    log('warn', '跳过签名，私钥不可用');
    return null;
  }
  
  try {
    const sign = crypto.createSign('RSA-SHA1');
    sign.update(data);
    sign.end();
    const signature = sign.sign(privateKey, 'base64');
    log('debug', '数据签名成功');
    return signature;
  } catch (error) {
    log('error', '签名失败', { error: error.message });
    return null;
  }
}

/**
 * 获取公钥字符串
 */
function getSignaturePublicKey() {
  const publicKey = loadPublicKey();
  if (!publicKey) {
    log('warn', '获取公钥失败，返回 null');
    return null;
  }
  return publicKey;
}

const ACCESS_TOKEN_EXPIRES_IN = '7d';
const REFRESH_TOKEN_EXPIRES_IN = '30d';

function generateAccessToken(profile) {
  const randomPart = crypto.randomBytes(32).toString('hex');
  const timestamp = Date.now().toString(36);
  const token = `ygg_${randomPart}_${timestamp}`;
  log('debug', '生成AccessToken', { profileId: profile.id, tokenPrefix: token.substring(0, 20) });
  return token;
}

function generateRefreshToken() {
  const token = crypto.randomBytes(64).toString('hex');
  log('debug', '生成RefreshToken', { tokenPrefix: token.substring(0, 20) });
  return token;
}

function generateClientToken() {
  const token = crypto.randomBytes(32).toString('hex');
  log('debug', '生成ClientToken', { tokenPrefix: token.substring(0, 20) });
  return token;
}

async function verifyToken(token) {
  log('debug', '开始验证JWT Token', { tokenPrefix: token?.substring(0, 20) });
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'yueshe-yggdrasil',
      audience: 'minecraft'
    });
    log('debug', 'JWT验证成功', { profileId: decoded?.profileId });
    return { valid: true, decoded };
  } catch (error) {
    log('warn', 'JWT验证失败', { error: error.name, message: error.message });
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token expired' };
    }
    return { valid: false, error: 'Invalid token' };
  }
}

async function hashPassword(password) {
  log('debug', '开始密码哈希');
  const saltRounds = 12;
  const result = await bcrypt.hash(password, saltRounds);
  log('debug', '密码哈希完成');
  return result;
}

async function verifyPassword(password, hash) {
  log('debug', '开始密码验证');
  try {
    const result = await bcrypt.compare(password, hash);
    log('debug', '密码验证结果', { match: result });
    return result;
  } catch (err) {
    log('error', '密码验证过程异常', { error: err.message });
    return false;
  }
}

function generateUuidV4() {
  const uuid = crypto.randomUUID();
  log('debug', '生成UUIDv4', { uuid });
  return uuid;
}

function formatUuid(uuid) {
  if (!uuid) {
    log('debug', 'formatUuid 输入为空');
    return null;
  }
  return uuid.replace(/-/g, '');
}

function encodeTextures(textures) {
  const payload = {
    timestamp: Date.now(),
    profileId: textures.profileId ? textures.profileId.replace(/-/g, '') : '',
    profileName: textures.profileName || '',
    textures: {}
  };

  if (textures.skinUrl) {
    payload.textures.SKIN = {
      url: textures.skinUrl,
      metadata: { model: textures.skinModel || 'classic' }
    };
  }

  if (textures.capeUrl) {
    payload.textures.CAPE = {
      url: textures.capeUrl
    };
  }

  const base64Value = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = signData(base64Value);
  
  log('debug', '编码纹理数据', { hasSkin: !!textures.skinUrl, hasCape: !!textures.capeUrl });
  return { value: base64Value, signature };
}

function isValidPlayerName(name) {
  if (!name || typeof name !== 'string') {
    log('debug', '玩家名无效：非字符串或为空', { name });
    return false;
  }
  
  const trimmedName = name.trim();
  
  if (trimmedName.length < 3 || trimmedName.length > 16) {
    log('debug', '玩家名长度不符合要求', { name: trimmedName, length: trimmedName.length });
    return false;
  }
  
  if (/^\d/.test(trimmedName)) {
    log('debug', '玩家名以数字开头', { name: trimmedName });
    return false;
  }
  
  const validPattern = /^[a-zA-Z0-9_]+$/;
  if (!validPattern.test(trimmedName)) {
    log('debug', '玩家名包含无效字符', { name: trimmedName });
    return false;
  }

  const reservedNames = ['steve', 'alex', 'notch', 'mojang'];
  if (reservedNames.includes(trimmedName.toLowerCase())) {
    log('debug', '玩家名是保留名称', { name: trimmedName });
    return false;
  }

  return true;
}

function validatePasswordStrength(password) {
  const errors = [];

  if (!password || password.length < 8) {
    errors.push('密码长度至少为8位');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('密码必须包含小写字母');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('密码必须包含大写字母');
  }

  if (!/\d/.test(password)) {
    errors.push('密码必须包含数字');
  }

  const valid = errors.length === 0;
  log('debug', '密码强度校验', { valid, errors });
  return {
    valid,
    errors,
    strength: calculatePasswordStrength(password)
  };
}

function calculatePasswordStrength(password) {
  let strength = 0;
  if (password.length >= 8) strength += 20;
  if (password.length >= 12) strength += 20;
  if (/[a-z]/.test(password)) strength += 15;
  if (/[A-Z]/.test(password)) strength += 15;
  if (/\d/.test(password)) strength += 15;
  if (/[^a-zA-Z\d]/.test(password)) strength += 15;
  return Math.min(strength, 100);
}

function createFileHash(buffer) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  log('debug', '计算文件哈希', { hash });
  return hash;
}

async function auditLog(action, userId = null, profileId = null, ipAddress = null, details = null) {
  try {
    await getDbInstance()('mc_audit_logs').insert({
      user_id: userId,
      profile_id: profileId,
      action: action,
      ip_address: ipAddress,
      details: details ? JSON.stringify(details) : null
    });
    log('debug', '审计日志记录成功', { action, userId, profileId, ipAddress });
  } catch (error) {
    log('error', '审计日志记录失败', { error: error.message });
  }
}

async function getProfileByUuid(uuid) {
  const normalizedUuid = uuid.replace(/-/g, '');
  log('debug', '根据UUID查询角色', { uuid, normalizedUuid });
  
  const row = await getDbInstance()('mc_profiles')
    .whereRaw("REPLACE(uuid, '-', '') = ?", [normalizedUuid])
    .where({ is_banned: 0, is_deleted: 0 })
    .first();

  if (row) {
    log('debug', '角色查询成功', { uuid: normalizedUuid, playerName: row.player_name });
  } else {
    log('warn', '未找到角色或已被封禁/删除', { uuid: normalizedUuid });
  }
  return row || null;
}

async function getProfileByName(playerName) {
  log('debug', '根据玩家名查询角色', { playerName });
  
  const row = await getDbInstance()('mc_profiles')
    .where({ player_name: playerName, is_banned: 0, is_deleted: 0 })
    .first();

  if (row) {
    log('debug', '角色查询成功', { playerName, profileId: row.id, userId: row.user_id });
  } else {
    log('warn', '未找到角色或已被封禁/删除', { playerName });
  }
  return row || null;
}

async function getProfilesByUserId(userId) {
  log('debug', '查询用户的所有角色', { userId });
  const rows = await getDbInstance()('mc_profiles')
    .select('id', 'player_name', 'uuid', 'skin_url', 'cape_url', 'skin_model', 'is_banned', 'created_at', 'updated_at', 'last_name_change_at')
    .where({ user_id: userId, is_deleted: 0 })
    .orderBy('created_at', 'desc');

  log('debug', '角色列表查询结果', { count: rows.length });
  return rows;
}

async function getProfileById(profileId) {
  log('debug', '根据ID查询角色', { profileId });
  const row = await getDbInstance()('mc_profiles')
    .where({ id: profileId })
    .first();

  if (row) {
    log('debug', '角色查询成功', { profileId, playerName: row.player_name });
  } else {
    log('warn', '未找到角色', { profileId });
  }
  return row || null;
}

async function saveTokens(profileId, accessToken, refreshToken, clientToken, ipAddress = null, userAgent = null, authType = 'main', tempPasswordId = null) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const db = getDbInstance();
  const MAX_TOKENS = 10;
  
  log('debug', '保存Token开始', { profileId, accessTokenPrefix: accessToken.substring(0, 20), clientToken });
  
  await db.transaction(async (trx) => {
    const countResult = await trx('yggdrasil_tokens')
      .where('profile_id', profileId)
      .where('expires_at', '>', trx.fn.now())
      .count('* as count')
      .first();
    
    const count = parseInt(countResult.count);
    log('debug', '当前有效Token数量', { profileId, count });
    
    if (count >= MAX_TOKENS) {
      const oldTokens = await trx('yggdrasil_tokens')
        .select('id')
        .where('profile_id', profileId)
        .where('expires_at', '>', trx.fn.now())
        .orderBy('created_at', 'asc')
        .limit(count - MAX_TOKENS + 1);
      
      if (oldTokens.length > 0) {
        const idsToDelete = oldTokens.map(t => t.id);
        await trx('yggdrasil_tokens').whereIn('id', idsToDelete).delete();
        log('warn', 'Token数量超限，删除旧Token', { profileId, deletedCount: oldTokens.length });
      }
    }

    await trx('yggdrasil_tokens').insert({
      profile_id: profileId,
      access_token: accessToken,
      refresh_token: refreshToken,
      client_token: clientToken,
      expires_at: expiresAt,
      ip_address: ipAddress,
      user_agent: userAgent,
      auth_type: authType,
      temp_password_id: tempPasswordId
    });
    log('debug', '新Token已保存', { profileId });
  });
}

async function findTokenByAccessToken(accessToken) {
  log('debug', '根据AccessToken查询Token', { tokenPrefix: accessToken?.substring(0, 20) });
  const row = await getDbInstance()('yggdrasil_tokens as t')
    .join('mc_profiles as p', 't.profile_id', 'p.id')
    .where('t.access_token', accessToken)
    .where('t.expires_at', '>', getDbInstance().fn.now())
    .where('t.is_revoked', 0)
    .where('t.is_temporarily_invalidated', 0)
    .orderBy('t.created_at', 'desc')
    .first();

  if (row) {
    log('debug', 'Token查询成功', { profileId: row.profile_id, playerName: row.player_name, accessTokenPrefix: accessToken.substring(0, 20) });
  } else {
    log('warn', '未找到有效Token', { accessTokenPrefix: accessToken?.substring(0, 20) });
  }
  return row || null;
}

async function findTokenByRefreshToken(refreshToken) {
  log('debug', '根据RefreshToken查询Token', { tokenPrefix: refreshToken?.substring(0, 20) });
  const row = await getDbInstance()('yggdrasil_tokens as t')
    .join('mc_profiles as p', 't.profile_id', 'p.id')
    .where('t.refresh_token', refreshToken)
    .where('t.expires_at', '>', getDbInstance().fn.now())
    .where('t.is_revoked', 0)
    .orderBy('t.created_at', 'desc')
    .first();

  if (row) {
    log('debug', 'RefreshToken查询成功', { profileId: row.profile_id, playerName: row.player_name });
  } else {
    log('warn', '未找到有效RefreshToken', { refreshTokenPrefix: refreshToken?.substring(0, 20) });
  }
  return row || null;
}

async function isTokenTemporarilyInvalidated(accessToken) {
  log('debug', '检查Token是否暂时失效', { accessTokenPrefix: accessToken?.substring(0, 20) });
  const row = await getDbInstance()('yggdrasil_tokens')
    .select('is_temporarily_invalidated')
    .where('access_token', accessToken)
    .where('expires_at', '>', getDbInstance().fn.now())
    .first();

  const result = row?.is_temporarily_invalidated === 1;
  log('debug', 'Token暂时失效状态', { accessTokenPrefix: accessToken?.substring(0, 20), isInvalidated: result });
  return result;
}

async function markTokensAsTemporarilyInvalidated(profileId) {
  log('info', '标记角色所有Token为暂时失效', { profileId });
  const result = await getDbInstance()('yggdrasil_tokens')
    .where('profile_id', profileId)
    .where('expires_at', '>', getDbInstance().fn.now())
    .update({ is_temporarily_invalidated: 1 });

  log('info', 'Token暂时失效标记完成', { profileId, affectedRows: result });
  return result;
}

async function invalidateAllTokens(profileId) {
  log('info', '撤销角色所有Token', { profileId });
  const result = await getDbInstance()('yggdrasil_tokens')
    .where('profile_id', profileId)
    .where('is_revoked', 0)
    .update({
      is_revoked: 1,
      revoked_at: getDbInstance().fn.now(),
      revoked_reason: '用户登出'
    });

  log('info', 'Token已撤销', { profileId, affectedRows: result });
  return result;
}

async function invalidateToken(accessToken) {
  log('info', '手动撤销单个Token', { accessTokenPrefix: accessToken?.substring(0, 20) });
  const result = await getDbInstance()('yggdrasil_tokens')
    .where('access_token', accessToken)
    .where('is_revoked', 0)
    .update({
      is_revoked: 1,
      revoked_at: getDbInstance().fn.now(),
      revoked_reason: '手动注销'
    });

  if (result > 0) {
    log('info', 'Token已撤销', { accessTokenPrefix: accessToken?.substring(0, 20) });
  } else {
    log('warn', 'Token撤销失败或已处于撤销状态', { accessTokenPrefix: accessToken?.substring(0, 20) });
  }
  return result > 0;
}

async function cleanupExpiredTokens() {
  try {
    const db = getDbInstance();
    let hasRevokedColumn = false;
    try {
      const columnInfo = await db('yggdrasil_tokens').columnInfo();
      hasRevokedColumn = 'is_revoked' in columnInfo;
    } catch (e) {
      log('warn', '无法检查数据库列信息，使用基本清理模式');
    }

    let total = 0;
    if (hasRevokedColumn) {
      const revokedResult = await db('yggdrasil_tokens')
        .where('is_revoked', 1)
        .where(function() {
          this.where('expires_at', '<', db.fn.now())
            .orWhereRaw("revoked_at + INTERVAL '7 days' < NOW()");
        })
        .delete();
      if (revokedResult > 0) {
        log('info', '清理已撤销的过期Token', { count: revokedResult });
        total += revokedResult;
      }

      const expiredResult = await db('yggdrasil_tokens')
        .where('is_revoked', 0)
        .where('expires_at', '<', db.fn.now())
        .delete();
      if (expiredResult > 0) {
        log('info', '清理正常过期的Token', { count: expiredResult });
        total += expiredResult;
      }
    } else {
      log('info', '使用基本清理模式（未检测到 is_revoked 字段）');
      const result = await db('yggdrasil_tokens')
        .where('expires_at', '<', db.fn.now())
        .delete();
      if (result > 0) {
        log('info', '清理过期Token', { count: result });
        total = result;
      }
    }
    if (total > 0) {
      log('info', 'Token清理总计', { total });
    }
    return total;
  } catch (error) {
    log('error', '清理过期Token失败', { error: error.message });
    return 0;
  }
}

function buildAuthResponse(profile, accessToken, clientToken) {
  log('debug', '构建认证成功响应', { playerName: profile.player_name, profileId: profile.id });
  return {
    accessToken,
    clientToken: clientToken || profile.client_token,
    availableProfiles: [
      {
        id: formatUuid(profile.uuid),
        name: profile.player_name,
        legacy: false
      }
    ],
    selectedProfile: {
      id: formatUuid(profile.uuid),
      name: profile.player_name
    },
    user: {
      id: crypto.createHash('md5').update(String(profile.user_id)).digest('hex'),
      properties: []
    }
  };
}

function buildErrorResponse(errorType, errorMessage) {
  log('warn', '构建错误响应', { errorType, errorMessage });
  return {
    error: errorType,
    errorMessage: errorMessage
  };
}

async function recordExists(table, column, value) {
  log('debug', '检查记录是否存在', { table, column, value });
  const row = await getDbInstance()(table)
    .where(column, value)
    .first(1);
  
  const exists = !!row;
  log('debug', '记录存在性检查结果', { table, column, value, exists });
  return exists;
}

async function isUnique(table, column, value, excludeId = null) {
  let query = getDbInstance()(table).where(column, value);
  if (excludeId) {
    query = query.whereNot('id', excludeId);
  }
  const row = await query.first(1);
  const unique = !row;
  log('debug', '唯一性检查', { table, column, value, excludeId, isUnique: unique });
  return unique;
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateClientToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  generateUuidV4,
  formatUuid,
  encodeTextures,
  isValidPlayerName,
  validatePasswordStrength,
  calculatePasswordStrength,
  createFileHash,
  auditLog,
  getProfileByUuid,
  getProfileByName,
  getProfilesByUserId,
  getProfileById,
  saveTokens,
  findTokenByAccessToken,
  findTokenByRefreshToken,
  isTokenTemporarilyInvalidated,
  markTokensAsTemporarilyInvalidated,
  invalidateAllTokens,
  invalidateToken,
  cleanupExpiredTokens,
  buildAuthResponse,
  buildErrorResponse,
  recordExists,
  isUnique,
  signData,
  getSignaturePublicKey
};
