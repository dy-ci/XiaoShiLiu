const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { getDB } = require('../utils/db');
const { authenticateToken } = require('../middleware/auth');

// 获取评论通知
router.get('/comments', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const rows = await db({ n: 'notifications' })
      .leftJoin({ u: 'users' }, 'n.sender_id', 'u.id')
      .leftJoin({ p: 'posts' }, 'n.target_id', 'p.id')
      .leftJoin({ c: 'comments' }, 'n.comment_id', 'c.id')
      .where({ 'n.user_id': userId })
      .whereIn('n.type', [4, 5, 7, 8])
      .select(
        'n.*',
        'u.id as from_user_auto_id',
        'u.nickname as from_nickname',
        'u.avatar as from_avatar',
        'u.user_id as from_user_id',
        'u.verified as from_verified',
        'p.title as post_title',
        'p.type as post_type',
        'p.user_id as post_author_id',
        db.raw(`CASE 
          WHEN p.type = 2 THEN (SELECT pv.cover_url FROM post_videos pv WHERE pv.post_id = p.id ORDER BY pv.id LIMIT 1)
          ELSE (SELECT pi.image_url FROM post_images pi WHERE pi.post_id = p.id ORDER BY pi.id LIMIT 1)
        END as post_image`),
        'c.content as comment_content',
        'c.created_at as comment_created_at',
        'c.like_count as comment_like_count',
        db.raw(`CASE 
          WHEN n.comment_id IS NOT NULL THEN 
            CASE WHEN EXISTS(SELECT 1 FROM likes WHERE user_id = ? AND target_type = 2 AND target_id = n.comment_id) 
                 THEN 1 ELSE 0 END
          ELSE 0
        END as comment_is_liked`, [userId]),
        db.raw(`CASE 
          WHEN n.type = 5 AND c.parent_id IS NOT NULL THEN 
            (SELECT content FROM comments WHERE id = c.parent_id)
          ELSE NULL 
        END as parent_comment_content`)
      )
      .orderBy('n.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 获取总数
    const countResult = await db('notifications')
      .where({ user_id: userId })
      .whereIn('type', [4, 5, 7, 8])
      .count('* as total')
      .first();

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        notifications: rows,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.total),
          pages: Math.ceil(parseInt(countResult.total) / limit)
        }
      }
    });
  } catch (error) {
    console.error('获取评论通知失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取点赞通知
router.get('/likes', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const rows = await db({ n: 'notifications' })
      .leftJoin({ u: 'users' }, 'n.sender_id', 'u.id')
      .leftJoin({ p: 'posts' }, 'n.target_id', 'p.id')
      .where({ 'n.user_id': userId })
      .whereIn('n.type', [1, 2])
      .select(
        'n.*',
        'u.id as from_user_auto_id',
        'u.nickname as from_nickname',
        'u.avatar as from_avatar',
        'u.user_id as from_user_id',
        'u.verified as from_verified',
        'p.title as post_title',
        'p.type as post_type',
        'p.user_id as post_author_id',
        db.raw(`CASE 
          WHEN p.type = 2 THEN (SELECT pv.cover_url FROM post_videos pv WHERE pv.post_id = p.id ORDER BY pv.id LIMIT 1)
          ELSE (SELECT pi.image_url FROM post_images pi WHERE pi.post_id = p.id ORDER BY pi.id LIMIT 1)
        END as post_image`),
        db.raw(`CASE 
          WHEN n.type = 1 THEN 1
          WHEN n.type = 2 THEN 2
          ELSE 1
        END as target_type`),
        db.raw(`CASE 
          WHEN n.type = 2 THEN n.comment_id
          ELSE NULL
        END as comment_id`)
      )
      .orderBy('n.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 获取总数
    const countResult = await db('notifications')
      .where({ user_id: userId })
      .whereIn('type', [1, 2])
      .count('* as total')
      .first();

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        notifications: rows,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.total),
          pages: Math.ceil(parseInt(countResult.total) / limit)
        }
      }
    });
  } catch (error) {
    console.error('获取点赞通知失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取关注通知
router.get('/follows', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const rows = await db({ n: 'notifications' })
      .leftJoin({ u: 'users' }, 'n.sender_id', 'u.id')
      .where({ 'n.user_id': userId, 'n.type': 6 })
      .select(
        'n.*',
        'u.id as from_user_auto_id',
        'u.nickname as from_nickname',
        'u.avatar as from_avatar',
        'u.user_id as from_user_id',
        'u.verified as from_verified'
      )
      .orderBy('n.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 获取总数
    const countResult = await db('notifications')
      .where({ user_id: userId, type: 6 })
      .count('* as total')
      .first();

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        notifications: rows,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.total),
          pages: Math.ceil(parseInt(countResult.total) / limit)
        }
      }
    });
  } catch (error) {
    console.error('获取关注通知失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取收藏通知
router.get('/collections', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const rows = await db({ n: 'notifications' })
      .leftJoin({ u: 'users' }, 'n.sender_id', 'u.id')
      .leftJoin({ p: 'posts' }, 'n.target_id', 'p.id')
      .where({ 'n.user_id': userId, 'n.type': 3 })
      .select(
        'n.*',
        'u.id as from_user_auto_id',
        'u.nickname as from_nickname',
        'u.avatar as from_avatar',
        'u.user_id as from_user_id',
        'u.verified as from_verified',
        'p.title as post_title',
        'p.type as post_type',
        db.raw(`CASE 
          WHEN p.type = 2 THEN (SELECT pv.cover_url FROM post_videos pv WHERE pv.post_id = p.id ORDER BY pv.id LIMIT 1)
          ELSE (SELECT pi.image_url FROM post_images pi WHERE pi.post_id = p.id ORDER BY pi.id LIMIT 1)
        END as post_image`)
      )
      .orderBy('n.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 获取总数
    const countResult = await db('notifications')
      .where({ user_id: userId, type: 3 })
      .count('* as total')
      .first();

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        notifications: rows,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.total),
          pages: Math.ceil(parseInt(countResult.total) / limit)
        }
      }
    });
  } catch (error) {
    console.error('获取收藏通知失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取通知列表（通用接口）
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;
    const type = req.query.type;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    let query = db({ n: 'notifications' })
      .leftJoin({ u: 'users' }, 'n.sender_id', 'u.id')
      .where({ 'n.user_id': userId })
      .select(
        'n.*',
        'u.id as from_user_auto_id',
        'u.nickname as from_nickname',
        'u.avatar as from_avatar',
        'u.user_id as from_user_id',
        'u.verified'
      );

    if (type) {
      query.where('n.type', type);
    }

    const rows = await query
      .orderBy('n.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 获取总数
    let countQuery = db('notifications').where({ user_id: userId });
    if (type) {
      countQuery.where('type', type);
    }
    
    const countResult = await countQuery.count('* as total').first();

    // 获取未读数量
    const unreadResult = await db('notifications')
      .where({ user_id: userId, is_read: false })
      .count('* as unread')
      .first();

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        notifications: rows,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.total),
          pages: Math.ceil(parseInt(countResult.total) / limit)
        },
        unread: parseInt(unreadResult.unread)
      }
    });
  } catch (error) {
    console.error('获取通知列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 标记所有通知为已读（必须在 /:id/read 之前注册，否则 "read-all" 会被当作 id 参数）
router.put('/read-all', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;

    // 标记所有通知为已读
    await db('notifications')
      .where({ user_id: userId, is_read: false })
      .update({ is_read: true });

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '全部标记成功' });
  } catch (error) {
    console.error('标记所有通知已读失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 标记通知为已读
router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const notificationId = req.params.id;
    const userId = req.user.id;

    // 验证通知是否属于当前用户
    const notificationExists = await db('notifications')
      .where({ id: notificationId, user_id: userId })
      .first();

    if (!notificationExists) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '通知不存在' });
    }

    // 标记为已读
    await db('notifications')
      .where({ id: notificationId })
      .update({ is_read: true });

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '标记成功' });
  } catch (error) {
    console.error('标记通知已读失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 删除通知
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const notificationId = req.params.id;
    const userId = req.user.id;

    // 验证通知是否属于当前用户并删除
    const result = await db('notifications')
      .where({ id: notificationId, user_id: userId })
      .del();

    if (result === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '通知不存在' });
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' });
  } catch (error) {
    console.error('删除通知失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取按类型分组的未读通知数量
router.get('/unread-count-by-type', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;

    // 按类型统计未读通知数量
    const result = await db('notifications')
      .where({ user_id: userId, is_read: false })
      .select(
        db.raw("SUM(CASE WHEN type IN (4, 5, 7, 8) THEN 1 ELSE 0 END) as comments"),
        db.raw("SUM(CASE WHEN type IN (1, 2) THEN 1 ELSE 0 END) as likes"),
        db.raw("SUM(CASE WHEN type = 3 THEN 1 ELSE 0 END) as collections"),
        db.raw("SUM(CASE WHEN type = 6 THEN 1 ELSE 0 END) as follows"),
        db.raw("COUNT(*) as total")
      )
      .first();

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        comments: parseInt(result.comments || 0),
        likes: parseInt(result.likes || 0),
        collections: parseInt(result.collections || 0),
        follows: parseInt(result.follows || 0),
        total: parseInt(result.total || 0)
      }
    });
  } catch (error) {
    console.error('获取按类型分组的未读通知数量失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取未读通知数量（使用Redis计数器优化）
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;

    // 尝试从Redis获取缓存的未读数
    try {
      const { getCache, setCache, getCounter, incrCounter, decrCounter } = require('../utils/redis');
      const cacheKey = `notify:unread:${userId}`;
      const cached = await getCache(cacheKey);
      
      if (cached !== null && typeof cached === 'number') {
        return res.json({
          code: RESPONSE_CODES.SUCCESS,
          message: 'success',
          data: { count: cached }
        });
      }
    } catch (e) {
      // Redis不可用，降级到数据库查询
    }

    const result = await db('notifications')
      .where({ user_id: userId, is_read: false })
      .count('* as count')
      .first();

    const count = parseInt(result.count);

    // 写入Redis缓存
    try {
      const { setCache } = require('../utils/redis');
      await setCache(`notify:unread:${userId}`, count, 300); // 缓存5分钟
    } catch (e) {
      // 忽略Redis写入失败
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { count }
    });
  } catch (error) {
    console.error('获取未读通知数量失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

module.exports = router;
