/**
 * 悦社社区 - 经济系统 API 路由
 * 提供货币、等级、背包、商店、任务、成就等经济系统接口
 *
 * @author zhaishis
 * @version v1.0.0
 */

const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants');
const { authenticateToken } = require('../middleware/auth');
const { getDB } = require('../utils/db');

// ========== 等级配置 ==========
const LEVEL_CONFIG = [
  { level: 1, title: 'Esc', exp: 0 },
  { level: 2, title: 'F1', exp: 50 },
  { level: 3, title: 'F2', exp: 150 },
  { level: 4, title: 'Tab', exp: 300 },
  { level: 5, title: 'Tab', exp: 500 },
  { level: 6, title: 'Tab', exp: 800 },
  { level: 7, title: 'Shift', exp: 1500 },
  { level: 8, title: 'Shift', exp: 2200 },
  { level: 9, title: 'Shift', exp: 3000 },
  { level: 10, title: 'Shift', exp: 4000 },
  { level: 11, title: 'Ctrl', exp: 7000 },
  { level: 12, title: 'Ctrl', exp: 9000 },
  { level: 13, title: 'Ctrl', exp: 12000 },
  { level: 14, title: 'Ctrl', exp: 15000 },
  { level: 15, title: 'Ctrl', exp: 20000 },
  { level: 16, title: 'Alt', exp: 35000 },
  { level: 17, title: 'Alt', exp: 45000 },
  { level: 18, title: 'Alt', exp: 60000 },
  { level: 19, title: 'Alt', exp: 80000 },
  { level: 20, title: 'Space', exp: 150000 },
];

// ========== 任务奖励配置 ==========
const TASK_REWARDS = {
  daily: { pi: 10, alpha: 0, exp: 20 },
  weekly: { pi: 50, alpha: 0, exp: 100 },
  main: { pi: 100, alpha: 10, exp: 200 },
};

// ========== 任务定义 ==========
const TASK_DEFINITIONS = {
  // 每日任务
  daily_login:    { name: '每日登录',     description: '每天登录悦社',           task_type: 'daily',  target: 1 },
  daily_like:     { name: '每日点赞',     description: '每天点赞 3 篇内容',       task_type: 'daily',  target: 3 },
  daily_comment:  { name: '每日评论',     description: '每天发表 1 条评论',       task_type: 'daily',  target: 1 },
  daily_share:    { name: '每日分享',     description: '每天分享 1 篇内容',       task_type: 'daily',  target: 1 },
  daily_browse:   { name: '每日浏览',     description: '每天浏览 10 篇内容',      task_type: 'daily',  target: 10 },
  // 每周任务
  weekly_post:    { name: '每周发布',     description: '每周发布 2 篇笔记',       task_type: 'weekly', target: 2 },
  weekly_comment5: { name: '评论达人',     description: '每周发表 5 条评论',       task_type: 'weekly', target: 5 },
  weekly_like10:  { name: '点赞达人',     description: '每周点赞 10 篇内容',      task_type: 'weekly', target: 10 },
  weekly_login5:  { name: '活跃用户',     description: '每周登录 5 天',           task_type: 'weekly', target: 5 },
  // 主线任务
  main_first_post:   { name: '初来乍到',   description: '发布你的第一篇笔记',      task_type: 'main', target: 1 },
  main_post5:        { name: '小有名气',   description: '累计发布 5 篇笔记',       task_type: 'main', target: 5 },
  main_post20:       { name: '笔耕不辍',   description: '累计发布 20 篇笔记',      task_type: 'main', target: 20 },
  main_post50:       { name: '创作先锋',   description: '累计发布 50 篇笔记',      task_type: 'main', target: 50 },
  main_comment10:    { name: '社交蝴蝶',   description: '累计发表 10 条评论',      task_type: 'main', target: 10 },
  main_like100:      { name: '人气之星',   description: '累计获得 100 个点赞',     task_type: 'main', target: 100 },
  main_fans50:       { name: '魅力四射',   description: '累计获得 50 个粉丝',      task_type: 'main', target: 50 },
  main_level5:       { name: '成长之路',   description: '达到等级 5',              task_type: 'main', target: 1 },
  main_level10:      { name: '进阶之路',   description: '达到等级 10',             task_type: 'main', target: 1 },
};

// ========== 成就奖励配置 ==========
// achievement_id -> { pi, alpha, exp }
const ACHIEVEMENT_REWARDS = {
  first_post: { pi: 20, alpha: 0, exp: 50 },
  first_comment: { pi: 10, alpha: 0, exp: 30 },
  level_5: { pi: 100, alpha: 5, exp: 0 },
  level_10: { pi: 500, alpha: 20, exp: 0 },
  level_20: { pi: 2000, alpha: 100, exp: 0 },
  collector_10: { pi: 50, alpha: 0, exp: 100 },
  collector_50: { pi: 200, alpha: 10, exp: 300 },
  shop_first_buy: { pi: 0, alpha: 0, exp: 50 },
};

// ========== 成就定义 ==========
const ACHIEVEMENT_DEFINITIONS = {
  first_post:     { name: '初出茅庐',     description: '发布你的第一篇笔记',       icon: 'post' },
  first_comment:  { name: '开口说话',     description: '发表你的第一条评论',       icon: 'comment' },
  level_5:        { name: '崭露头角',     description: '达到等级 5',              icon: 'level' },
  level_10:       { name: '小有成就',     description: '达到等级 10',             icon: 'level' },
  level_20:       { name: '登峰造极',     description: '达到等级 20',             icon: 'level' },
  collector_10:   { name: '初级收藏家',   description: '背包中拥有 10 件道具',     icon: 'bag' },
  collector_50:   { name: '资深收藏家',   description: '背包中拥有 50 件道具',     icon: 'bag' },
  shop_first_buy: { name: '初次购物',     description: '在商店购买第一件道具',     icon: 'shop' },
  like_50:        { name: '人气萌芽',     description: '累计获得 50 个点赞',       icon: 'like' },
  like_500:       { name: '人气爆棚',     description: '累计获得 500 个点赞',      icon: 'like' },
  fans_10:        { name: '初具魅力',     description: '累计获得 10 个粉丝',       icon: 'fans' },
  fans_100:       { name: '魅力无限',     description: '累计获得 100 个粉丝',      icon: 'fans' },
  post_10:        { name: '勤奋作者',     description: '累计发布 10 篇笔记',      icon: 'post' },
  post_100:       { name: '高产作家',     description: '累计发布 100 篇笔记',     icon: 'post' },
  comment_50:     { name: '评论达人',     description: '累计发表 50 条评论',       icon: 'comment' },
  login_30:       { name: '坚持打卡',     description: '连续登录 30 天',          icon: 'calendar' },
};

// ========== 辅助函数 ==========

/**
 * 获取用户ID（悦社号，优先使用 req.user.user_id）
 */
function getUserId(req) {
  return req.user.user_id || req.user.userId || req.user.id;
}

/**
 * 根据经验值计算等级和称号
 * @param {number} exp - 当前经验值
 * @returns {{ level: number, title: string, currentLevelExp: number, nextLevelExp: number|null, expToNext: number|null }}
 */
function calcLevel(exp) {
  let current = LEVEL_CONFIG[0];
  let next = LEVEL_CONFIG[1] || null;

  for (let i = LEVEL_CONFIG.length - 1; i >= 0; i--) {
    if (exp >= LEVEL_CONFIG[i].exp) {
      current = LEVEL_CONFIG[i];
      next = LEVEL_CONFIG[i + 1] || null;
      break;
    }
  }

  return {
    level: current.level,
    title: current.title,
    currentLevelExp: current.exp,
    nextLevelExp: next ? next.exp : null,
    expToNext: next ? next.exp - exp : null,
  };
}

/**
 * 确保用户在 user_economy 表中有记录，没有则自动创建
 */
async function ensureEconomyRecord(db, userId) {
  const existing = await db('user_economy').where({ user_id: userId }).first();
  if (!existing) {
    await db('user_economy').insert({ user_id: userId });
  }
  return;
}

/**
 * 确保用户在 user_levels 表中有记录，没有则自动创建
 */
async function ensureLevelRecord(db, userId) {
  const existing = await db('user_levels').where({ user_id: userId }).first();
  if (!existing) {
    await db('user_levels').insert({ user_id: userId });
  }
  return;
}

/**
 * 确保用户在 user_equipped 表中有记录，没有则自动创建
 */
async function ensureEquippedRecord(db, userId) {
  const existing = await db('user_equipped').where({ user_id: userId }).first();
  if (!existing) {
    await db('user_equipped').insert({ user_id: userId });
  }
  return;
}

/**
 * 增加用户货币并记录交易
 */
async function addCurrency(db, userId, currency, amount, action, description) {
  const field = currency === 'pi' ? 'pi_keys' : 'alpha_keys';
  const totalField = currency === 'pi' ? 'total_pi_earned' : 'total_alpha_earned';

  await db('user_economy')
    .where({ user_id: userId })
    .increment(field, amount)
    .increment(totalField, amount);

  await db('transactions').insert({
    user_id: userId,
    currency,
    amount,
    type: 'earn',
    action: action || null,
    description: description || null,
  });
}

/**
 * 扣减用户货币并记录交易（会检查余额）
 * @returns {boolean} 是否扣减成功
 */
async function spendCurrency(db, userId, currency, amount, action, description) {
  const field = currency === 'pi' ? 'pi_keys' : 'alpha_keys';

  const record = await db('user_economy')
    .where({ user_id: userId })
    .select(field)
    .first();

  if (!record || record[field] < amount) {
    return false;
  }

  await db('user_economy')
    .where({ user_id: userId })
    .decrement(field, amount);

  await db('transactions').insert({
    user_id: userId,
    currency,
    amount,
    type: 'spend',
    action: action || null,
    description: description || null,
  });

  return true;
}

/**
 * 增加用户经验并更新等级
 * @returns {{ level: number, title: string, leveledUp: boolean }}
 */
async function addExp(db, userId, expGained, action) {
  await db('user_levels')
    .where({ user_id: userId })
    .increment('exp', expGained)
    .increment('total_exp', expGained);

  await db('exp_records').insert({
    user_id: userId,
    action: action || null,
    exp_gained: expGained,
  });

  const record = await db('user_levels')
    .where({ user_id: userId })
    .first();

  const levelInfo = calcLevel(record.exp);

  // 如果等级发生变化，更新等级表
  if (levelInfo.level !== record.level) {
    await db('user_levels')
      .where({ user_id: userId })
      .update({ level: levelInfo.level, title: levelInfo.title });
  }

  return { ...levelInfo, leveledUp: levelInfo.level !== record.level };
}

// ========== 经济信息接口 ==========

// GET /api/economy - 获取用户经济信息
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();

    await ensureEconomyRecord(db, userId);

    const economy = await db('user_economy')
      .where({ user_id: userId })
      .first();

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        pi_keys: economy.pi_keys,
        alpha_keys: economy.alpha_keys,
        total_pi_earned: economy.total_pi_earned,
        total_alpha_earned: economy.total_alpha_earned,
      },
      message: '获取成功',
    });
  } catch (error) {
    console.error('[Economy] 获取经济信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

// GET /api/economy/level - 获取用户等级信息
router.get('/level', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();

    await ensureLevelRecord(db, userId);

    const levelRecord = await db('user_levels')
      .where({ user_id: userId })
      .first();

    const levelInfo = calcLevel(levelRecord.exp);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        level: levelInfo.level,
        title: levelInfo.title,
        exp: levelRecord.exp,
        total_exp: levelRecord.total_exp,
        current_level_exp: levelInfo.currentLevelExp,
        next_level_exp: levelInfo.nextLevelExp,
        exp_to_next: levelInfo.expToNext,
      },
      message: '获取成功',
    });
  } catch (error) {
    console.error('[Economy] 获取等级信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

/**
 * 获取用户装备摘要（内部复用）
 * @param {string} userId - 用户ID
 * @returns {Promise<Object>} 装备摘要
 */
async function getUserEquippedSummary(userId) {
  const db = getDB();

  const equipped = await db('user_equipped')
    .where({ user_id: userId })
    .first();

  if (!equipped) {
    return {
      frame_id: null,
      accessory_id: null,
      name_style: null,
      card_bg_id: null,
      chat_bubble_id: null,
    };
  }

  const resultData = {
    frame_id: equipped.frame_id,
    accessory_id: equipped.accessory_id,
    name_style: equipped.name_style,
    card_bg_id: equipped.card_bg_id,
    chat_bubble_id: equipped.chat_bubble_id,
  };

  // 查询各装备的 style_config
  if (equipped.frame_id) {
    const frameItem = await db('user_inventory')
      .where({ user_id: userId, item_id: equipped.frame_id })
      .first();
    if (frameItem) {
      resultData.frame_config = typeof frameItem.style_config === 'string'
        ? JSON.parse(frameItem.style_config) : frameItem.style_config;
    }
  }

  if (equipped.accessory_id) {
    const accItem = await db('user_inventory')
      .where({ user_id: userId, item_id: equipped.accessory_id })
      .first();
    if (accItem) {
      resultData.accessory_config = typeof accItem.style_config === 'string'
        ? JSON.parse(accItem.style_config) : accItem.style_config;
    }
  }

  if (equipped.name_style) {
    const nameItem = await db('user_inventory')
      .where({ user_id: userId, item_id: equipped.name_style })
      .first();
    if (nameItem) {
      resultData.name_style_config = typeof nameItem.style_config === 'string'
        ? JSON.parse(nameItem.style_config) : nameItem.style_config;
    }
  }

  return resultData;
}

// GET /api/economy/equipped - 获取当前用户已装备的道具
router.get('/equipped', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();

    await ensureEquippedRecord(db, userId);
    const resultData = await getUserEquippedSummary(userId);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: resultData,
      message: '获取成功',
    });
  } catch (error) {
    console.error('[Economy] 获取装备信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

// GET /api/economy/equipped/:userId - 获取指定用户的装备摘要（公开接口）
router.get('/equipped/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少 userId 参数',
      });
    }

    const resultData = await getUserEquippedSummary(userId);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: resultData,
      message: '获取成功',
    });
  } catch (error) {
    console.error('[Economy] 获取用户装备信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

// GET /api/economy/inventory - 获取背包
router.get('/inventory', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();

    const query = db('user_inventory').where({ user_id: userId });

    // 支持 ?type= 过滤
    const itemType = req.query.type;
    if (itemType) {
      query.where({ item_type: itemType });
    }

    const inventory = await query
      .select('id', 'item_id', 'item_type', 'name', 'rarity', 'style_config', 'acquired_at', 'equipped')
      .orderBy('acquired_at', 'desc');

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: inventory,
      message: '获取成功',
    });
  } catch (error) {
    console.error('[Economy] 获取背包失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

// GET /api/economy/transactions - 获取交易记录（分页）
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const [totalResult] = await db('transactions')
      .where({ user_id: userId })
      .count('* as total');
    const total = parseInt(totalResult.total);

    const transactions = await db('transactions')
      .where({ user_id: userId })
      .select('id', 'currency', 'amount', 'type', 'action', 'description', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        transactions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
      message: '获取成功',
    });
  } catch (error) {
    console.error('[Economy] 获取交易记录失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

// POST /api/economy/equip - 装备道具
router.post('/equip', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();
    const { item_id, item_type } = req.body;

    if (!item_id || !item_type) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少 item_id 或 item_type 参数',
      });
    }

    const validTypes = ['frame', 'accessory', 'name_style', 'card_bg', 'chat_bubble'];
    if (!validTypes.includes(item_type)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '无效的道具类型',
      });
    }

    // 检查背包中是否拥有该道具
    const inventoryItem = await db('user_inventory')
      .where({ user_id: userId, item_id, item_type })
      .first();

    if (!inventoryItem) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '背包中不存在该道具',
      });
    }

    await ensureEquippedRecord(db, userId);

    // 根据道具类型更新装备表
    const fieldMap = {
      frame: 'frame_id',
      accessory: 'accessory_id',
      card_bg: 'card_bg_id',
      chat_bubble: 'chat_bubble_id',
    };

    if (fieldMap[item_type]) {
      await db('user_equipped')
        .where({ user_id: userId })
        .update({ [fieldMap[item_type]]: item_id });
    } else if (item_type === 'name_style') {
      // name_style 存 item_id
      await db('user_equipped')
        .where({ user_id: userId })
        .update({ name_style: item_id });
    }

    // 更新背包中道具的 equipped 状态
    await db('user_inventory')
      .where({ user_id: userId, item_id, item_type })
      .update({ equipped: true });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { item_id, item_type },
      message: '装备成功',
    });
  } catch (error) {
    console.error('[Economy] 装备道具失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

// POST /api/economy/unequip - 卸下道具
router.post('/unequip', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();
    const { item_id, item_type } = req.body;

    if (!item_id || !item_type) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少 item_id 或 item_type 参数',
      });
    }

    const validTypes = ['frame', 'accessory', 'name_style', 'card_bg', 'chat_bubble'];
    if (!validTypes.includes(item_type)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '无效的道具类型',
      });
    }

    await ensureEquippedRecord(db, userId);

    // 根据道具类型清除装备
    const fieldMap = {
      frame: 'frame_id',
      accessory: 'accessory_id',
      name_style: 'name_style',
      card_bg: 'card_bg_id',
      chat_bubble: 'chat_bubble_id',
    };

    const field = fieldMap[item_type];
    if (field) {
      await db('user_equipped')
        .where({ user_id: userId })
        .update({ [field]: null });

      // 更新背包中道具的 equipped 状态
      await db('user_inventory')
        .where({ user_id: userId, item_id, item_type })
        .update({ equipped: false });
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { item_id, item_type },
      message: '卸下成功',
    });
  } catch (error) {
    console.error('[Economy] 卸下道具失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

// ========== 商店接口 ==========

// GET /api/shop/items - 获取商店列表
router.get('/items', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();

    const query = db('shop_items').where({ is_on_sale: true });

    // 支持 ?type= 过滤
    const itemType = req.query.type;
    if (itemType) {
      query.where({ item_type: itemType });
    }

    // 支持 ?rarity= 过滤
    const rarity = req.query.rarity;
    if (rarity) {
      query.where({ rarity });
    }

    const items = await query
      .select('item_id', 'item_type', 'name', 'description', 'rarity', 'price_pi', 'price_alpha', 'style_config', 'is_limited', 'limited_end')
      .orderBy('rarity', 'asc')
      .orderBy('price_pi', 'desc');

    // 查询用户已拥有的道具
    const ownedItems = await db('user_inventory')
      .where({ user_id: userId })
      .select('item_id');
    const ownedSet = new Set(ownedItems.map(i => i.item_id));

    // 合并 owned 状态
    const itemsWithOwned = items.map(item => ({
      ...item,
      owned: ownedSet.has(item.item_id),
    }));

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: itemsWithOwned,
      message: '获取成功',
    });
  } catch (error) {
    console.error('[Economy] 获取商店列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

// POST /api/shop/buy - 购买道具
router.post('/buy', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();
    const { item_id } = req.body;

    if (!item_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少 item_id 参数',
      });
    }

    // 查询商品信息
    const shopItem = await db('shop_items')
      .where({ item_id, is_on_sale: true })
      .first();

    if (!shopItem) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '商品不存在或已下架',
      });
    }

    // 检查限时商品是否已过期
    if (shopItem.is_limited && shopItem.limited_end && new Date(shopItem.limited_end) < new Date()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '该限时商品已过期',
      });
    }

    // 检查是否已拥有
    const owned = await db('user_inventory')
      .where({ user_id: userId, item_id })
      .first();

    if (owned) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        code: RESPONSE_CODES.CONFLICT,
        message: '已拥有该道具',
      });
    }

    await ensureEconomyRecord(db, userId);

    // 检查并扣减 Pi 币
    if (shopItem.price_pi > 0) {
      const piSuccess = await spendCurrency(db, userId, 'pi', shopItem.price_pi, 'shop_buy', `购买道具: ${shopItem.name}`);
      if (!piSuccess) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          code: RESPONSE_CODES.VALIDATION_ERROR,
          message: 'Pi 币余额不足',
        });
      }
    }

    // 检查并扣减 Alpha 币
    if (shopItem.price_alpha > 0) {
      const alphaSuccess = await spendCurrency(db, userId, 'alpha', shopItem.price_alpha, 'shop_buy', `购买道具: ${shopItem.name}`);
      if (!alphaSuccess) {
        // 如果 Alpha 币不足，需要退还已扣减的 Pi 币
        if (shopItem.price_pi > 0) {
          await addCurrency(db, userId, 'pi', shopItem.price_pi, 'shop_refund', `购买失败退还: ${shopItem.name}`);
        }
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          code: RESPONSE_CODES.VALIDATION_ERROR,
          message: 'Alpha 币余额不足',
        });
      }
    }

    // 添加到背包
    await db('user_inventory').insert({
      user_id: userId,
      item_id: shopItem.item_id,
      item_type: shopItem.item_type,
      name: shopItem.name,
      rarity: shopItem.rarity,
      style_config: shopItem.style_config,
    });

    // 增加经验
    await ensureLevelRecord(db, userId);
    await addExp(db, userId, 10, 'shop_buy');

    console.log(`[Economy] 用户 ${userId} 购买道具: ${shopItem.name}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        item_id: shopItem.item_id,
        item_type: shopItem.item_type,
        name: shopItem.name,
        rarity: shopItem.rarity,
      },
      message: '购买成功',
    });
  } catch (error) {
    console.error('[Economy] 购买道具失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

// ========== 任务接口 ==========

// GET /api/tasks - 获取任务列表
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();

    const taskType = req.query.type; // daily, weekly, main
    const query = db('user_tasks').where({ user_id: userId });

    if (taskType) {
      query.where({ task_type: taskType });
    }

    const tasks = await query
      .select('id', 'task_id', 'task_type', 'progress', 'target', 'completed', 'claimed', 'reset_at', 'created_at')
      .orderBy('created_at', 'desc');

    // 合并任务定义，返回完整数据
    const mergedTasks = tasks.map(task => {
      const def = TASK_DEFINITIONS[task.task_id] || {};
      const rewards = TASK_REWARDS[task.task_type] || { pi: 0, alpha: 0, exp: 0 };
      return {
        ...task,
        name: def.name || task.task_id,
        description: def.description || '',
        reward_pi: rewards.pi,
        reward_alpha: rewards.alpha,
        reward_exp: rewards.exp,
      };
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: mergedTasks,
      message: '获取成功',
    });
  } catch (error) {
    console.error('[Economy] 获取任务列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

// POST /api/tasks/claim - 领取任务奖励
router.post('/claim', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();
    const { task_id, task_type } = req.body;

    if (!task_id || !task_type) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少 task_id 或 task_type 参数',
      });
    }

    const validTypes = ['daily', 'weekly', 'main'];
    if (!validTypes.includes(task_type)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '无效的任务类型',
      });
    }

    // 查询任务记录
    const task = await db('user_tasks')
      .where({ user_id: userId, task_id, task_type })
      .first();

    if (!task) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '任务不存在',
      });
    }

    if (!task.completed) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '任务尚未完成',
      });
    }

    if (task.claimed) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '奖励已领取',
      });
    }

    const rewards = TASK_REWARDS[task_type] || { pi: 0, alpha: 0, exp: 0 };

    await ensureEconomyRecord(db, userId);
    await ensureLevelRecord(db, userId);

    // 发放奖励
    if (rewards.pi > 0) {
      await addCurrency(db, userId, 'pi', rewards.pi, 'task_claim', `领取${task_type}任务奖励: ${task_id}`);
    }
    if (rewards.alpha > 0) {
      await addCurrency(db, userId, 'alpha', rewards.alpha, 'task_claim', `领取${task_type}任务奖励: ${task_id}`);
    }
    if (rewards.exp > 0) {
      await addExp(db, userId, rewards.exp, 'task_claim');
    }

    // 标记为已领取
    await db('user_tasks')
      .where({ id: task.id })
      .update({ claimed: true });

    console.log(`[Economy] 用户 ${userId} 领取任务奖励: ${task_id} (${task_type})`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        task_id,
        task_type,
        rewards,
      },
      message: '奖励领取成功',
    });
  } catch (error) {
    console.error('[Economy] 领取任务奖励失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

// ========== 成就接口 ==========

// GET /api/achievements - 获取成就列表
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();

    // 获取用户已完成的成就
    const completed = await db('user_achievements')
      .where({ user_id: userId })
      .select('achievement_id', 'completed_at', 'claimed');

    const completedMap = {};
    completed.forEach(a => {
      completedMap[a.achievement_id] = {
        completed: true,
        completed_at: a.completed_at,
        claimed: a.claimed,
      };
    });

    // 返回所有成就定义，合并用户完成状态
    const allAchievements = Object.entries(ACHIEVEMENT_DEFINITIONS).map(([id, def]) => {
      const rewards = ACHIEVEMENT_REWARDS[id] || { pi: 0, alpha: 0, exp: 0 };
      const userProgress = completedMap[id] || {};
      return {
        achievement_id: id,
        name: def.name,
        description: def.description,
        icon: def.icon,
        reward_pi: rewards.pi,
        reward_alpha: rewards.alpha,
        reward_exp: rewards.exp,
        completed: !!userProgress.completed,
        completed_at: userProgress.completed_at || null,
        claimed: !!userProgress.claimed,
        progress: userProgress.completed ? 1 : 0,
        target: 1,
      };
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: allAchievements,
      message: '获取成功',
    });
  } catch (error) {
    console.error('[Economy] 获取成就列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

// POST /api/achievements/claim - 领取成就奖励
router.post('/claim', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const db = getDB();
    const { achievement_id } = req.body;

    if (!achievement_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少 achievement_id 参数',
      });
    }

    // 查询成就记录
    const achievement = await db('user_achievements')
      .where({ user_id: userId, achievement_id })
      .first();

    if (!achievement) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '成就不存在',
      });
    }

    if (achievement.claimed) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '奖励已领取',
      });
    }

    const rewards = ACHIEVEMENT_REWARDS[achievement_id] || { pi: 0, alpha: 0, exp: 0 };

    await ensureEconomyRecord(db, userId);
    await ensureLevelRecord(db, userId);

    // 发放奖励
    if (rewards.pi > 0) {
      await addCurrency(db, userId, 'pi', rewards.pi, 'achievement_claim', `领取成就奖励: ${achievement_id}`);
    }
    if (rewards.alpha > 0) {
      await addCurrency(db, userId, 'alpha', rewards.alpha, 'achievement_claim', `领取成就奖励: ${achievement_id}`);
    }
    if (rewards.exp > 0) {
      await addExp(db, userId, rewards.exp, 'achievement_claim');
    }

    // 标记为已领取
    await db('user_achievements')
      .where({ id: achievement.id })
      .update({ claimed: true });

    console.log(`[Economy] 用户 ${userId} 领取成就奖励: ${achievement_id}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        achievement_id,
        rewards,
      },
      message: '奖励领取成功',
    });
  } catch (error) {
    console.error('[Economy] 领取成就奖励失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '服务器内部错误',
    });
  }
});

module.exports = router;
