/**
 * 悦社社区 - 游戏管理 API 路由
 * 提供角色CRUD、皮肤/披风管理等接口
 * 供前端Web页面调用（需要社区JWT认证）
 * 
 * @author zhaishis
 * @version v1.1.0
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const axios = require('axios');
const sharp = require('sharp');
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants');
const { authenticateToken } = require('../middleware/auth');
const { uploadImage } = require('../utils/uploadHelper');
const {
  getProfilesByUserId,
  getProfileById,
  isValidPlayerName,
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
  generateUuidV4,
  createFileHash,
  auditLog,
  recordExists,
  isUnique,
  markTokensAsTemporarilyInvalidated,
  invalidateAllTokens
} = require('../utils/yggdrasilHelper');
const { getDB } = require('../utils/db');

const MAX_PROFILES_PER_USER = parseInt(process.env.MAX_PROFILES_PER_USER) || 1;
const MAX_WARDROBE_ITEMS = parseInt(process.env.MAX_WARDROBE_ITEMS) || 10;
const SKIN_MAX_SIZE = 500 * 1024;

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: SKIN_MAX_SIZE
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('只支持PNG格式的图片文件'), false);
    }
  }
});

/**
 * 安全获取 .returning() 的结果 ID
 * 兼容 PostgreSQL（返回 [{id: x}]）和 SQLite（返回 [x]）的不同格式
 */
function extractReturningId(returningResult) {
  if (returningResult == null) return null;
  
  if (Array.isArray(returningResult)) {
    if (returningResult.length === 0) return null;
    const first = returningResult[0];
    // PostgreSQL: [{id: 1}] => first 是对象
    if (first && typeof first === 'object') {
      return first.id != null ? first.id : null;
    }
    // SQLite: [1] => first 是数字
    return first != null ? Number(first) : null;
  }
  
  if (typeof returningResult === 'object') {
    return returningResult.id != null ? returningResult.id : null;
  }
  
  // 直接返回数字
  return Number(returningResult) || null;
}

/**
 * 安全比较用户 ID（兼容字符串和数字类型）
 * PostgreSQL 的 BIGINT 在 JS 中可能返回字符串
 */
function matchUserId(profileUserId, reqUserId) {
  return String(profileUserId) === String(reqUserId);
}

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '用户认证信息无效，请重新登录'
      });
    }

    const profiles = await getProfilesByUserId(req.user.id);

    // 计算每个角色的下次可修改时间
    const oneMonthInMs = 30 * 24 * 60 * 60 * 1000;

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: profiles.map(p => {
        // 计算下次可修改名字的时间
        let nextAllowedChange = null;
        let canChangeName = true;

        if (p.last_name_change_at) {
          const lastChangeTime = new Date(p.last_name_change_at).getTime();
          const nextChangeTime = lastChangeTime + oneMonthInMs;

          if (Date.now() < nextChangeTime) {
            nextAllowedChange = new Date(nextChangeTime).toISOString();
            canChangeName = false;
          }
        }

        return {
          id: p.id,
          player_name: p.player_name,
          uuid: p.uuid,
          skin_url: p.skin_url,
          cape_url: p.cape_url,
          skin_model: p.skin_model,
          is_banned: p.is_banned,
          created_at: p.created_at,
          updated_at: p.updated_at,
          last_name_change_at: p.last_name_change_at,
          next_allowed_name_change: nextAllowedChange,
          can_change_name: canChangeName
        };
      }),
      message: '获取成功'
    });
  } catch (error) {
    console.error('[Game] 获取角色列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误'
    });
  }
});

router.post('/profile/create', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '用户认证信息无效，请重新登录'
      });
    }

    const { player_name, password } = req.body;

    if (!player_name || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '玩家名称和密码不能为空'
      });
    }

    if (!isValidPlayerName(player_name)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '玩家名称不符合规范：3-16位字符，仅允许字母数字下划线，不能以数字开头'
      });
    }

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: `密码强度不足：${passwordValidation.errors.join('；')}`
      });
    }

    const db = getDB();
    const userId = Number(req.user.id);

    const [countResult] = await db('mc_profiles')
      .where({ user_id: userId, is_deleted: 0 })
      .count('* as count');

    if (parseInt(countResult.count) >= MAX_PROFILES_PER_USER) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: `每个用户最多创建 ${MAX_PROFILES_PER_USER} 个角色`
      });
    }

    const nameExists = await recordExists('mc_profiles', 'player_name', player_name.trim());
    if (nameExists) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '该玩家名称已被使用'
      });
    }

    const uuid = generateUuidV4();
    const passwordHash = await hashPassword(password);

    console.log(`[Game] 创建角色 - userId: ${userId}, playerName: ${player_name}`);

    // 验证用户是否存在
    const userCheck = await db('users')
      .where({ id: userId })
      .select('id');

    if (!userCheck || userCheck.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '当前用户不存在，请重新登录'
      });
    }

    // 使用 .returning('id') 获取自增ID
    // PostgreSQL 返回 [{id: xxx}]，SQLite 可能返回 [xxx]
    const insertResult = await db('mc_profiles')
      .insert({
        user_id: userId,
        player_name: player_name.trim(),
        uuid,
        password_hash: passwordHash
      })
      .returning('id');

    const profileId = extractReturningId(insertResult);
    if (!profileId) {
      throw new Error('创建角色失败：无法获取角色ID');
    }

    await auditLog('PROFILE_CREATE', userId, profileId, req.ip, {
      player_name: player_name.trim(),
      uuid
    });

    console.log(`[Game] 用户 ${userId} 创建角色成功: ${player_name} (profileId: ${profileId})`);

    res.status(HTTP_STATUS.CREATED).json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        id: profileId,
        player_name: player_name.trim(),
        uuid
      },
      message: '角色创建成功！请牢记您的独立密码'
    });

  } catch (error) {
    console.error('[Game] 创建角色失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '创建失败，请稍后重试'
    });
  }
});

router.put('/profile/:id/name', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '用户认证信息无效，请重新登录'
      });
    }

    const profileId = parseInt(req.params.id);
    const { new_name } = req.body;

    if (!new_name) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '新名称不能为空'
      });
    }

    if (!isValidPlayerName(new_name)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '玩家名称不符合规范'
      });
    }

    const profile = await getProfileById(profileId);

    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    // 检查名字修改频率限制（一个月只能修改一次）
    if (profile.last_name_change_at) {
      const lastChangeTime = new Date(profile.last_name_change_at).getTime();
      const currentTime = Date.now();
      const oneMonthInMs = 30 * 24 * 60 * 60 * 1000; // 30天的毫秒数

      const timeDiff = currentTime - lastChangeTime;
      if (timeDiff < oneMonthInMs) {
        const daysRemaining = Math.ceil((oneMonthInMs - timeDiff) / (24 * 60 * 60 * 1000));
        return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          code: RESPONSE_CODES.VALIDATION_ERROR,
          message: `修改过于频繁，请等待 ${daysRemaining} 天后再修改`,
          data: {
            next_allowed_date: new Date(lastChangeTime + oneMonthInMs).toISOString(),
            days_remaining: daysRemaining
          }
        });
      }
    }

    const nameExists = await isUnique('mc_profiles', 'player_name', new_name.trim(), profileId);
    if (!nameExists) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '该玩家名称已被使用'
      });
    }

    const oldName = profile.player_name;

    const db = getDB();

    // 使用事务确保数据一致性
    await db.transaction(async (trx) => {
      // 更新角色名字和最后修改时间
      await trx('mc_profiles')
        .where({ id: profileId })
        .update({
          player_name: new_name.trim(),
          last_name_change_at: new Date()
        });

      // 记录名字修改历史
      await trx('mc_name_history').insert({
        profile_id: profileId,
        user_id: req.user.id,
        old_name: oldName,
        new_name: new_name.trim(),
        ip_address: req.ip
      });
    });

    // 角色改名后，将该角色的所有 Token 标记为暂时失效
    await markTokensAsTemporarilyInvalidated(profileId);

    await auditLog('NAME_CHANGE', req.user.id, profileId, req.ip, {
      old_name: oldName,
      new_name: new_name.trim()
    });

    console.log(`[Game] 角色 ${oldName} 改名为 ${new_name}，相关 Token 已标记为暂时失效`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { old_name: oldName, new_name: new_name.trim() },
      message: '名称修改成功，请使用新名称重新登录游戏'
    });

  } catch (error) {
    console.error('[Game] 修改名称失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '修改失败'
    });
  }
});

// ========== 查询名字修改历史 ==========
router.get('/profile/:id/name-history', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '用户认证信息无效，请重新登录'
      });
    }

    const profileId = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // 验证角色归属
    const profile = await getProfileById(profileId);

    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权查看此角色的信息'
      });
    }

    const db = getDB();

    // 查询名字修改历史
    const historyRecords = await db('mc_name_history')
      .where({ profile_id: profileId })
      .select('id', 'old_name', 'new_name', 'ip_address', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 获取总数
    const countResult = await db('mc_name_history')
      .where({ profile_id: profileId })
      .count('* as total')
      .first();
    const total = parseInt(countResult.total);

    // 计算下次可修改时间
    let nextAllowedChange = null;
    if (profile.last_name_change_at) {
      const lastChangeTime = new Date(profile.last_name_change_at).getTime();
      const oneMonthInMs = 30 * 24 * 60 * 60 * 1000;
      const nextChangeTime = lastChangeTime + oneMonthInMs;

      if (Date.now() < nextChangeTime) {
        nextAllowedChange = new Date(nextChangeTime).toISOString();
      }
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        history: historyRecords,
        last_name_change_at: profile.last_name_change_at,
        next_allowed_change: nextAllowedChange,
        total_changes: total,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      },
      message: '获取成功'
    });

  } catch (error) {
    console.error('[Game] 获取名字修改历史失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误'
    });
  }
});

// ========== 删除角色（软删除） ==========
router.delete('/profile/:id', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '用户认证信息无效，请重新登录'
      });
    }

    const profileId = parseInt(req.params.id);

    const profile = await getProfileById(profileId);

    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    if (profile.is_deleted) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '角色已被删除'
      });
    }

    const db = getDB();
    await db('mc_profiles')
      .where({ id: profileId })
      .update({ is_deleted: 1, skin_url: null, cape_url: null });

    // 吊销该角色的所有令牌
    await invalidateAllTokens(profileId);

    await auditLog('PROFILE_DELETE', req.user.id, profileId, req.ip, {
      player_name: profile.player_name,
      uuid: profile.uuid
    });

    console.log(`[Game] 角色 ${profile.player_name} 已软删除`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '角色已删除'
    });

  } catch (error) {
    console.error('[Game] 删除角色错误:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '删除失败'
    });
  }
});

router.put('/profile/:id/password', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '用户认证信息无效，请重新登录'
      });
    }

    const profileId = parseInt(req.params.id);
    const { old_password, new_password } = req.body;

    if (!old_password || !new_password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '旧密码和新密码不能为空'
      });
    }

    const passwordValidation = validatePasswordStrength(new_password);
    if (!passwordValidation.valid) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: `新密码强度不足：${passwordValidation.errors.join('；')}`
      });
    }

    const profile = await getProfileById(profileId);

    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    const valid = await verifyPassword(old_password, profile.password_hash);
    if (!valid) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '旧密码错误'
      });
    }

    const newPasswordHash = await hashPassword(new_password);

    const db = getDB();
    await db('mc_profiles')
      .where({ id: profileId })
      .update({ password_hash: newPasswordHash });

    await auditLog('PASSWORD_CHANGE', req.user.id, profileId, req.ip);

    console.log(`[Game] 角色 ${profile.player_name} 密码修改成功`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '密码修改成功'
    });

  } catch (error) {
    console.error('[Game] 修改密码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '修改失败'
    });
  }
});

router.post('/profile/:id/skin', authenticateToken, upload.single('skin'), async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '用户认证信息无效，请重新登录'
      });
    }

    const profileId = parseInt(req.params.id);
    const model = req.body.model || 'classic';

    if (!['classic', 'slim'].includes(model)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '无效的模型类型，必须是 classic 或 slim'
      });
    }

    const profile = await getProfileById(profileId);

    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    if (!req.file) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '请选择皮肤文件'
      });
    }

    if (req.file.mimetype !== 'image/png') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '只支持PNG格式的皮肤文件'
      });
    }

    // 安全处理：去除所有元数据，防止 PNG Bomb 和恶意代码
    let processedBuffer;
    try {
      processedBuffer = await sharp(req.file.buffer)
        .png()
        .toBuffer();
    } catch (error) {
      console.error('[Game] 皮肤处理失败:', error);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '皮肤文件处理失败'
      });
    }

    // 使用完整 hash 作为文件名（规范要求：文件名必须是材质 hash，不带扩展名）
    const textureHash = createFileHash(processedBuffer);
    const fileName = textureHash;
    const result = await uploadImage(processedBuffer, fileName, 'image/png');

    if (!result.success) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        code: RESPONSE_CODES.ERROR,
        message: result.message || '皮肤上传失败'
      });
    }

    const db = getDB();
    await db('mc_profiles')
      .where({ id: profileId })
      .update({ skin_url: result.url, skin_model: model });

    await db.raw(
      `INSERT INTO mc_textures (profile_id, texture_type, texture_hash, url, metadata)
       VALUES (?, 'skin', ?, ?, ?)
       ON CONFLICT (profile_id, texture_type) DO NOTHING`,
      [profileId, textureHash, result.url, JSON.stringify({ size: req.file.size, model })]
    );

    await auditLog('SKIN_UPLOAD', req.user.id, profileId, req.ip, {
      url: result.url,
      model,
      size: req.file.size
    });

    console.log(`[Game] 角色 ${profile.player_name} 皮肤上传成功`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        skin_url: result.url,
        model
      },
      message: '皮肤上传成功'
    });

  } catch (error) {
    console.error('[Game] 上传皮肤失败:', error);

    if (error.message === '只支持PNG格式的图片文件' || error.message === 'File too large') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: error.message
      });
    }

    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '上传失败，请稍后重试'
    });
  }
});

router.delete('/profile/:id/skin', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '用户认证信息无效，请重新登录'
      });
    }

    const profileId = parseInt(req.params.id);

    const profile = await getProfileById(profileId);

    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    const db = getDB();
    await db('mc_profiles')
      .where({ id: profileId })
      .update({ skin_url: null, skin_model: 'classic' });

    await auditLog('SKIN_DELETE', req.user.id, profileId, req.ip);

    console.log(`[Game] 角色 ${profile.player_name} 皮肤已删除`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '皮肤已删除，将使用默认皮肤'
    });

  } catch (error) {
    console.error('[Game] 删除皮肤失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '删除失败'
    });
  }
});

router.post('/profile/:id/cape', authenticateToken, upload.single('cape'), async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '用户认证信息无效，请重新登录'
      });
    }

    const profileId = parseInt(req.params.id);

    const profile = await getProfileById(profileId);

    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    if (!req.file) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '请选择披风文件'
      });
    }

    if (req.file.mimetype !== 'image/png') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '只支持PNG格式的披风文件'
      });
    }

    // 安全处理：去除所有元数据，防止 PNG Bomb 和恶意代码
    let processedBuffer;
    try {
      processedBuffer = await sharp(req.file.buffer)
        .png()
        .toBuffer();
    } catch (error) {
      console.error('[Game] 披风处理失败:', error);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '披风文件处理失败'
      });
    }

    // 使用完整 hash 作为文件名（规范要求：文件名必须是材质 hash，不带扩展名）
    const textureHash = createFileHash(processedBuffer);
    const fileName = textureHash;
    const result = await uploadImage(processedBuffer, fileName, 'image/png');

    if (!result.success) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        code: RESPONSE_CODES.ERROR,
        message: result.message || '披风上传失败'
      });
    }

    const db = getDB();
    await db('mc_profiles')
      .where({ id: profileId })
      .update({ cape_url: result.url });

    await db.raw(
      `INSERT INTO mc_textures (profile_id, texture_type, texture_hash, url, metadata)
       VALUES (?, 'cape', ?, ?, ?)
       ON CONFLICT (profile_id, texture_type) DO NOTHING`,
      [profileId, textureHash, result.url, JSON.stringify({ size: req.file.size })]
    );

    await auditLog('CAPE_UPLOAD', req.user.id, profileId, req.ip, {
      url: result.url,
      size: req.file.size
    });

    console.log(`[Game] 角色 ${profile.player_name} 披风上传成功`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { cape_url: result.url },
      message: '披风上传成功'
    });

  } catch (error) {
    console.error('[Game] 上传披风失败:', error);

    if (error.message === '只支持PNG格式的图片文件' || error.message === 'File too large') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: error.message
      });
    }

    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '上传失败，请稍后重试'
    });
  }
});

router.delete('/profile/:id/cape', authenticateToken, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '用户认证信息无效，请重新登录'
      });
    }

    const profileId = parseInt(req.params.id);

    const profile = await getProfileById(profileId);

    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    const db = getDB();
    await db('mc_profiles')
      .where({ id: profileId })
      .update({ cape_url: null });

    await auditLog('CAPE_DELETE', req.user.id, profileId, req.ip);

    console.log(`[Game] 角色 ${profile.player_name} 披风已删除`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '披风已删除'
    });

  } catch (error) {
    console.error('[Game] 删除披风失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '删除失败'
    });
  }
});

router.get('/config', async (req, res) => {
  try {
    const baseUrl = process.env.API_BASE_URL || `${req.protocol}://${req.get('host')}`;

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        yggdrasil_api_root: `${baseUrl}/api/yggdrasil`,
        server_name: '悦社社区',
        max_profiles_per_user: MAX_PROFILES_PER_USER,
        skin_max_size: '500KB',
        supported_skin_models: ['classic', 'slim']
      },
      message: '获取成功'
    });
  } catch (error) {
    console.error('[Game] 获取配置失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '获取配置失败'
    });
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: `文件大小超过限制（最大 ${SKIN_MAX_SIZE / 1024}KB）`
      });
    }
  }

  if (error.message && (
    error.message.includes('只支持PNG格式') ||
    error.message.includes('File too large')
  )) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      code: RESPONSE_CODES.VALIDATION_ERROR,
      message: error.message
    });
  }

  console.error('[Game] 中间件错误:', error);
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    code: RESPONSE_CODES.ERROR,
    message: '服务器内部错误'
  });
});

// ========== 皮肤图片代理（解决 CORS 跨域问题） ==========
// 用法: GET /api/game/skin-proxy?url=图片URL
router.get('/skin-proxy', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少 url 参数'
      });
    }

    console.log(`[Game] 皮肤代理请求: ${imageUrl.substring(0, 80)}...`);

    // 获取图片
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxContentLength: 2 * 1024 * 1024 // 限制 2MB
    });

    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 设置缓存
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 缓存一天

    // 判断 Content-Type
    const contentType = response.headers['content-type'] || 'image/png';
    res.setHeader('Content-Type', contentType);

    // 返回图片内容
    res.send(response.data);

    console.log(`[Game] 皮肤代理成功: ${response.data.length} bytes`);

  } catch (error) {
    console.error('[Game] 皮肤代理失败:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '图片获取失败'
    });
  }
});

// ========== 皮肤衣柜功能 ==========

// 获取衣柜列表
router.get('/profile/:id/wardrobe', authenticateToken, async (req, res) => {
  try {
    const profileId = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const profile = await getProfileById(profileId);
    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权查看此角色的信息'
      });
    }

    const db = getDB();

    const wardrobeItems = await db('mc_skin_wardrobe')
      .where({ profile_id: profileId, is_deleted: false })
      .select('id', 'name', 'skin_url', 'skin_model', 'cape_url', 'is_active', 'sort_order', 'created_at', 'updated_at')
      .orderBy('is_active', 'desc')
      .orderBy('sort_order', 'asc')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const countResult = await db('mc_skin_wardrobe')
      .where({ profile_id: profileId, is_deleted: false })
      .count('* as total')
      .first();
    const total = parseInt(countResult.total);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        wardrobe: wardrobeItems,
        total,
        max_wardrobes: MAX_WARDROBE_ITEMS,
        pagination: { page, limit, pages: Math.ceil(total / limit) }
      },
      message: '获取成功'
    });

  } catch (error) {
    console.error('[Game] 获取衣柜失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误'
    });
  }
});

// 添加皮肤到衣柜
router.post('/profile/:id/wardrobe', authenticateToken, upload.fields([
  { name: 'skin', maxCount: 1 },
  { name: 'cape', maxCount: 1 }
]), async (req, res) => {
  try {
    const profileId = parseInt(req.params.id);
    const { name, model } = req.body;

    if (!name || !name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '请输入这套皮肤的名称'
      });
    }

    const profile = await getProfileById(profileId);
    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    if (!req.files?.skin || req.files.skin.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '请选择皮肤文件'
      });
    }

    const skinFile = req.files.skin[0];
    if (skinFile.mimetype !== 'image/png') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '只支持PNG格式的皮肤文件'
      });
    }

    const skinModel = ['classic', 'slim'].includes(model) ? model : 'classic';
    const db = getDB();

    // 检查数量限制
    const [currentCount] = await db('mc_skin_wardrobe')
      .where({ profile_id: profileId, is_deleted: false })
      .count('* as count');

    if (parseInt(currentCount.count) >= MAX_WARDROBE_ITEMS) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: `衣柜已满，最多保存 ${MAX_WARDROBE_ITEMS} 套皮肤`
      });
    }

    // 检查名称重复
    const existingItem = await db('mc_skin_wardrobe')
      .where({ profile_id: profileId, name: name.trim(), is_deleted: false })
      .first();

    if (existingItem) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        code: RESPONSE_CODES.CONFLICT,
        message: '该名称已存在，请使用其他名称'
      });
    }

    // 处理皮肤
    let processedSkinBuffer;
    try {
      processedSkinBuffer = await sharp(skinFile.buffer)
        .png()
        .toBuffer();
    } catch (error) {
      console.error('[Game] 皮肤处理失败:', error);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '皮肤文件处理失败'
      });
    }

    const skinHash = createFileHash(processedSkinBuffer);
    const skinUploadResult = await uploadImage(processedSkinBuffer, skinHash, 'image/png');

    if (!skinUploadResult.success) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        code: RESPONSE_CODES.ERROR,
        message: skinUploadResult.message || '皮肤上传失败'
      });
    }

    // 处理披风（可选）
    let capeUrl = null;
    let capeHash = null;

    if (req.files?.cape && req.files.cape.length > 0) {
      const capeFile = req.files.cape[0];

      if (capeFile.mimetype !== 'image/png') {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          code: RESPONSE_CODES.VALIDATION_ERROR,
          message: '只支持PNG格式的披风文件'
        });
      }

      let processedCapeBuffer;
      try {
        processedCapeBuffer = await sharp(capeFile.buffer)
          .png()
          .toBuffer();
      } catch (error) {
        console.error('[Game] 披风处理失败:', error);
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          code: RESPONSE_CODES.VALIDATION_ERROR,
          message: '披风文件处理失败'
        });
      }

      capeHash = createFileHash(processedCapeBuffer);
      const capeUploadResult = await uploadImage(processedCapeBuffer, capeHash, 'image/png');
      if (capeUploadResult.success) {
        capeUrl = capeUploadResult.url;
      }
    }

    // 获取排序号
    const [maxSortResult] = await db('mc_skin_wardrobe')
      .where({ profile_id: profileId })
      .max('sort_order as max_sort');
    const nextSortOrder = (parseInt(maxSortResult.max_sort) || 0) + 1;

    // 插入记录
    const [newItemId] = await db('mc_skin_wardrobe').insert({
      profile_id: profileId,
      user_id: req.user.id,
      name: name.trim(),
      skin_url: skinUploadResult.url,
      skin_hash: skinHash,
      skin_model: skinModel,
      cape_url: capeUrl,
      cape_hash: capeHash,
      sort_order: nextSortOrder,
      is_active: false
    }).returning('id');

    await auditLog('WARDROBE_ADD', req.user.id, profileId, req.ip, {
      item_id: newItemId,
      name: name.trim(),
      has_cape: !!capeUrl
    });

    console.log(`[Game] 用户 ${req.user.id} 添加皮肤到衣柜: ${name.trim()}`);

    res.status(HTTP_STATUS.CREATED).json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        id: newItemId,
        name: name.trim(),
        skin_url: skinUploadResult.url,
        skin_model: skinModel,
        cape_url: capeUrl,
        is_active: false
      },
      message: '添加成功'
    });

  } catch (error) {
    console.error('[Game] 添加衣柜失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误'
    });
  }
});

// 更新衣柜项
router.put('/profile/:id/wardrobe/:itemId', authenticateToken, async (req, res) => {
  try {
    const profileId = parseInt(req.params.id);
    const itemId = parseInt(req.params.itemId);
    const { name, model } = req.body;

    const profile = await getProfileById(profileId);
    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    const db = getDB();

    const wardrobeItem = await db('mc_skin_wardrobe')
      .where({ id: itemId, profile_id: profileId, is_deleted: false })
      .first();

    if (!wardrobeItem) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '衣柜项不存在'
      });
    }

    const updateData = {};
    let hasUpdate = false;

    if (name && name.trim()) {
      const duplicateCheck = await db('mc_skin_wardrobe')
        .where({ profile_id: profileId, name: name.trim(), is_deleted: false })
        .whereNot('id', itemId)
        .first();

      if (duplicateCheck) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          code: RESPONSE_CODES.CONFLICT,
          message: '该名称已存在'
        });
      }

      updateData.name = name.trim();
      hasUpdate = true;
    }

    if (model && ['classic', 'slim'].includes(model)) {
      updateData.skin_model = model;
      hasUpdate = true;
    }

    if (!hasUpdate) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '没有需要更新的内容'
      });
    }

    await db('mc_skin_wardrobe')
      .where({ id: itemId })
      .update(updateData);

    // 如果是当前使用的皮肤且修改了模型，同步更新角色表
    if (wardrobeItem.is_active && updateData.skin_model) {
      await db('mc_profiles')
        .where({ id: profileId })
        .update({ skin_model: updateData.skin_model });
    }

    await auditLog('WARDROBE_UPDATE', req.user.id, profileId, req.ip, {
      item_id: itemId,
      changes: updateData
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { id: itemId, ...updateData },
      message: '更新成功'
    });

  } catch (error) {
    console.error('[Game] 更新衣柜失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误'
    });
  }
});

// 删除衣柜项
router.delete('/profile/:id/wardrobe/:itemId', authenticateToken, async (req, res) => {
  try {
    const profileId = parseInt(req.params.id);
    const itemId = parseInt(req.params.itemId);

    const profile = await getProfileById(profileId);
    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    const db = getDB();

    const wardrobeItem = await db('mc_skin_wardrobe')
      .where({ id: itemId, profile_id: profileId, is_deleted: false })
      .first();

    if (!wardrobeItem) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '衣柜项不存在'
      });
    }

    if (wardrobeItem.is_active) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '不能删除当前使用的皮肤，请先切换到其他皮肤'
      });
    }

    await db('mc_skin_wardrobe')
      .where({ id: itemId })
      .update({ is_deleted: true });

    await auditLog('WARDROBE_DELETE', req.user.id, profileId, req.ip, {
      item_id: itemId,
      name: wardrobeItem.name
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '删除成功'
    });

  } catch (error) {
    console.error('[Game] 删除衣柜失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误'
    });
  }
});

// 穿戴衣柜中的皮肤
router.post('/profile/:id/wardrobe/:itemId/equip', authenticateToken, async (req, res) => {
  try {
    const profileId = parseInt(req.params.id);
    const itemId = parseInt(req.params.itemId);

    const profile = await getProfileById(profileId);
    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    const db = getDB();

    const newWardrobeItem = await db('mc_skin_wardrobe')
      .where({ id: itemId, profile_id: profileId, is_deleted: false })
      .first();

    if (!newWardrobeItem) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '衣柜项不存在'
      });
    }

    // 使用事务保证数据一致性
    await db.transaction(async (trx) => {
      // 查找当前激活的皮肤
      const currentActive = await trx('mc_skin_wardrobe')
        .where({ profile_id: profileId, is_active: true, is_deleted: false })
        .first();

      // 如果当前有激活的皮肤，将其重命名为角色名（避免丢失）
      if (currentActive && currentActive.id !== itemId) {
        await trx('mc_skin_wardrobe')
          .where({ id: currentActive.id })
          .update({
            name: profile.player_name,
            is_active: false
          });
      } else if (currentActive) {
        // 同一个皮肤重新穿戴，只需取消再激活
        await trx('mc_skin_wardrobe')
          .where({ id: currentActive.id })
          .update({ is_active: false });
      } else {
        // 取消之前激活的皮肤（兜底）
        await trx('mc_skin_wardrobe')
          .where({ profile_id: profileId, is_active: true })
          .update({ is_active: false });
      }

      // 激活新的皮肤
      await trx('mc_skin_wardrobe')
        .where({ id: itemId })
        .update({ is_active: true });

      // 更新角色的当前皮肤信息
      await trx('mc_profiles')
        .where({ id: profileId })
        .update({
          skin_url: newWardrobeItem.skin_url,
          skin_model: newWardrobeItem.skin_model,
          cape_url: newWardrobeItem.cape_url,
          updated_at: new Date()
        });
    });

    // 标记Token失效
    await markTokensAsTemporarilyInvalidated(profileId);

    await auditLog('WARDROBE_EQUIP', req.user.id, profileId, req.ip, {
      item_id: itemId,
      name: newWardrobeItem.name,
      old_skin_url: profile.skin_url,
      new_skin_url: newWardrobeItem.skin_url
    });

    console.log(`[Game] 角色 ${profile.player_name} 切换皮肤: ${newWardrobeItem.name}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        old_skin_url: profile.skin_url,
        new_skin_url: newWardrobeItem.skin_url,
        new_cape_url: newWardrobeItem.cape_url,
        skin_model: newWardrobeItem.skin_model,
        wardrobe_name: newWardrobeItem.name
      },
      message: '切换成功，请使用新皮肤重新登录游戏'
    });

  } catch (error) {
    console.error('[Game] 穿戴衣柜皮肤失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误'
    });
  }
});

// 排序衣柜项
router.put('/profile/:id/wardrobe/sort', authenticateToken, async (req, res) => {
  try {
    const profileId = parseInt(req.params.id);
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '请提供排序数据'
      });
    }

    const profile = await getProfileById(profileId);
    if (!profile || !matchUserId(profile.user_id, req.user.id)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    const db = getDB();

    await db.transaction(async (trx) => {
      for (const item of items) {
        await trx('mc_skin_wardrobe')
          .where({
            id: item.id,
            profile_id: profileId,
            is_deleted: false
          })
          .update({ sort_order: item.sort_order });
      }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '排序更新成功'
    });

  } catch (error) {
    console.error('[Game] 排序更新失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误'
    });
  }
});

module.exports = router;
