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
const { pool } = require('../config/config');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

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
 * 对数据进行 RSA-SHA256 签名
 * @param {string} data - 要签名的数据（base64 编码的纹理数据）
 * @returns {string|null} - 签名结果（base64 编码），如果私钥不存在则返回 null
 */
function signData(data) {
  const privateKey = loadPrivateKey();
  if (!privateKey) {
    console.warn('[Yggdrasil] 私钥不存在，跳过签名');
    return null;
  }
  
  try {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(data);
    sign.end();
    return sign.sign(privateKey, 'base64');
  } catch (error) {
    console.error('[Yggdrasil] 签名失败:', error);
    return null;
  }
}

/**
 * 获取公钥字符串（用于 API 元数据）
 * 规范要求返回完整 PEM 格式（含头尾标记）
 * @returns {string|null} - 完整 PEM 格式公钥，如果不存在则返回 null
 */
function getSignaturePublicKey() {
  const publicKey = loadPublicKey();
  if (!publicKey) return null;
  return publicKey;
}

const ACCESS_TOKEN_EXPIRES_IN = '7d';
const REFRESH_TOKEN_EXPIRES_IN = '30d';

function generateAccessToken(profile) {
  // 使用随机字符串代替 JWT，避免 token 过长
  // 格式: ygg_ + 32位随机字符串 + 时间戳
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
    await pool.execute(
      `INSERT INTO mc_audit_logs (user_id, profile_id, action, ip_address, details)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, profileId, action, ipAddress, details ? JSON.stringify(details) : null]
    );
  } catch (error) {
    console.error('审计日志记录失败:', error.message);
  }
}

async function getProfileByUuid(uuid) {
  const normalizedUuid = uuid.replace(/-/g, '');
  
  const [rows] = await pool.execute(
    `SELECT * FROM mc_profiles WHERE REPLACE(uuid, '-', '') = ? AND is_banned = 0`,
    [normalizedUuid]
  );

  return rows[0] || null;
}

async function getProfileByName(playerName) {
  const [rows] = await pool.execute(
    `SELECT * FROM mc_profiles WHERE player_name = ? AND is_banned = 0 AND is_deleted = 0`,
    [playerName]
  );

  return rows[0] || null;
}

async function getProfilesByUserId(userId) {
  const [rows] = await pool.execute(
    `SELECT id, player_name, uuid, skin_url, cape_url, skin_model, is_banned, created_at, updated_at
     FROM mc_profiles 
     WHERE user_id = ? AND is_deleted = 0
     ORDER BY created_at DESC`,
    [userId]
  );

  return rows;
}

async function getProfileById(profileId) {
  const [rows] = await pool.execute(
    `SELECT * FROM mc_profiles WHERE id = ?`,
    [profileId]
  );

  return rows[0] || null;
}

async function saveTokens(profileId, accessToken, refreshToken, clientToken, ipAddress = null, userAgent = null) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  
  // 检查该角色的令牌数量，超过 10 个则删除最旧的
  const MAX_TOKENS = 10;
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) as count FROM yggdrasil_tokens WHERE profile_id = ? AND expires_at > NOW()`,
    [profileId]
  );
  
  if (countRows[0].count >= MAX_TOKENS) {
    // 删除最旧的令牌
    const [oldTokens] = await pool.execute(
      `SELECT id FROM yggdrasil_tokens WHERE profile_id = ? AND expires_at > NOW() ORDER BY created_at ASC LIMIT ?`,
      [profileId, countRows[0].count - MAX_TOKENS + 1]
    );
    
    if (oldTokens.length > 0) {
      const idsToDelete = oldTokens.map(t => t.id);
      await pool.execute(
        `DELETE FROM yggdrasil_tokens WHERE id IN (${idsToDelete.map(() => '?').join(',')})`,
        idsToDelete
      );
      console.log(`[Yggdrasil] 角色 ${profileId} 令牌数量超过限制，已删除 ${oldTokens.length} 个旧令牌`);
    }
  }

  await pool.execute(
    `INSERT INTO yggdrasil_tokens (profile_id, access_token, refresh_token, client_token, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [profileId, accessToken, refreshToken, clientToken, expiresAt, ipAddress, userAgent]
  );
}

async function findTokenByAccessToken(accessToken) {
  const [rows] = await pool.execute(
    `SELECT t.*, p.*
     FROM yggdrasil_tokens t
     JOIN mc_profiles p ON t.profile_id = p.id
     WHERE t.access_token = ? AND t.expires_at > NOW()
     ORDER BY t.created_at DESC
     LIMIT 1`,
    [accessToken]
  );

  return rows[0] || null;
}

async function findTokenByRefreshToken(refreshToken) {
  const [rows] = await pool.execute(
    `SELECT t.*, p.*
     FROM yggdrasil_tokens t
     JOIN mc_profiles p ON t.profile_id = p.id
     WHERE t.refresh_token = ? AND t.expires_at > NOW()
     LIMIT 1`,
    [refreshToken]
  );

  return rows[0] || null;
}

// 检查 Token 是否暂时失效（角色改名后）
async function isTokenTemporarilyInvalidated(accessToken) {
  const [rows] = await pool.execute(
    `SELECT is_temporarily_invalidated FROM yggdrasil_tokens
     WHERE access_token = ? AND expires_at > NOW()
     LIMIT 1`,
    [accessToken]
  );

  return rows[0]?.is_temporarily_invalidated === 1;
}

// 将角色的所有 Token 标记为暂时失效（角色改名后调用）
async function markTokensAsTemporarilyInvalidated(profileId) {
  const [result] = await pool.execute(
    `UPDATE yggdrasil_tokens 
     SET is_temporarily_invalidated = 1 
     WHERE profile_id = ? AND expires_at > NOW()`,
    [profileId]
  );

  console.log(`[Yggdrasil] 角色 ${profileId} 的 ${result.affectedRows} 个 Token 被标记为暂时失效`);
  return result.affectedRows;
}

async function invalidateAllTokens(profileId) {
  const [result] = await pool.execute(
    `DELETE FROM yggdrasil_tokens WHERE profile_id = ?`,
    [profileId]
  );

  return result.affectedRows;
}

async function invalidateToken(accessToken) {
  const [result] = await pool.execute(
    `DELETE FROM yggdrasil_tokens WHERE access_token = ?`,
    [accessToken]
  );

  return result.affectedRows > 0;
}

async function cleanupExpiredTokens() {
  const [result] = await pool.execute(
    `DELETE FROM yggdrasil_tokens WHERE expires_at < NOW()`
  );

  console.log(`清理了 ${result.affectedRows} 个过期Token`);
  return result.affectedRows;
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
  const [rows] = await pool.execute(
    `SELECT 1 FROM \`${table}\` WHERE \`${column}\` = ? LIMIT 1`,
    [value]
  );
  return rows.length > 0;
}

async function isUnique(table, column, value, excludeId = null) {
  let sql = `SELECT 1 FROM \`${table}\` WHERE \`${column}\` = ?`;
  const params = [value];

  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }

  sql += ' LIMIT 1';

  const [rows] = await pool.execute(sql, params);
  return rows.length === 0;
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
