const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { getDB } = require('../utils/db');
const { getCache, setCache, delCachePattern } = require('../utils/redis');

const CACHE_KEY_ALL = 'tags:all';
const CACHE_KEY_HOT = 'tags:hot';
const CACHE_TTL_ALL = 1800; // 30分钟
const CACHE_TTL_HOT = 900;  // 15分钟

// 获取所有标签
router.get('/', async (req, res) => {
  try {
    // 尝试从缓存获取
    const cached = await getCache(CACHE_KEY_ALL);
    if (cached) {
      return res.json({
        code: RESPONSE_CODES.SUCCESS,
        message: 'success（缓存）',
        data: cached
      });
    }

    const db = getDB();
    const rows = await db('tags')
      .select('*')
      .orderBy('name', 'asc');

    // 写入缓存
    await setCache(CACHE_KEY_ALL, rows, CACHE_TTL_ALL);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: rows
    });
  } catch (error) {
    console.error('获取标签列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取热门标签
router.get('/hot', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cacheKey = `${CACHE_KEY_HOT}:${limit}`;

    // 尝试从缓存获取
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json({
        code: RESPONSE_CODES.SUCCESS,
        message: 'success（缓存）',
        data: cached
      });
    }

    const db = getDB();
    const rows = await db('tags')
      .select('*')
      .where('use_count', '>', 0)
      .orderBy('use_count', 'desc')
      .orderBy('name', 'asc')
      .limit(limit);

    // 写入缓存
    await setCache(cacheKey, rows, CACHE_TTL_HOT);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: rows
    });
  } catch (error) {
    console.error('获取热门标签失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

module.exports = router;
