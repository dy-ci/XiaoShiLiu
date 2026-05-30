/**
 * 悦社社区 - 游戏管理 API 路由
 * 提供角色CRUD、皮肤/披风管理等接口
 * 供前端Web页面调用（需要社区JWT认证）
 * 
 * @author zhaishis
 * @version v1.0.0
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const axios = require('axios');
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
  isUnique
} = require('../utils/yggdrasilHelper');
const { pool } = require('../config/config');

const MAX_PROFILES_PER_USER = parseInt(process.env.MAX_PROFILES_PER_USER) || 3;
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

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const profiles = await getProfilesByUserId(req.user.id);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: profiles.map(p => ({
        id: p.id,
        player_name: p.player_name,
        uuid: p.uuid,
        skin_url: p.skin_url,
        cape_url: p.cape_url,
        skin_model: p.skin_model,
        is_banned: p.is_banned,
        created_at: p.created_at,
        updated_at: p.updated_at
      })),
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

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as count FROM mc_profiles WHERE user_id = ?`,
      [req.user.id]
    );

    if (countResult[0].count >= MAX_PROFILES_PER_USER) {
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

    const userId = Number(req.user.id);
    console.log(`[Game] 创建角色 - userId: ${userId}, type: ${typeof userId}, playerName: ${player_name}`);

    // 验证用户是否存在
    const [userCheck] = await pool.execute(
      'SELECT id FROM users WHERE id = ?',
      [userId]
    );

    if (userCheck.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '当前用户不存在，请重新登录'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO mc_profiles (user_id, player_name, uuid, password_hash)
       VALUES (?, ?, ?, ?)`,
      [userId, player_name.trim(), uuid, passwordHash]
    );

    await auditLog('PROFILE_CREATE', userId, result.insertId, req.ip, {
      player_name: player_name.trim(),
      uuid
    });

    console.log(`[Game] 用户 ${userId} 创建角色成功: ${player_name}`);

    res.status(HTTP_STATUS.CREATED).json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        id: result.insertId,
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

    if (!profile || profile.user_id !== req.user.id) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    const nameExists = await isUnique('mc_profiles', 'player_name', new_name.trim(), profileId);
    if (!nameExists) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '该玩家名称已被使用'
      });
    }

    const oldName = profile.player_name;

    await pool.execute(
      `UPDATE mc_profiles SET player_name = ? WHERE id = ?`,
      [new_name.trim(), profileId]
    );

    await auditLog('NAME_CHANGE', req.user.id, profileId, req.ip, {
      old_name: oldName,
      new_name: new_name.trim()
    });

    console.log(`[Game] 角色 ${oldName} 改名为 ${new_name}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { old_name: oldName, new_name: new_name.trim() },
      message: '名称修改成功'
    });

  } catch (error) {
    console.error('[Game] 修改名称失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '修改失败'
    });
  }
});

router.put('/profile/:id/password', authenticateToken, async (req, res) => {
  try {
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

    if (!profile || profile.user_id !== req.user.id) {
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

    await pool.execute(
      `UPDATE mc_profiles SET password_hash = ? WHERE id = ?`,
      [newPasswordHash, profileId]
    );

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
    const profileId = parseInt(req.params.id);
    const model = req.body.model || 'classic';

    if (!['classic', 'slim'].includes(model)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '无效的模型类型，必须是 classic 或 slim'
      });
    }

    const profile = await getProfileById(profileId);

    if (!profile || profile.user_id !== req.user.id) {
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

    const fileName = `${profile.uuid}_skin.png`;
    const result = await uploadImage(req.file.buffer, fileName, 'image/png');

    if (!result.success) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        code: RESPONSE_CODES.ERROR,
        message: result.message || '皮肤上传失败'
      });
    }

    await pool.execute(
      `UPDATE mc_profiles SET skin_url = ?, skin_model = ? WHERE id = ?`,
      [result.url, model, profileId]
    );

    const textureHash = createFileHash(req.file.buffer);

    await pool.execute(
      `INSERT IGNORE INTO mc_textures (profile_id, texture_type, texture_hash, url, metadata)
       VALUES (?, 'skin', ?, ?, ?)`,
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
    const profileId = parseInt(req.params.id);

    const profile = await getProfileById(profileId);

    if (!profile || profile.user_id !== req.user.id) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    await pool.execute(
      `UPDATE mc_profiles SET skin_url = NULL, skin_model = 'classic' WHERE id = ?`,
      [profileId]
    );

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
    const profileId = parseInt(req.params.id);

    const profile = await getProfileById(profileId);

    if (!profile || profile.user_id !== req.user.id) {
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

    const fileName = `${profile.uuid}_cape.png`;
    const result = await uploadImage(req.file.buffer, fileName, 'image/png');

    if (!result.success) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        code: RESPONSE_CODES.ERROR,
        message: result.message || '披风上传失败'
      });
    }

    await pool.execute(
      `UPDATE mc_profiles SET cape_url = ? WHERE id = ?`,
      [result.url, profileId]
    );

    const textureHash = createFileHash(req.file.buffer);

    await pool.execute(
      `INSERT IGNORE INTO mc_textures (profile_id, texture_type, texture_hash, url, metadata)
       VALUES (?, 'cape', ?, ?, ?)`,
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
    const profileId = parseInt(req.params.id);

    const profile = await getProfileById(profileId);

    if (!profile || profile.user_id !== req.user.id) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权操作此角色'
      });
    }

    await pool.execute(
      `UPDATE mc_profiles SET cape_url = NULL WHERE id = ?`,
      [profileId]
    );

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

module.exports = router;
