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
    privateKeyCache = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
    return privateKeyCache;
  }
  return null;
}

/**
 * 加载 RSA 公钥
 */
function loadPublicKey() {
  if (publicKeyCache) return publicKeyCache;
  if (fs.existsSync(PUBLIC_KEY_PATH)) {
    publicKeyCache = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
    return publicKeyCache;
  }
  return null;
}

/**
 * 对数据进行 RSA-SHA1 签名（规范要求 SHA1withRSA）
 */
function signData(data) {
  const privateKey = loadPrivateKey();
  if (!privateKey) {
    console.warn('[Yggdrasil] 私钥不存在，跳过签名');
    return null;
  }
  
  try {
    const sign = crypto.createSign('RSA-SHA1');
    sign.update(data);
    sign.end();
    return sign.sign(privateKey, 'base64');
  } catch (error) {
    console.error('[Yggdrasil] 签名失败:', error);
    return null;
  }
}

/**
 * 获取公钥字符串
 */
function getSignaturePublicKey() {
  const publicKey = loadPublicKey();
  if (!publicKey) return null;
  return publicKey;
}

const ACCESS_TOKEN_EXPIRES_IN = '7d';
const REFRESH_TOKEN_EXPIRES_IN = '30d';

function generateAccessToken(profile) {
  const randomPart = crypto.randomBytes(32).toString('hex');
  const timestamp = Date.now().toString(36);
  return `ygg_${randomPart}_${timestamp}`;
}

function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

function generateClientToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'yueshe-yggdrasil',
      audience: 'minecraft'
    });
    return { valid: true, decoded };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token expired' };
    }
    return { valid: false, error: 'Invalid token' };
  }
}

async function hashPassword(password) {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
}

async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

function generateUuidV4() {
  return crypto.randomUUID();
}

function formatUuid(uuid) {
  if (!uuid) return null;
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
  
  // 对纹理数据进行签名
  const signature = signData(base64Value);
  
  return { value: base64Value, signature };
}

function isValidPlayerName(name) {
  if (!name || typeof name !== 'string') return false;
  
  const trimmedName = name.trim();
  
  if (trimmedName.length < 3 || trimmedName.length > 16) return false;
  
  if (/^\d/.test(trimmedName)) return false;
  
  const validPattern = /^[a-zA-Z0-9_]+$/;
  if (!validPattern.test(trimmedName)) return false;

  const reservedNames = ['steve', 'alex', 'notch', 'mojang'];
  if (reservedNames.includes(trimmedName.toLowerCase())) return false;

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

  return {
    valid: errors.length === 0,
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
  return crypto.createHash('sha256').update(buffer).digest('hex');
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
  } catch (error) {
    console.error('审计日志记录失败:', error.message);
  }
}

async function getProfileByUuid(uuid) {
  const normalizedUuid = uuid.replace(/-/g, '');
  
  // 使用参数化查询替代 whereRaw，避免潜在的SQL注入风险
  // 在应用层处理UUID格式，然后使用标准 where 查询
  const row = await getDbInstance()('mc_profiles')
    .whereRaw("REPLACE(uuid, '-', '') = ?", [normalizedUuid])
    .where({ is_banned: 0, is_deleted: 0 })
    .first();

  return row || null;
}

async function getProfileByName(playerName) {
  const row = await getDbInstance()('mc_profiles')
    .where({ player_name: playerName, is_banned: 0, is_deleted: 0 })
    .first();

  return row || null;
}

async function getProfilesByUserId(userId) {
  const rows = await getDbInstance()('mc_profiles')
    .select('id', 'player_name', 'uuid', 'skin_url', 'cape_url', 'skin_model', 'is_banned', 'created_at', 'updated_at', 'last_name_change_at')
    .where({ user_id: userId, is_deleted: 0 })
    .orderBy('created_at', 'desc');

  return rows;
}

async function getProfileById(profileId) {
  const row = await getDbInstance()('mc_profiles')
    .where({ id: profileId })
    .first();

  return row || null;
}

/**
 * 保存 Token - 使用事务确保数据一致性，并修复竞态条件
 * @param {number} profileId - MC角色ID
 * @param {string} accessToken - 访问令牌
 * @param {string} refreshToken - 刷新令牌
 * @param {string} clientToken - 客户端标识符
 * @param {string} ipAddress - IP地址
 * @param {string} userAgent - 用户代理
 */
async function saveTokens(profileId, accessToken, refreshToken, clientToken, ipAddress = null, userAgent = null) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const db = getDbInstance();
  const MAX_TOKENS = 10;
  
  // 使用事务包裹所有操作，确保原子性
  await db.transaction(async (trx) => {
    // 在事务内查询和删除，避免竞态条件
    const countResult = await trx('yggdrasil_tokens')
      .where('profile_id', profileId)
      .where('expires_at', '>', trx.fn.now())
      .count('* as count')
      .first();
    
    const count = parseInt(countResult.count);
    
    if (count >= MAX_TOKENS) {
      // 删除最旧的令牌
      const oldTokens = await trx('yggdrasil_tokens')
        .select('id')
        .where('profile_id', profileId)
        .where('expires_at', '>', trx.fn.now())
        .orderBy('created_at', 'asc')
        .limit(count - MAX_TOKENS + 1);
      
      if (oldTokens.length > 0) {
        const idsToDelete = oldTokens.map(t => t.id);
        await trx('yggdrasil_tokens').whereIn('id', idsToDelete).delete();
        console.log(`[Yggdrasil] 角色 ${profileId} 令牌数量超过限制，已删除 ${oldTokens.length} 个旧令牌`);
      }
    }

    // 插入新令牌
    await trx('yggdrasil_tokens').insert({
      profile_id: profileId,
      access_token: accessToken,
      refresh_token: refreshToken,
      client_token: clientToken,
      expires_at: expiresAt,
      ip_address: ipAddress,
      user_agent: userAgent
    });
  });
}

async function findTokenByAccessToken(accessToken) {
  const row = await getDbInstance()('yggdrasil_tokens as t')
    .join('mc_profiles as p', 't.profile_id', 'p.id')
    .where('t.access_token', accessToken)
    .where('t.expires_at', '>', getDbInstance().fn.now())
    .orderBy('t.created_at', 'desc')
    .first();

  return row || null;
}

async function findTokenByRefreshToken(refreshToken) {
  const row = await getDbInstance()('yggdrasil_tokens as t')
    .join('mc_profiles as p', 't.profile_id', 'p.id')
    .where('t.refresh_token', refreshToken)
    .where('t.expires_at', '>', getDbInstance().fn.now())
    .first();

  return row || null;
}

// 检查 Token 是否暂时失效（角色改名后）
async function isTokenTemporarilyInvalidated(accessToken) {
  const row = await getDbInstance()('yggdrasil_tokens')
    .select('is_temporarily_invalidated')
    .where('access_token', accessToken)
    .where('expires_at', '>', getDbInstance().fn.now())
    .first();

  return row?.is_temporarily_invalidated === 1;
}

// 将角色的所有 Token 标记为暂时失效（角色改名后调用）
async function markTokensAsTemporarilyInvalidated(profileId) {
  const result = await getDbInstance()('yggdrasil_tokens')
    .where('profile_id', profileId)
    .where('expires_at', '>', getDbInstance().fn.now())
    .update({ is_temporarily_invalidated: 1 });

  console.log(`[Yggdrasil] 角色 ${profileId} 的 ${result} 个 Token 被标记为暂时失效`);
  return result;
}

async function invalidateAllTokens(profileId) {
  const result = await getDbInstance()('yggdrasil_tokens')
    .where('profile_id', profileId)
    .delete();

  return result;
}

async function invalidateToken(accessToken) {
  const result = await getDbInstance()('yggdrasil_tokens')
    .where('access_token', accessToken)
    .delete();

  return result > 0;
}

async function cleanupExpiredTokens() {
  try {
    const result = await getDbInstance()('yggdrasil_tokens')
      .where('expires_at', '<', getDbInstance().fn.now())
      .delete();

    console.log(`清理了 ${result} 个过期Token`);
    return result;
  } catch (error) {
    console.error('[Yggdrasil] 初始清理过期 Token 失败:', error.message);
    return 0;
  }
}

function buildAuthResponse(profile, accessToken, clientToken) {
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
  return {
    error: errorType,
    errorMessage: errorMessage
  };
}

async function recordExists(table, column, value) {
  const row = await getDbInstance()(table)
    .where(column, value)
    .first(1);
  
  return !!row;
}

async function isUnique(table, column, value, excludeId = null) {
  let query = getDbInstance()(table).where(column, value);

  if (excludeId) {
    query = query.whereNot('id', excludeId);
  }

  const row = await query.first(1);
  return !row;
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
