/**
 * 悦社社区 - Yggdrasil 标准认证 API 路由
 * 完全遵循 Mojang 官方 Yggdrasil API 规范
 * 供 authlib-injector 和 Minecraft 客户端调用
 * 
 * @author zhaishis
 * @version v1.1.0
 * @see https://wiki.vg/Authentication
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/config');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const config = require('../config/config');
const { uploadFile } = require('../utils/uploadHelper');
const {
  getProfileByName,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  generateClientToken,
  saveTokens,
  findTokenByAccessToken,
  findTokenByRefreshToken,
  isTokenTemporarilyInvalidated,
  invalidateAllTokens,
  invalidateToken,
  getProfileByUuid,
  formatUuid,
  encodeTextures,
  auditLog,
  buildAuthResponse,
  buildErrorResponse,
  createFileHash,
  signData,
  getSignaturePublicKey
} = require('../utils/yggdrasilHelper');

// 内存存储用于serverId验证（生产环境建议使用Redis）
const serverIdCache = new Map();

// 代理 URL 函数：将皮肤/披风 URL 转换为代理 URL
function getProxyUrl(originalUrl, req) {
  if (!originalUrl) return originalUrl;
  // 如果已经是指定格式的代理URL，直接返回
  if (originalUrl.includes('/api/yggdrasil/textures')) return originalUrl;
  // 将原始URL转换为代理URL格式（完整URL，使用查询参数）
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const encodedUrl = encodeURIComponent(originalUrl);
  return `${baseUrl}/api/yggdrasil/textures?url=${encodedUrl}`;
}

// 配置 multer 内存存储
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB限制
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('只允许上传PNG格式的图片'));
    }
  }
});

// 设置 ALI 响应头
router.use((req, res, next) => {
  res.setHeader('X-Authlib-Injector-API-Location', '/api/yggdrasil/');
  next();
});

router.use((req, res, next) => {
  console.log(`[Yggdrasil] ${req.method} ${req.originalUrl}`);
  next();
});

// ========== API 元数据获取 ==========
router.get('/', (req, res) => {
  console.log('[Yggdrasil] 请求API元数据');
  
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  // 获取签名公钥（从 keys/yggdrasil-public.pem 读取）
  const signaturePublicKey = getSignaturePublicKey();

  // 从 .env 读取额外的皮肤域名白名单（逗号分隔）
  const extraSkinDomains = process.env.SKIN_DOMAINS 
    ? process.env.SKIN_DOMAINS.split(',').map(d => d.trim()).filter(Boolean)
    : [];

  // 构建皮肤域名白名单（去重）
  const serverHost = new URL(baseUrl).hostname;
  const defaultDomains = ['.minecraft.net', '.mojang.com'];
  const allDomains = [...new Set([...defaultDomains, serverHost, ...extraSkinDomains])];

  res.json({
    meta: {
      serverName: '悦社社区 Yggdrasil 验证服务',
      implementationName: 'yueshe-yggdrasil',
      implementationVersion: '1.1.0',
      links: {
        homepage: baseUrl,
        register: `${baseUrl}/register`
      },
      feature: {
        non_email_login: true,
        enable_profile_key: false,
        username_check: true
      }
    },
    skinDomains: allDomains,
    signaturePublickey: signaturePublicKey || ''
  });
});

// ========== 认证服务 (Auth Server) ==========

router.post('/authserver/authenticate', async (req, res) => {
  try {
    const { username, password, clientToken, requestUser, agent } = req.body;

    if (!username || !password) {
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        'Invalid credentials. Invalid username or password.'
      ));
    }

    const profile = await getProfileByName(username);

    if (!profile) {
      await auditLog('LOGIN_FAILED', null, null, req.ip, { reason: 'user_not_found', username });
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        'Invalid credentials. Invalid username or password.'
      ));
    }

    if (profile.is_banned) {
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        '该角色已被封禁'
      ));
    }

    const valid = await verifyPassword(password, profile.password_hash);
    
    if (!valid) {
      await auditLog('LOGIN_FAILED', profile.user_id, profile.id, req.ip, { reason: 'wrong_password' });
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        'Invalid credentials. Invalid username or password.'
      ));
    }

    const finalClientToken = clientToken || generateClientToken();
    const accessToken = generateAccessToken(profile);
    const refreshToken = generateRefreshToken();

    await invalidateAllTokens(profile.id);

    await saveTokens(
      profile.id,
      accessToken,
      refreshToken,
      finalClientToken,
      req.ip,
      req.headers['user-agent']
    );

    await auditLog('LOGIN_SUCCESS', profile.user_id, profile.id, req.ip, {
      client: req.headers['user-agent'] || 'unknown'
    });

    const response = buildAuthResponse(profile, accessToken, finalClientToken);

    console.log(`[Yggdrasil] 用户 ${username} 认证成功`);
    res.json(response);

  } catch (error) {
    console.error('[Yggdrasil] authenticate 错误:', error);
    res.status(500).json(buildErrorResponse(
      'InternalServerError',
      '服务器内部错误'
    ));
  }
});

router.post('/authserver/refresh', async (req, res) => {
  try {
    const { accessToken, clientToken, requestUser, selectedProfile } = req.body;

    if (!accessToken) {
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        'Invalid token.'
      ));
    }

    const tokenRecord = await findTokenByAccessToken(accessToken);

    if (!tokenRecord) {
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        'Invalid token.'
      ));
    }

    if (clientToken && tokenRecord.client_token !== clientToken) {
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        'Invalid token.'
      ));
    }

    const newAccessToken = generateAccessToken(tokenRecord);
    const newRefreshToken = generateRefreshToken();
    const finalClientToken = clientToken || tokenRecord.client_token;

    await pool.execute(
      `UPDATE yggdrasil_tokens 
       SET access_token = ?, refresh_token = ?, client_token = ?, expires_at = DATE_ADD(NOW(), INTERVAL 7 DAY)
       WHERE id = ?`,
      [newAccessToken, newRefreshToken, finalClientToken, tokenRecord.id]
    );

    let response = {
      accessToken: newAccessToken,
      clientToken: finalClientToken
    };

    if (requestUser && requestUser === true) {
      response.selectedProfile = {
        id: formatUuid(tokenRecord.uuid),
        name: tokenRecord.player_name
      };

      response.user = {
        id: crypto.createHash('md5').update(String(tokenRecord.user_id)).digest('hex'),
        properties: []
      };
    } else {
      response.selectedProfile = {
        id: formatUuid(tokenRecord.uuid),
        name: tokenRecord.player_name
      };
    }

    console.log(`[Yggdrasil] Token 刷新成功 用户: ${tokenRecord.player_name}`);
    res.json(response);

  } catch (error) {
    console.error('[Yggdrasil] refresh 错误:', error);
    res.status(500).json(buildErrorResponse(
      'InternalServerError',
      '服务器内部错误'
    ));
  }
});

router.post('/authserver/validate', async (req, res) => {
  try {
    const { accessToken, clientToken } = req.body;

    if (!accessToken) {
      return res.status(403).end();
    }

    const tokenRecord = await findTokenByAccessToken(accessToken);

    if (!tokenRecord) {
      return res.status(403).end();
    }

    if (clientToken && tokenRecord.client_token !== clientToken) {
      return res.status(403).end();
    }

    // 检查 Token 是否暂时失效（角色改名后）
    if (tokenRecord.is_temporarily_invalidated === 1) {
      console.log(`[Yggdrasil] Token 已暂时失效（角色改名后），需要刷新`);
      return res.status(403).end();
    }

    res.status(204).end();

  } catch (error) {
    console.error('[Yggdrasil] validate 错误:', error);
    res.status(403).end();
  }
});

router.post('/authserver/signout', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        '缺少用户名或密码'
      ));
    }

    const profile = await getProfileByName(username);

    if (!profile) {
      return res.status(204).end();
    }

    const valid = await verifyPassword(password, profile.password_hash);
    
    if (!valid) {
      return res.status(204).end();
    }

    const deletedCount = await invalidateAllTokens(profile.id);

    await auditLog('SIGNOUT', profile.user_id, profile.id, req.ip);

    console.log(`[Yggdrasil] 用户 ${username} 登出成功`);
    res.status(204).end();

  } catch (error) {
    console.error('[Yggdrasil] signout 错误:', error);
    res.status(500).json(buildErrorResponse(
      'InternalServerError',
      '服务器内部错误'
    ));
  }
});

router.post('/authserver/invalidate', async (req, res) => {
  try {
    const { accessToken, clientToken } = req.body;

    if (!accessToken) {
      return res.status(204).end();
    }

    const success = await invalidateToken(accessToken);
    res.status(204).end();

  } catch (error) {
    console.error('[Yggdrasil] invalidate 错误:', error);
    res.status(204).end();
  }
});

// ========== 会话服务 (Session Server) ==========

router.post('/sessionserver/session/minecraft/join', async (req, res) => {
  try {
    const { accessToken, selectedProfile, serverId } = req.body;

    if (!accessToken || !selectedProfile || !serverId) {
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        'Invalid token.'
      ));
    }

    const tokenRecord = await findTokenByAccessToken(accessToken);

    if (!tokenRecord) {
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        'Invalid token.'
      ));
    }

    const normalizedTokenUuid = tokenRecord.uuid.replace(/-/g, '');
    const normalizedRequestUuid = selectedProfile.replace(/-/g, '');
    
    if (normalizedTokenUuid !== normalizedRequestUuid) {
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        'Invalid token.'
      ));
    }

    const cacheKey = serverId;
    serverIdCache.set(cacheKey, {
      accessToken: accessToken,
      profileId: tokenRecord.profile_id,
      playerName: tokenRecord.player_name,
      uuid: tokenRecord.uuid,
      ip: req.ip,
      timestamp: Date.now()
    });

    setTimeout(() => {
      serverIdCache.delete(cacheKey);
    }, 30000);

    res.status(204).end();

  } catch (error) {
    console.error('[Yggdrasil] join 错误:', error);
    res.status(500).json(buildErrorResponse(
      'InternalServerError',
      '服务器内部错误'
    ));
  }
});

router.get('/sessionserver/session/minecraft/hasJoined', async (req, res) => {
  try {
    const { username, serverId, ip } = req.query;

    if (!username || !serverId) {
      return res.status(204).end();
    }

    const cacheEntry = serverIdCache.get(serverId);

    if (!cacheEntry) {
      return res.status(204).end();
    }

    if (cacheEntry.playerName !== username) {
      return res.status(204).end();
    }

    if (ip && cacheEntry.ip !== ip) {
      return res.status(204).end();
    }

    const profile = await getProfileByUuid(cacheEntry.uuid);

    if (!profile || profile.is_banned) {
      return res.status(204).end();
    }

    const uuid = formatUuid(profile.uuid);
    
    // UUID 统一使用无符号格式（去掉横线）
    const unsignedUuid = uuid.replace(/-/g, '');

    const texturePayload = {
      timestamp: Date.now(),
      profileId: unsignedUuid,
      profileName: profile.player_name,
      textures: {}
    };

    if (profile.skin_url) {
      texturePayload.textures.SKIN = {
        url: getProxyUrl(profile.skin_url, req),
        metadata: {
          model: profile.skin_model || 'classic'
        }
      };
    }

    if (profile.cape_url) {
      texturePayload.textures.CAPE = {
        url: getProxyUrl(profile.cape_url, req)
      };
    }

    const base64Value = Buffer.from(JSON.stringify(texturePayload)).toString('base64');
    
    // 对纹理数据进行签名
    const signature = signData(base64Value);

    const response = {
      id: unsignedUuid,
      name: profile.player_name,
      properties: [
        {
          name: 'textures',
          value: base64Value,
          signature: signature || ''
        },
        {
          name: 'uploadableTextures',
          value: 'skin,cape'
        }
      ]
    };

    serverIdCache.delete(serverId);

    console.log(`[Yggdrasil] 验证成功: ${username}${signature ? ' (已签名)' : ''}`);
    res.json(response);

  } catch (error) {
    console.error('[Yggdrasil] hasJoined 错误:', error);
    res.status(204).end();
  }
});

router.get('/sessionserver/session/minecraft/profile/:uuid', async (req, res) => {
  try {
    const uuid = req.params.uuid;
    // unsigned 默认为 true，即不包含签名
    const unsignedParam = req.query.unsigned !== 'false';

    console.log(`[Yggdrasil] 查询角色属性: uuid=${uuid}, unsigned=${unsignedParam}`);

    const profile = await getProfileByUuid(uuid);

    if (!profile || profile.is_banned) {
      console.log(`[Yggdrasil] 角色不存在或已封禁: ${uuid}`);
      res.status(204).end();
      return;
    }

    console.log(`[Yggdrasil] 角色查询成功: ${profile.player_name}, skin_url=${profile.skin_url}, cape_url=${profile.cape_url}`);

    const texturePayload = {
      timestamp: Date.now(),
      profileId: uuid.replace(/-/g, ''),
      profileName: profile.player_name,
      textures: {}
    };

    if (profile.skin_url) {
      texturePayload.textures.SKIN = {
        url: getProxyUrl(profile.skin_url, req),
        metadata: {
          model: profile.skin_model || 'classic'
        }
      };
    }

    if (profile.cape_url) {
      texturePayload.textures.CAPE = {
        url: getProxyUrl(profile.cape_url, req)
      };
    }

    const base64Value = Buffer.from(JSON.stringify(texturePayload)).toString('base64');
    
    // 构建响应
    const response = {
      id: uuid.replace(/-/g, ''),
      name: profile.player_name,
      properties: [
        {
          name: 'textures',
          value: base64Value
        },
        {
          name: 'uploadableTextures',
          value: 'skin,cape'
        }
      ]
    };

    // 仅当 unsigned=false 时才包含签名
    if (!unsignedParam) {
      const signature = signData(base64Value);
      response.properties[0].signature = signature || '';
    }

    res.json(response);

  } catch (error) {
    console.error('[Yggdrasil] sessionserver/profile 错误:', error);
    res.status(204).end();
  }
});

// ========== 角色批量查询 ==========

router.post('/api/profiles/minecraft', async (req, res) => {
  try {
    const names = req.body;

    if (!Array.isArray(names)) {
      return res.status(400).json(buildErrorResponse(
        'IllegalArgumentException',
        'Invalid request format'
      ));
    }

    if (names.length > 100) {
      return res.status(400).json(buildErrorResponse(
        'IllegalArgumentException',
        'Too many names requested'
      ));
    }

    const results = [];

    for (const name of names) {
      if (typeof name !== 'string') continue;
      
      const profile = await getProfileByName(name);
      if (profile && !profile.is_banned) {
        results.push({
          id: formatUuid(profile.uuid),
          name: profile.player_name
        });
      }
    }

    res.json(results);

  } catch (error) {
    console.error('[Yggdrasil] 批量查询错误:', error);
    res.status(500).json([]);
  }
});

// ========== 材质上传 ==========

async function verifyTextureAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(buildErrorResponse(
        'Unauthorized',
        '缺少认证信息'
      ));
    }

    const accessToken = authHeader.substring(7);
    const tokenRecord = await findTokenByAccessToken(accessToken);

    if (!tokenRecord) {
      return res.status(401).json(buildErrorResponse(
        'Unauthorized',
        '无效的访问令牌'
      ));
    }

    req.tokenRecord = tokenRecord;
    next();

  } catch (error) {
    console.error('[Yggdrasil] 材质认证错误:', error);
    return res.status(401).json(buildErrorResponse(
      'Unauthorized',
      '认证失败'
    ));
  }
}

async function validateTexture(buffer, textureType) {
  try {
    const metadata = await sharp(buffer).metadata();
    
    if (metadata.format !== 'png') {
      return { valid: false, error: '图片必须是PNG格式' };
    }

    const { width, height } = metadata;

    if (textureType === 'skin') {
      const validSkinSizes = [
        [64, 32], [64, 64], [128, 64], [128, 128], [256, 128], [256, 256]
      ];
      
      const isValidSize = validSkinSizes.some(([w, h]) => width === w && height === h) ||
        (width % 64 === 0 && (height % 32 === 0 || height % 64 === 0));

      if (!isValidSize) {
        return { valid: false, error: '皮肤尺寸必须是64x32或64x64的整数倍' };
      }
    } else if (textureType === 'cape') {
      const validCapeSizes = [
        [64, 32], [128, 64], [256, 128], [22, 17], [44, 34], [88, 68]
      ];
      
      const isValidSize = validCapeSizes.some(([w, h]) => width === w && height === h) ||
        (width % 64 === 0 && height % 32 === 0) ||
        (width % 22 === 0 && height % 17 === 0);

      if (!isValidSize) {
        return { valid: false, error: '披风尺寸必须是64x32或22x17的整数倍' };
      }
    }

    return { valid: true, width, height };

  } catch (error) {
    return { valid: false, error: '无法读取图片信息' };
  }
}

router.put('/api/user/profile/:uuid/:textureType', verifyTextureAuth, upload.single('file'), async (req, res) => {
  try {
    const { uuid, textureType } = req.params;
    const { model } = req.body;

    if (!['skin', 'cape'].includes(textureType)) {
      return res.status(400).json(buildErrorResponse(
        'IllegalArgumentException',
        '无效的材质类型'
      ));
    }

    const normalizedUuid = uuid.replace(/-/g, '');
    if (normalizedUuid.length !== 32) {
      return res.status(400).json(buildErrorResponse(
        'IllegalArgumentException',
        '无效的UUID格式'
      ));
    }

    const profile = await getProfileByUuid(uuid);

    if (!profile) {
      return res.status(404).json(buildErrorResponse(
        'NotFoundException',
        '角色不存在'
      ));
    }

    const tokenUuid = req.tokenRecord.uuid.replace(/-/g, '');
    if (tokenUuid !== normalizedUuid) {
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        '无权操作该角色'
      ));
    }

    if (!req.file) {
      return res.status(400).json(buildErrorResponse(
        'IllegalArgumentException',
        '没有上传文件'
      ));
    }

    const validation = await validateTexture(req.file.buffer, textureType);
    if (!validation.valid) {
      return res.status(400).json(buildErrorResponse(
        'IllegalArgumentException',
        validation.error
      ));
    }

    const fileHash = createFileHash(req.file.buffer);

    // 安全处理：去除所有元数据，防止 PNG Bomb 和恶意代码
    let processedBuffer;
    try {
      processedBuffer = await sharp(req.file.buffer)
        .png()
        .toBuffer(); // 不保留任何元数据
    } catch (error) {
      console.error('[Yggdrasil] 图片处理失败:', error);
      return res.status(400).json(buildErrorResponse(
        'IllegalArgumentException',
        '图片处理失败'
      ));
    }

    // 使用完整 hash 作为文件名（规范要求：文件名必须是材质 hash，不带扩展名）
    const uploadResult = await uploadFile(
      processedBuffer,
      fileHash,
      'image/png'
    );

    if (!uploadResult.success) {
      return res.status(500).json(buildErrorResponse(
        'InternalServerError',
        '材质上传失败'
      ));
    }

    const updateField = textureType === 'skin' ? 'skin_url' : 'cape_url';
    const modelField = textureType === 'skin' ? 'skin_model' : null;
    
    if (textureType === 'skin' && model) {
      await pool.execute(
        `UPDATE mc_profiles SET ${updateField} = ?, ${modelField} = ? WHERE id = ?`,
        [uploadResult.url, model === 'slim' ? 'slim' : 'classic', profile.id]
      );
    } else {
      await pool.execute(
        `UPDATE mc_profiles SET ${updateField} = ? WHERE id = ?`,
        [uploadResult.url, profile.id]
      );
    }

    await pool.execute(
      `INSERT INTO mc_textures (profile_id, texture_type, texture_hash, url, metadata)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       texture_hash = VALUES(texture_hash),
       url = VALUES(url),
       metadata = VALUES(metadata),
       uploaded_at = CURRENT_TIMESTAMP`,
      [
        profile.id,
        textureType,
        fileHash,
        uploadResult.url,
        JSON.stringify({
          width: validation.width,
          height: validation.height,
          model: textureType === 'skin' ? (model || 'classic') : null
        })
      ]
    );

    await auditLog('TEXTURE_UPLOAD', profile.user_id, profile.id, req.ip, {
      textureType,
      url: uploadResult.url,
      size: req.file.size
    });

    console.log(`[Yggdrasil] 材质上传成功: ${textureType} for ${profile.player_name}`);
    res.status(204).end();

  } catch (error) {
    console.error('[Yggdrasil] 材质上传错误:', error);
    res.status(500).json(buildErrorResponse(
      'InternalServerError',
      '服务器内部错误'
    ));
  }
});

router.delete('/api/user/profile/:uuid/:textureType', verifyTextureAuth, async (req, res) => {
  try {
    const { uuid, textureType } = req.params;

    if (!['skin', 'cape'].includes(textureType)) {
      return res.status(400).json(buildErrorResponse(
        'IllegalArgumentException',
        '无效的材质类型'
      ));
    }

    const normalizedUuid = uuid.replace(/-/g, '');
    if (normalizedUuid.length !== 32) {
      return res.status(400).json(buildErrorResponse(
        'IllegalArgumentException',
        '无效的UUID格式'
      ));
    }

    const profile = await getProfileByUuid(uuid);

    if (!profile) {
      return res.status(404).json(buildErrorResponse(
        'NotFoundException',
        '角色不存在'
      ));
    }

    const tokenUuid = req.tokenRecord.uuid.replace(/-/g, '');
    if (tokenUuid !== normalizedUuid) {
      return res.status(403).json(buildErrorResponse(
        'ForbiddenOperationException',
        '无权操作该角色'
      ));
    }

    const updateField = textureType === 'skin' ? 'skin_url' : 'cape_url';
    await pool.execute(
      `UPDATE mc_profiles SET ${updateField} = NULL WHERE id = ?`,
      [profile.id]
    );

    await auditLog('TEXTURE_DELETE', profile.user_id, profile.id, req.ip, {
      textureType
    });

    console.log(`[Yggdrasil] 材质删除成功: ${textureType} for ${profile.player_name}`);
    res.status(204).end();

  } catch (error) {
    console.error('[Yggdrasil] 材质删除错误:', error);
    res.status(500).json(buildErrorResponse(
      'InternalServerError',
      '服务器内部错误'
    ));
  }
});

// 材质上传错误处理
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json(buildErrorResponse(
        'IllegalArgumentException',
        '文件大小超过限制（最大2MB）'
      ));
    }
  }
  
  if (error.message === '只允许上传PNG格式的图片') {
    return res.status(400).json(buildErrorResponse(
      'IllegalArgumentException',
      '只允许上传PNG格式的图片'
    ));
  }

  next(error);
});

// ========== 材质代理接口 ==========
// 将皮肤/披风 URL 代理到当前服务器域名，解决跨域和白名单问题
router.get('/textures', async (req, res) => {
  try {
    const encodedUrl = req.query.url;
    if (!encodedUrl) {
      return res.status(400).send('Missing URL parameter');
    }

    // 解码原始 URL
    const originalUrl = decodeURIComponent(encodedUrl);
    console.log(`[Yggdrasil] 材质代理: ${originalUrl.substring(0, 80)}...`);

    // 获取图片
    const response = await axios.get(originalUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxContentLength: 2 * 1024 * 1024, // 限制 2MB
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 缓存一天

    // 判断 Content-Type
    const contentType = response.headers['content-type'] || 'image/png';
    res.setHeader('Content-Type', contentType);

    // 返回图片内容
    res.send(response.data);

  } catch (error) {
    console.error('[Yggdrasil] 材质代理失败:', error.message);
    res.status(500).send('Failed to fetch texture');
  }
});

router.get('/sessionserver/session/minecraft/profile/:uuid/digital', (req, res) => {
  res.redirect(`/api/yggdrasil/sessionserver/session/minecraft/profile/${req.params.uuid}`);
});

console.log('========================================');
console.log('[Yggdrasil] Yggdrasil API 路由加载完成');
console.log('[Yggdrasil] 可用端点:');
console.log('  元数据:');
console.log('    - GET  /                          (API元数据)');
console.log('  Auth Server (认证服务):');
console.log('    - POST /authserver/authenticate  (认证)');
console.log('    - POST /authserver/refresh        (刷新Token)');
console.log('    - POST /authserver/validate       (验证Token)');
console.log('    - POST /authserver/signout         (登出)');
console.log('    - POST /authserver/invalidate     (使Token失效)');
console.log('  Session Server (会话服务):');
console.log('    - POST /sessionserver/session/minecraft/join      (客户端加入)');
console.log('    - GET  /sessionserver/session/minecraft/hasJoined (服务端验证)');
console.log('    - GET  /sessionserver/session/minecraft/profile/:uuid');
console.log('  角色查询:');
console.log('    - POST /api/profiles/minecraft    (批量查询角色)');
console.log('  材质管理:');
console.log('    - PUT    /api/user/profile/:uuid/:textureType (上传材质)');
console.log('    - DELETE /api/user/profile/:uuid/:textureType (删除材质)');
console.log('========================================');

module.exports = router;