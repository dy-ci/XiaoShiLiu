const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { getDB } = require('../utils/db');
const { optionalAuth, authenticateToken } = require('../middleware/auth');
const NotificationHelper = require('../utils/notificationHelper');
const { sanitizeContent } = require('../utils/contentSecurity');

// 辅助函数：通过悦社号查找用户ID
async function getUserIdByUserParam(db, userIdParam) {
  const userRow = await db('users').where({ user_id: userIdParam }).select('id').first();
  return userRow ? userRow.id : null;
}

// 辅助函数：获取笔记的附加信息（图片、视频、标签、点赞、收藏状态）
async function enrichPostsWithDetails(db, rows, currentUserId) {
  if (!rows || rows.length === 0) return;

  const postIds = rows.map(p => p.id);

  // 批量获取视频信息
  const videos = await db('post_videos').whereIn('post_id', postIds).select('*');
  const videoMap = {};
  videos.forEach(v => { videoMap[v.post_id] = v; });

  // 批量获取图片信息
  const images = await db('post_images').whereIn('post_id', postIds).select('*');
  const imageMap = {};
  images.forEach(img => {
    if (!imageMap[img.post_id]) imageMap[img.post_id] = [];
    imageMap[img.post_id].push(img.image_url);
  });

  // 批量获取标签信息
  const tags = await db('tags')
    .join('post_tags', 'tags.id', 'post_tags.tag_id')
    .whereIn('post_tags.post_id', postIds)
    .select('post_tags.post_id', 'tags.id', 'tags.name');
  const tagMap = {};
  tags.forEach(t => {
    if (!tagMap[t.post_id]) tagMap[t.post_id] = [];
    tagMap[t.post_id].push({ id: t.id, name: t.name });
  });

  // 批量获取点赞状态
  let likedPostIds = new Set();
  if (currentUserId) {
    const likes = await db('likes')
      .where({ user_id: String(currentUserId), target_type: '1' })
      .whereIn('target_id', postIds.map(String))
      .select('target_id');
    likedPostIds = new Set(likes.map(l => l.target_id.toString()));
  }

  // 批量获取收藏状态
  let collectedPostIds = new Set();
  if (currentUserId) {
    const collections = await db('collections')
      .where({ user_id: String(currentUserId) })
      .whereIn('post_id', postIds.map(String))
      .select('post_id');
    collectedPostIds = new Set(collections.map(c => c.post_id.toString()));
  }

  // 组装数据
  for (let post of rows) {
    if (post.type === 2) {
      const video = videoMap[post.id];
      post.images = video && video.cover_url ? [video.cover_url] : [];
      post.video_url = video ? video.video_url : null;
      post.image = video && video.cover_url ? video.cover_url : null;
    } else {
      const postImages = imageMap[post.id] || [];
      post.images = postImages;
      post.image = postImages.length > 0 ? postImages[0] : null;
    }
    post.tags = tagMap[post.id] || [];
    post.liked = likedPostIds.has(post.id.toString());
    post.collected = collectedPostIds.has(post.id.toString());
  }
}

// 辅助函数：处理用户列表的关注状态
function processUserFollowStatus(rows, currentUserId, followingSet, mutualSet) {
  if (!currentUserId || !rows || rows.length === 0) return;

  for (let user of rows) {
    const userIdStr = user.id.toString();
    user.isFollowing = followingSet.has(userIdStr);
    const isFollowedBy = mutualSet.has(userIdStr);
    user.isMutual = user.isFollowing && isFollowedBy;

    // 设置按钮类型
    if (user.id.toString() === currentUserId.toString()) {
      user.buttonType = 'self';
    } else if (user.isMutual) {
      user.buttonType = 'mutual';
    } else if (user.isFollowing) {
      user.buttonType = 'unfollow';
    } else if (isFollowedBy) {
      user.buttonType = 'back';
    } else {
      user.buttonType = 'follow';
    }
  }
}

// 搜索用户（必须放在 /:id 之前）
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const keyword = req.query.keyword;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const currentUserId = req.user ? req.user.id : null;

    if (!keyword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入搜索关键词' });
    }

    const db = getDB();

    // 搜索用户：支持昵称和悦社号搜索
    const rows = await db('users')
      .where(function() { this.where('nickname', 'like', `%${keyword}%`).orWhere('user_id', 'like', `%${keyword}%`); })
      .select(
        'id', 'user_id', 'nickname', 'avatar', 'bio', 'location',
        'follow_count', 'fans_count', 'like_count', 'created_at', 'verified'
      )
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 批量获取用户笔记数，避免 N+1 查询
    if (rows.length > 0) {
      const userIds = rows.map(u => u.id);
      const postCounts = await db('posts')
        .select('user_id')
        .whereIn('user_id', userIds)
        .where({ status: 0 })
        .groupBy('user_id')
        .count('* as count');
      
      const postCountMap = {};
      postCounts.forEach(pc => {
        postCountMap[pc.user_id] = parseInt(pc.count);
      });
      
      for (let user of rows) {
        user.post_count = postCountMap[user.id] || 0;
      }
    }

    // 检查关注状态（仅在用户已登录时）
    if (currentUserId && rows.length > 0) {
      const userIds = rows.map(u => u.id.toString());

      // 批量获取关注状态
      const follows = await db('follows')
        .where({ follower_id: String(currentUserId) })
        .whereIn('following_id', userIds)
        .select('following_id');
      const followingSet = new Set(follows.map(f => f.following_id.toString()));

      // 批量获取互相关注状态
      const mutuals = await db('follows')
        .where({ following_id: String(currentUserId) })
        .whereIn('follower_id', userIds)
        .select('follower_id');
      const mutualSet = new Set(mutuals.map(f => f.follower_id.toString()));

      processUserFollowStatus(rows, currentUserId, followingSet, mutualSet);
    } else {
      for (let user of rows) {
        user.isFollowing = false;
        user.isMutual = false;
        user.buttonType = 'follow';
      }
    }

    // 获取总数
    const totalResult = await db('users')
      .where(function() { this.where('nickname', 'like', `%${keyword}%`).orWhere('user_id', 'like', `%${keyword}%`); })
      .count('* as total')
      .first();
    const total = parseInt(totalResult.total);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        users: rows,
        keyword,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('搜索用户失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户个性标签
router.get('/:id/personality-tags', async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;

    const row = await db('users').where({ user_id: userIdParam })
      .select('gender', 'zodiac_sign', 'mbti', 'education', 'major', 'interests')
      .first();

    if (!row) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '用户不存在',
        data: null
      });
    }

    const personalityTags = { ...row };

    // 处理interests字段
    if (personalityTags.interests) {
      try {
        personalityTags.interests = typeof personalityTags.interests === 'string'
          ? JSON.parse(personalityTags.interests)
          : personalityTags.interests;
      } catch (e) {
        personalityTags.interests = null;
      }
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: personalityTags
    });
  } catch (error) {
    console.error('获取用户个性标签失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户信息
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;

    const row = await db({ u: 'users' })
      .leftJoin({ uv: 'user_verification' }, function() {
        this.on('u.id', '=', 'uv.user_id').andOnVal('uv.status', 1);
      })
      .where('u.user_id', userIdParam)
      .select(
        'u.id', 'u.user_id', 'u.nickname', 'u.avatar', 'u.bio', 'u.location',
        'u.gender', 'u.zodiac_sign', 'u.mbti', 'u.education',
        'u.major', 'u.interests', 'u.follow_count', 'u.fans_count',
        'u.like_count', 'u.created_at', 'u.verified', 'uv.title as verified_title'
      )
      .first();

    if (!row) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '用户不存在',
        data: null
      });
    }

    const user = { ...row };

    // 处理interests字段
    if (user.interests) {
      try {
        user.interests = typeof user.interests === 'string' ? JSON.parse(user.interests) : user.interests;
      } catch (e) {
        user.interests = null;
      }
    }

    // 查询用户的封禁状态
    const ban = await db('user_ban')
      .where({ user_id: String(user.id) })
      .whereIn('status', [0, 3])
      .orderBy('created_at', 'desc')
      .select('id', 'reason', 'end_time', 'status', 'created_at')
      .first();

    user.ban = ban ? { end_time: ban.end_time, reason: ban.reason, created_at: ban.created_at } : null;

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: user
    });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户列表
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const rows = await db('users')
      .select('id', 'user_id', 'nickname', 'avatar', 'bio', 'location', 'follow_count', 'fans_count', 'like_count', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const countResult = await db('users').count('* as total').first();
    const total = parseInt(countResult.total);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        users: rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户发布的笔记列表
router.get('/:id/posts', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const currentUserId = req.user ? req.user.id : null;
    const category = req.query.category;
    const keyword = req.query.keyword;
    const sort = req.query.sort || 'created_at';
    const statusFilter = req.query.status;

    // 通过悦社号查找对应的数字ID
    const userId = await getUserIdByUserParam(db, userIdParam);
    if (!userId) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    // 构建查询条件
    let query = db({ p: 'posts' })
      .leftJoin({ u: 'users' }, 'p.user_id', 'u.id')
      .leftJoin({ c: 'categories' }, 'p.category_id', 'c.id')
      .where('p.user_id', String(userId));

    // 根据status参数决定查询哪些状态（仅允许本人查看非公开笔记）
    if (statusFilter === 'all' && currentUserId && String(currentUserId) === String(userId)) {
      query = query.whereIn('p.status', [0, 1, 2, 3]);
    } else if (statusFilter === '1' && currentUserId && String(currentUserId) === String(userId)) {
      // 仅本人可查看草稿
      query = query.where('p.status', 1);
    } else {
      query = query.where('p.status', 0);
    }

    if (category) {
      query = query.andWhere('p.category_id', category);
    }

    if (keyword) {
      query = query.andWhere(function() {
        this.where('p.title', 'like', `%${keyword}%`)
            .orWhere('p.content', 'like', `%${keyword}%`);
      });
    }

    // 构建排序条件
    const allowedSortFields = ['created_at', 'view_count', 'like_count', 'collect_count', 'comment_count'];
    const sortField = allowedSortFields.includes(sort) ? sort : 'created_at';

    // 查询用户发布的笔记
    const rows = await query
      .select(
        'p.*', 'u.nickname', 'u.avatar as user_avatar', 'u.user_id as author_account',
        'u.location', 'c.name as category'
      )
      .orderBy(`p.${sortField}`, 'desc')
      .limit(limit)
      .offset(offset);

    // 获取每个笔记的附加信息
    await enrichPostsWithDetails(db, rows, currentUserId);

    // 计算总数时也要考虑筛选条件
    let countQuery = db({ p: 'posts' }).where('p.user_id', String(userId));
    if (statusFilter === 'all') {
      countQuery = countQuery.whereIn('p.status', [0, 2, 3]);
    } else {
      countQuery = countQuery.where('p.status', 0);
    }
    if (category) countQuery = countQuery.andWhere('p.category_id', category);
    if (keyword) {
      countQuery = countQuery.andWhere(function() {
        this.where('p.title', 'like', `%${keyword}%`)
            .orWhere('p.content', 'like', `%${keyword}%`);
      });
    }
    const countResult = await countQuery.count('* as total').first();
    const total = parseInt(countResult.total);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        posts: rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('获取用户笔记列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户收藏列表
router.get('/:id/collections', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const currentUserId = req.user ? req.user.id : null;

    // 通过悦社号查找对应的数字ID
    const userId = await getUserIdByUserParam(db, userIdParam);
    if (!userId) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    const rows = await db({ c: 'collections' })
      .leftJoin({ p: 'posts' }, 'c.post_id', 'p.id')
      .leftJoin({ u: 'users' }, 'p.user_id', 'u.id')
      .where({ 'c.user_id': String(userId), 'p.status': 0 })
      .select(
        'p.*', 'u.nickname', 'u.avatar as user_avatar', 'u.user_id as author_account',
        'u.location', 'c.created_at as collected_at'
      )
      .orderBy('c.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 获取每个笔记的附加信息
    await enrichPostsWithDetails(db, rows, currentUserId);

    const countResult = await db({ c: 'collections' })
      .leftJoin({ p: 'posts' }, 'c.post_id', 'p.id')
      .where({ 'c.user_id': String(userId), 'p.status': 0 })
      .count('* as total')
      .first();
    const total = parseInt(countResult.total);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        collections: rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('获取收藏列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户点赞列表
router.get('/:id/likes', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const currentUserId = req.user ? req.user.id : null;

    // 通过悦社号查找对应的数字ID
    const userId = await getUserIdByUserParam(db, userIdParam);
    if (!userId) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    // 查询笔记列表
    const rows = await db({ l: 'likes' })
      .leftJoin({ p: 'posts' }, 'l.target_id', 'p.id')
      .leftJoin({ u: 'users' }, 'p.user_id', 'u.id')
      .where({ 'l.user_id': String(userId), 'l.target_type': '1', 'p.status': 0 })
      .select(
        'p.*', 'u.nickname', 'u.avatar as user_avatar', 'u.user_id as author_account',
        'u.location', 'l.created_at as liked_at'
      )
      .orderBy('l.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 获取每个笔记的附加信息
    await enrichPostsWithDetails(db, rows, currentUserId);

    const countResult = await db({ l: 'likes' })
      .leftJoin({ p: 'posts' }, 'l.target_id', 'p.id')
      .where({ 'l.user_id': String(userId), 'l.target_type': '1', 'p.status': 0 })
      .count('* as total')
      .first();
    const total = parseInt(countResult.total);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        posts: rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('获取点赞列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 关注用户
router.post('/:id/follow', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;
    const followerId = req.user.id;

    // 获取被关注用户的数字ID
    const userId = await getUserIdByUserParam(db, userIdParam);
    if (!userId) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    // 不能关注自己
    if (String(followerId) === String(userId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '不能关注自己' });
    }

    // 检查是否已经关注
    const existingFollow = await db('follows')
      .where({ follower_id: String(followerId), following_id: String(userId) })
      .select('id')
      .first();

    if (existingFollow) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '已经关注了该用户' });
    }

    // 添加关注记录 + 更新计数（使用事务保证一致性）
    await db.transaction(async (trx) => {
      await trx('follows').insert({ follower_id: String(followerId), following_id: String(userId) });
      await trx('users').where({ id: followerId }).update({ follow_count: trx.raw('follow_count + 1') });
      await trx('users').where({ id: userId }).update({ fans_count: trx.raw('fans_count + 1') });
    });

    // 创建关注通知
    try {
      const notificationData = NotificationHelper.createFollowNotification(userId, followerId);
      await NotificationHelper.insertNotification(notificationData);
    } catch (notificationError) {
      console.error('关注通知创建失败:', notificationError);
    }

    console.log(`关注成功 - 用户ID: ${followerId}, 目标用户ID: ${userId}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '关注成功' });
  } catch (error) {
    console.error('关注失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 取消关注用户
router.delete('/:id/follow', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;
    const followerId = req.user.id;

    // 通过悦社号查找对应的数字ID
    const userId = await getUserIdByUserParam(db, userIdParam);
    if (!userId) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    // 删除关注记录 + 更新计数（使用事务保证一致性，防止计数器负数）
    await db.transaction(async (trx) => {
      await trx('follows')
        .where({ follower_id: String(followerId), following_id: String(userId) })
        .del();
      await trx('users').where({ id: followerId }).update({ follow_count: trx.raw('GREATEST(follow_count - 1, 0)') });
      await trx('users').where({ id: userId }).update({ fans_count: trx.raw('GREATEST(fans_count - 1, 0)') });
    });

    // 删除相关的关注通知
    await db('notifications')
      .where({
        user_id: String(userId),
        sender_id: String(followerId),
        type: NotificationHelper.TYPES.FOLLOW
      })
      .del();

    console.log(`取消关注成功 - 用户ID: ${followerId}, 目标用户ID: ${userId}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '取消关注成功' });
  } catch (error) {
    console.error('取消关注失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取关注状态
router.get('/:id/follow-status', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;
    const followerId = req.user ? req.user.id : null;

    // 获取用户的数字ID
    const userId = await getUserIdByUserParam(db, userIdParam);
    if (!userId) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    let isFollowing = false;
    let isMutual = false;
    let buttonType = 'follow';

    // 如果用户已登录，检查关注状态
    if (followerId) {
      const followResult = await db('follows')
        .where({ follower_id: String(followerId), following_id: String(userId) })
        .select('id')
        .first();
      isFollowing = !!followResult;

      // 检查是否互相关注
      const mutualResult = await db('follows')
        .where({ follower_id: String(userId), following_id: String(followerId) })
        .select('id')
        .first();
      isMutual = isFollowing && !!mutualResult;

      // 确定按钮类型
      if (String(userId) === String(followerId)) {
        buttonType = 'self';
      } else if (isMutual) {
        buttonType = 'mutual';
      } else if (isFollowing) {
        buttonType = 'unfollow';
      } else if (mutualResult) {
        buttonType = 'back';
      }
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { followed: isFollowing, isFollowing, isMutual, buttonType }
    });
  } catch (error) {
    console.error('获取关注状态失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户关注列表
router.get('/:id/following', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const currentUserId = req.user ? req.user.id : null;

    // 通过悦社号查找对应的数字ID
    const userId = await getUserIdByUserParam(db, userIdParam);
    if (!userId) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    // 查询所有关注的用户
    const rows = await db({ f: 'follows' })
      .leftJoin({ u: 'users' }, 'f.following_id', 'u.id')
      .where('f.follower_id', String(userId))
      .select(
        'u.id', 'u.user_id', 'u.nickname', 'u.avatar', 'u.bio', 'u.location',
        'u.follow_count', 'u.fans_count', 'u.like_count', 'u.created_at', 'u.verified',
        'f.created_at as followed_at'
      )
      .orderBy('f.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 批量获取笔记数（避免N+1查询）
    if (rows.length > 0) {
      const userIds = rows.map(u => u.id);
      const postCounts = await db('posts')
        .whereIn('user_id', userIds)
        .andWhere('status', 0)
        .select('user_id')
        .count('* as count')
        .groupBy('user_id');
      
      const postCountMap = {};
      postCounts.forEach(pc => {
        postCountMap[pc.user_id] = parseInt(pc.count);
      });
      
      rows.forEach(user => {
        user.post_count = postCountMap[user.id] || 0;
      });
    }

    // 检查当前用户与这些用户的关注状态
    if (currentUserId && rows.length > 0) {
      const userIds = rows.map(u => u.id.toString());

      const follows = await db('follows')
        .where({ follower_id: String(currentUserId) })
        .whereIn('following_id', userIds)
        .select('following_id');
      const followingSet = new Set(follows.map(f => f.following_id.toString()));

      const mutuals = await db('follows')
        .where({ following_id: String(currentUserId) })
        .whereIn('follower_id', userIds)
        .select('follower_id');
      const mutualSet = new Set(mutuals.map(f => f.follower_id.toString()));

      processUserFollowStatus(rows, currentUserId, followingSet, mutualSet);
    } else {
      for (let user of rows) {
        user.isFollowing = false;
        user.isMutual = false;
        user.buttonType = 'follow';
      }
    }

    // 计算所有关注的总数
    const countResult = await db('follows').where({ follower_id: String(userId) }).count('* as total').first();
    const total = parseInt(countResult.total);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        following: rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('获取关注列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户粉丝列表
router.get('/:id/followers', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const currentUserId = req.user ? req.user.id : null;

    // 通过悦社号查找对应的数字ID
    const userId = await getUserIdByUserParam(db, userIdParam);
    if (!userId) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    const rows = await db({ f: 'follows' })
      .leftJoin({ u: 'users' }, 'f.follower_id', 'u.id')
      .where('f.following_id', String(userId))
      .select(
        'u.id', 'u.user_id', 'u.nickname', 'u.avatar', 'u.bio', 'u.location',
        'u.follow_count', 'u.fans_count', 'u.like_count', 'u.created_at', 'u.verified',
        'f.created_at as followed_at'
      )
      .orderBy('f.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 批量获取笔记数（避免N+1查询）
    if (rows.length > 0) {
      const userIds = rows.map(u => u.id);
      const postCounts = await db('posts')
        .whereIn('user_id', userIds)
        .andWhere('status', 0)
        .select('user_id')
        .count('* as count')
        .groupBy('user_id');
      
      const postCountMap = {};
      postCounts.forEach(pc => {
        postCountMap[pc.user_id] = parseInt(pc.count);
      });
      
      rows.forEach(user => {
        user.post_count = postCountMap[user.id] || 0;
      });
    }

    // 检查当前用户与这些用户的关注状态
    if (currentUserId && rows.length > 0) {
      const userIds = rows.map(u => u.id.toString());

      const follows = await db('follows')
        .where({ follower_id: String(currentUserId) })
        .whereIn('following_id', userIds)
        .select('following_id');
      const followingSet = new Set(follows.map(f => f.following_id.toString()));

      const mutuals = await db('follows')
        .where({ following_id: String(currentUserId) })
        .whereIn('follower_id', userIds)
        .select('follower_id');
      const mutualSet = new Set(mutuals.map(f => f.follower_id.toString()));

      processUserFollowStatus(rows, currentUserId, followingSet, mutualSet);
    } else {
      for (let user of rows) {
        user.isFollowing = false;
        user.isMutual = false;
        user.buttonType = 'follow';
      }
    }

    const countResult = await db('follows').where({ following_id: String(userId) }).count('* as total').first();
    const total = parseInt(countResult.total);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        followers: rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('获取粉丝列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取互相关注列表
router.get('/:id/mutual-follows', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const currentUserId = req.user ? req.user.id : null;

    // 通过悦社号查找对应的数字ID
    const userId = await getUserIdByUserParam(db, userIdParam);
    if (!userId) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    // 查询互关用户
    const rows = await db({ u: 'users' })
      .whereIn('u.id', function(subQ) {
        subQ.select('f1.following_id')
          .from('follows as f1')
          .where('f1.follower_id', String(userId))
          .whereExists(function(existsQ) {
            existsQ.select(1)
              .from('follows as f2')
              .whereRaw('f2.follower_id = f1.following_id')
              .andWhere('f2.following_id', String(userId));
          });
      })
      .select(
        'u.id', 'u.user_id', 'u.nickname', 'u.avatar', 'u.bio', 'u.location',
        'u.follow_count', 'u.fans_count', 'u.like_count', 'u.created_at', 'u.verified'
      )
      .orderBy('u.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // 为每个用户添加笔记数
    for (let user of rows) {
      const postCount = await db('posts').where({ user_id: user.id, status: 0 }).count('* as count').first();
      user.post_count = parseInt(postCount.count);
    }

    // 检查当前用户与这些用户的关注状态
    if (currentUserId && rows.length > 0) {
      const userIds = rows.map(u => u.id.toString());

      const follows = await db('follows')
        .where({ follower_id: String(currentUserId) })
        .whereIn('following_id', userIds)
        .select('following_id');
      const followingSet = new Set(follows.map(f => f.following_id.toString()));

      const mutuals = await db('follows')
        .where({ following_id: String(currentUserId) })
        .whereIn('follower_id', userIds)
        .select('follower_id');
      const mutualSet = new Set(mutuals.map(f => f.follower_id.toString()));

      processUserFollowStatus(rows, currentUserId, followingSet, mutualSet);
    } else {
      for (let user of rows) {
        user.isFollowing = false;
        user.isMutual = false;
        user.buttonType = 'follow';
      }
    }

    // 获取互关总数
    const countResult = await db({ u: 'users' })
      .whereIn('u.id', function(subQ) {
        subQ.select('f1.following_id')
          .from('follows as f1')
          .where('f1.follower_id', String(userId))
          .whereExists(function(existsQ) {
            existsQ.select(1)
              .from('follows as f2')
              .whereRaw('f2.follower_id = f1.following_id')
              .andWhere('f2.following_id', String(userId));
          });
      })
      .count('* as total')
      .first();
    const total = parseInt(countResult.total);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        mutualFollows: rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('获取互关列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户统计信息
router.get('/:id/stats', async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;

    // 通过悦社号查找对应的数字ID
    const userId = await getUserIdByUserParam(db, userIdParam);
    if (!userId) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    // 获取用户基本统计信息
    const userStats = await db('users')
      .where({ id: String(userId) })
      .select('follow_count', 'fans_count', 'like_count')
      .first();

    if (!userStats) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    // 获取笔记数量
    const postCount = await db('posts')
      .where({ user_id: String(userId), status: 0 })
      .count('* as count')
      .first();

    // 获取该用户发布的笔记被收藏的总数量
    const collectCount = await db({ c: 'collections' })
      .join({ p: 'posts' }, 'c.post_id', 'p.id')
      .where({ 'p.user_id': String(userId), 'p.status': 0 })
      .count('* as count')
      .first();

    // 计算获赞与收藏总数
    const likesAndCollects = parseInt(userStats.like_count) + parseInt(collectCount.count);

    const stats = {
      follow_count: userStats.follow_count,
      fans_count: userStats.fans_count,
      post_count: parseInt(postCount.count),
      like_count: userStats.like_count,
      collect_count: parseInt(collectCount.count),
      likes_and_collects: likesAndCollects
    };

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: stats
    });
  } catch (error) {
    console.error('获取用户统计信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 更新用户资料（用户自己）
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userIdParam = req.params.id;
    const currentUserId = req.user.id;
    const { nickname, avatar, bio, location, gender, zodiac_sign, mbti, education, major, interests } = req.body;

    // 通过悦社号查找对应的数字ID
    const targetUserId = await getUserIdByUserParam(db, userIdParam);
    if (!targetUserId) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    // 检查是否是用户本人
    if (currentUserId !== targetUserId) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '只能修改自己的资料' });
    }

    // 验证必填字段
    if (!nickname || !nickname.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '昵称不能为空' });
    }

    // 构建更新数据
    const updateData = { nickname: sanitizeContent(nickname.trim()) };

    // 验证字段长度，防止数据库溢出
    if (updateData.nickname.length > 50) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '昵称长度不能超过50个字符' });
    }

    if (avatar !== undefined) updateData.avatar = avatar || '';
    if (bio !== undefined) {
      const sanitizedBio = sanitizeContent(bio || '');
      if (sanitizedBio.length > 500) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '个人简介长度不能超过500个字符' });
      }
      updateData.bio = sanitizedBio;
    }
    if (location !== undefined) {
      const locationStr = location || '';
      if (locationStr.length > 100) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '位置长度不能超过100个字符' });
      }
      updateData.location = locationStr;
    }
    if (gender !== undefined) updateData.gender = gender || null;
    if (zodiac_sign !== undefined) updateData.zodiac_sign = zodiac_sign || null;
    if (mbti !== undefined) {
      const mbtiStr = mbti || '';
      if (mbtiStr.length > 10) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: 'MBTI长度不能超过10个字符' });
      }
      updateData.mbti = mbtiStr;
    }
    if (education !== undefined) {
      const educationStr = education || '';
      if (educationStr.length > 100) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '教育背景长度不能超过100个字符' });
      }
      updateData.education = educationStr;
    }
    if (major !== undefined) {
      const majorStr = major || '';
      if (majorStr.length > 100) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '专业长度不能超过100个字符' });
      }
      updateData.major = majorStr;
    }
    if (interests !== undefined) {
      const interestsStr = typeof interests === 'object' ? JSON.stringify(interests) : interests || '';
      if (interestsStr.length > 500) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '兴趣标签长度不能超过500个字符' });
      }
      updateData.interests = interestsStr || null;
    }

    await db('users').where({ id: targetUserId }).update(updateData);

    console.log(`用户更新资料成功 - 用户ID: ${currentUserId}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '资料更新成功' });
  } catch (error) {
    console.error('更新用户资料失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

module.exports = router;
