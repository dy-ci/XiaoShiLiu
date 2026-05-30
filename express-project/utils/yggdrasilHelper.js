/**
 * 悦社社区 - Yggdrasil API 工具函数库
 * 提供 Token 管理、密码加密、UUID 生成、纹理编码等核心功能
 * 
 * @author zhaishis
 * @version v1.0.0
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/config');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

const ACCESS_TOKEN_EXPIRES_IN = '7d';
const REFRESH_TOKEN_EXPIRES_IN = '30d';

function generateAccessToken(profile) {
  const payload = {
    sub: profile.uuid.replace(/-/g, ''),
    typ: 'access_token',
    pid: profile.id,
    name: profile.player_name
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    issuer: 'yueshe-yggdrasil',
    audience: 'minecraft'
  });
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

  return Buffer.from(JSON.stringify(payload)).toString('base64');
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
    `SELECT * FROM mc_profiles WHERE player_name = ? AND is_banned = 0`,
    [playerName]
  );

  return rows[0] || null;
}

async function getProfilesByUserId(userId) {
  const [rows] = await pool.execute(
    `SELECT id, player_name, uuid, skin_url, cape_url, skin_model, is_banned, created_at, updated_at
     FROM mc_profiles 
     WHERE user_id = ?
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
  invalidateAllTokens,
  invalidateToken,
  cleanupExpiredTokens,
  buildAuthResponse,
  buildErrorResponse,
  recordExists,
  isUnique
};
