const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { getDB } = require('../utils/db');
const { optionalAuth, authenticateToken } = require('../middleware/auth');
const NotificationHelper = require('../utils/notificationHelper');
const { extractMentionedUsers, hasMentions } = require('../utils/mentionParser');
const { batchCleanupFiles } = require('../utils/fileCleanup');
const { sanitizeContent } = require('../utils/contentSecurity');
const sharp = require('sharp');
const crypto = require('crypto');

/**
 * 从视频缓冲区提取封面缩略图
 * 使用 sharp 生成默认视频封面（因视频帧提取需要 ffmpeg，此处生成占位图）
 * @param {Buffer} buffer - 视频文件缓冲区
 * @param {string} filename - 原始文件名
 * @returns {Promise<{success: boolean, coverUrl?: string}>}
 */
async function extractVideoThumbnail(buffer, filename) {
  try {
    // 使用 sharp 生成一个带"VIDEO"文字的默认封面图作为占位
    const svgBuffer = Buffer.from(`
      <svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#1a1a2e"/>
        <polygon points="280,120 280,240 380,180" fill="#e94560"/>
        <text x="320" y="300" font-family="Arial" font-size="16" fill="#888" text-anchor="middle">Video</text>
      </svg>
    `);
    const thumbnailBuffer = await sharp(svgBuffer)
      .resize(640, 360)
      .jpeg({ quality: 80 })
      .toBuffer();

    // 上传封面到文件存储
    const config = require('../config/config');
    const fileHelper = require('../utils/fileHelper');
    const ext = '.jpg';
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(4).toString('hex');
    const thumbFilename = `video_cover_${timestamp}_${randomStr}${ext}`;

    let coverUrl;
    if (config.storage.type === 'local') {
      const fs = require('fs');
      const path = require('path');
      const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'covers');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const filePath = path.join(uploadDir, thumbFilename);
      fs.writeFileSync(filePath, thumbnailBuffer);
      coverUrl = `/uploads/covers/${thumbFilename}`;
    } else {
      // 其他存储方式（R2/S3/图床）
      coverUrl = await fileHelper.uploadFile(thumbnailBuffer, thumbFilename, 'image/jpeg', 'covers');
    }

    return { success: true, coverUrl };
  } catch (error) {
    console.error('生成视频封面失败:', error);
    return { success: false };
  }
}

// 辅助函数：获取笔记的附加信息
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
  const tags = await db({ t: 'tags' })
    .join({ pt: 'post_tags' }, 't.id', 'pt.tag_id')
    .whereIn('pt.post_id', postIds)
    .select('pt.post_id', 't.id', 't.name');
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

// 获取笔记列表
router.get('/', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const category = req.query.category;
    const status = req.query.status !== undefined ? parseInt(req.query.status) : 0;
    const userId = req.query.user_id ? parseInt(req.query.user_id) : null;
    const type = req.query.type ? parseInt(req.query.type) : null;
    const currentUserId = req.user ? req.user.id : null;

    if (status === 1) {
      // 草稿箱逻辑
      if (!currentUserId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ code: RESPONSE_CODES.UNAUTHORIZED, message: '查看草稿需要登录' });
      }

      let query = db({ p: 'posts' })
        .leftJoin({ u: 'users' }, 'p.user_id', 'u.id')
        .leftJoin({ c: 'categories' }, 'p.category_id', 'c.id')
        .where({ 'p.status': status, 'p.user_id': currentUserId })
        .select(
          'p.*',
          'u.nickname',
          'u.avatar as user_avatar',
          'u.user_id as author_account',
          'u.id as author_auto_id',
          'u.location',
          'u.verified',
          'c.name as category'
        );

      if (category) {
        query.where('p.category_id', category);
      }

      if (type) {
        query.where('p.type', type);
      }

      const rows = await query
        .orderBy('p.created_at', 'desc')
        .limit(limit)
        .offset(offset);

      await enrichPostsWithDetails(db, rows, null); // 草稿不需要检查点赞收藏状态

      // 获取草稿总数
      let countQuery = db('posts').where({ status, user_id: currentUserId });
      if (category) countQuery.where('category_id', category);
      if (type) countQuery.where('type', type);
      
      const countResult = await countQuery.count('* as total').first();
      const total = parseInt(countResult.total);
      const pages = Math.ceil(total / limit);

      return res.json({
        code: RESPONSE_CODES.SUCCESS,
        message: 'success',
        data: {
          posts: rows,
          pagination: { page, limit, total, pages }
        }
      });
    }

    // 正常发布的笔记查询
    let query = db({ p: 'posts' })
      .leftJoin({ u: 'users' }, 'p.user_id', 'u.id')
      .leftJoin({ c: 'categories' }, 'p.category_id', 'c.id')
      .where('p.status', status)
      .select(
        'p.*',
        'u.nickname',
        'u.avatar as user_avatar',
        'u.user_id as author_account',
        'u.id as author_auto_id',
        'u.location',
        'u.verified',
        'c.name as category'
      );

    // 特殊处理推荐频道
    if (category === 'recommend') {
      // 推荐算法：70%热度+30%新鲜度评分（兼容 PostgreSQL 和 MySQL）
      const totalCount = await db('posts').where({ status }).count('* as total').first();
      const totalPosts = parseInt(totalCount.total);
      const recommendLimit = Math.ceil(totalPosts * 0.2);

      // PostgreSQL 使用 EXTRACT(EPOCH FROM ...)，MySQL 使用 TIMESTAMPDIFF
      const dbClient = getDB().client?.config?.client || 'mysql';
      const hoursDiffExpr = dbClient === 'pg'
        ? "LEAST(24, EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600)"
        : "LEAST(24, TIMESTAMPDIFF(HOUR, p.created_at, NOW()))";
      const scoreExpr = db.raw(`(view_count * 0.7 + ${hoursDiffExpr} * 0.3)`);

      query = db({ p: 'posts' })
        .leftJoin({ u: 'users' }, 'p.user_id', 'u.id')
        .leftJoin({ c: 'categories' }, 'p.category_id', 'c.id')
        .where('p.status', status)
        .modify(function(qb) {
          if (type) qb.where('p.type', type);
        })
        .select(
          'p.*',
          'u.nickname',
          'u.avatar as user_avatar',
          'u.user_id as author_account',
          'u.id as author_auto_id',
          'u.location',
          'u.verified',
          'c.name as category',
          { score: scoreExpr }
        )
        .orderByRaw('score DESC')
        .limit(recommendLimit);

      const recommendedRows = await query;
      
      // 应用分页
      const paginatedRows = recommendedRows.slice(offset, offset + limit);
      
      await enrichPostsWithDetails(db, paginatedRows, currentUserId);

      res.json({
        code: RESPONSE_CODES.SUCCESS,
        message: 'success',
        data: {
          posts: paginatedRows,
          pagination: {
            page,
            limit,
            total: recommendLimit,
            pages: Math.ceil(recommendLimit / limit)
          }
        }
      });
      return;
    } else {
      // 普通频道查询
      if (category) {
        query.where('p.category_id', category);
      }

      if (userId) {
        query.where('p.user_id', userId);
      }

      if (type) {
        query.where('p.type', type);
      }
    }

    const rows = await query
      .orderBy('p.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    await enrichPostsWithDetails(db, rows, currentUserId);

    // 获取总数
    let countQuery = db('posts').where({ status });
    if (category && category !== 'recommend') countQuery.where('category_id', category);
    if (userId) countQuery.where('user_id', userId);
    if (type) countQuery.where('type', type);

    const countResult = await countQuery.count('* as total').first();
    const total = parseInt(countResult.total);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        posts: rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('获取笔记列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取笔记详情
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const postId = req.params.id;
    const currentUserId = req.user ? req.user.id : null;

    // 获取笔记基本信息
    const post = await db({ p: 'posts' })
      .leftJoin({ u: 'users' }, 'p.user_id', 'u.id')
      .leftJoin({ c: 'categories' }, 'p.category_id', 'c.id')
      .where('p.id', postId)
      .select(
        'p.*',
        'u.nickname',
        'u.avatar as user_avatar',
        'u.user_id as author_account',
        'u.id as author_auto_id',
        'u.location',
        'u.verified',
        'c.name as category'
      )
      .first();

    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }

    // 检查笔记状态权限
    if (post.status !== 0) {
      if (!currentUserId || currentUserId !== post.user_id) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
      }
    }

    // 根据帖子类型获取对应的媒体文件
    if (post.type === 1) {
      // 图文类型
      const images = await db('post_images').where({ post_id: postId }).select('image_url');
      post.images = images.map(img => img.image_url);
    } else if (post.type === 2) {
      // 视频类型
      const videos = await db('post_videos').where({ post_id: postId }).select('video_url', 'cover_url');
      post.videos = videos;
      if (videos.length > 0) {
        post.video_url = videos[0].video_url;
        post.cover_url = videos[0].cover_url;
      }
    }

    // 获取笔记标签
    const tags = await db({ t: 'tags' })
      .join({ pt: 'post_tags' }, 't.id', 'pt.tag_id')
      .where('pt.post_id', postId)
      .select('t.id', 't.name');
    post.tags = tags;

    // 检查当前用户是否已点赞和收藏
    if (currentUserId) {
      const likeExists = await db('likes')
        .where({ user_id: String(currentUserId), target_type: '1', target_id: String(postId) })
        .first();
      post.liked = !!likeExists;

      const collectExists = await db('collections')
        .where({ user_id: String(currentUserId), post_id: String(postId) })
        .first();
      post.collected = !!collectExists;
    } else {
      post.liked = false;
      post.collected = false;
    }

    // 增加浏览量（使用Redis计数器，定时回写数据库）
    const skipViewCount = req.query.skipViewCount === 'true';
    if (!skipViewCount) {
      try {
        const { incrCounter, getCounter } = require('../utils/redis');
        const viewKey = `counter:view:${postId}`;
        await incrCounter(viewKey, 1);
        // Redis计数 + 数据库当前值 = 实际浏览量
        const redisViews = await getCounter(viewKey);
        post.view_count = parseInt(post.view_count || 0) + redisViews;
      } catch (redisError) {
        // Redis不可用时降级到数据库直接更新
        await db('posts').where({ id: postId }).increment('view_count', 1);
        const updatedPost = await db('posts').where({ id: postId }).select('view_count').first();
        if (updatedPost) {
          post.view_count = parseInt(updatedPost.view_count);
        }
      }
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: post
    });
  } catch (error) {
    console.error('获取笔记详情失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 创建笔记
router.post('/', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const { title, content, category_id, images, video, tags, status, type } = req.body;
    const userId = req.user.id;
    const postType = type || 1;

    // 验证必填字段
    if (status !== 1 && (!title || !content)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '发布时标题和内容不能为空' });
    }

    const sanitizedContent = content ? sanitizeContent(content) : '';

    if (postType !== 1 && postType !== 2) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '无效的发布类型' });
    }

    // 插入笔记
    const postResult = await db('posts')
      .insert({
        user_id: userId,
        title: title || '',
        content: sanitizedContent,
        category_id: category_id || null,
        status: status !== undefined ? status : 2,
        type: postType
      })
      .returning('id');

    const postId = Array.isArray(postResult) && postResult.length > 0 ? postResult[0].id : postResult[0];

    // 处理图片（图文类型）
    if (postType === 1 && images && images.length > 0) {
      const validUrls = images.filter(url => url && typeof url === 'string');
      
      if (validUrls.length > 0) {
        const imageRecords = validUrls.map(url => ({
          post_id: String(postId),
          image_url: url
        }));
        await db('post_images').insert(imageRecords);
      }
    }

    // 处理视频（视频类型）
    if (postType === 2 && video && video.url && typeof video.url === 'string') {
      let coverUrl = video.coverUrl || null;

      if (video.buffer) {
        try {
          const thumbnailResult = await extractVideoThumbnail(video.buffer, video.filename || 'video.mp4');
          if (thumbnailResult.success) {
            coverUrl = thumbnailResult.coverUrl;
          }
        } catch (error) {
          console.error('处理视频封面失败:', error);
        }
      }

      await db('post_videos').insert({
        post_id: String(postId),
        video_url: video.url,
        cover_url: coverUrl
      });
    }

    // 处理标签
    if (tags && tags.length > 0) {
      for (const tagName of tags) {
        // 检查标签是否存在
        let tagRecord = await db('tags').where({ name: tagName }).select('id').first();
        let tagId;

        if (!tagRecord) {
          const tagResult = await db('tags').insert({ name: tagName }).returning('id');
          tagId = Array.isArray(tagResult) && tagResult.length > 0 ? tagResult[0].id : tagResult[0];
        } else {
          tagId = tagRecord.id;
        }

        // 关联笔记和标签
        await db('post_tags').insert({
          post_id: String(postId),
          tag_id: tagId
        });

        // 更新标签使用次数
        await db('tags').where({ id: tagId }).increment('use_count', 1);
      }
    }

    // 处理@用户通知
    if (status === 0 && content && hasMentions(content)) {
      const mentionedUsers = extractMentionedUsers(content);

      for (const mentionedUser of mentionedUsers) {
        try {
          const userRow = await db('users').where({ user_id: mentionedUser.userId }).select('id').first();

          if (userRow && userRow.id !== userId) {
            const mentionNotificationData = NotificationHelper.createNotificationData({
              userId: userRow.id,
              senderId: userId,
              type: NotificationHelper.TYPES.MENTION,
              targetId: String(postId)
            });

            await NotificationHelper.insertNotification(mentionNotificationData);
          }
        } catch (error) {
          console.error('处理@用户通知失败 - 用户: %s:', mentionedUser.userId, error);
        }
      }
    }

    // 如果笔记状态为待审核(status=2)，添加审核记录
    if (status === 2) {
      try {
        await db('audit').insert({
          type: 3,
          target_id: String(postId),
          status: 0
        });
      } catch (error) {
        console.error('创建审核记录失败:', error);
      }
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '发布成功',
      data: { id: postId }
    });
  } catch (error) {
    console.error('创建笔记失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 搜索笔记
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const keyword = req.query.keyword;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const currentUserId = req.user ? req.user.id : null;

    if (!keyword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入搜索关键词' });
    }

    console.log(`🔍 搜索笔记 - 关键词: ${keyword}, 页码: ${page}, 每页: ${limit}, 当前用户ID: ${currentUserId}`);

    const kwPattern = `%${keyword}%`;

    // 搜索笔记
    const rows = await db({ p: 'posts' })
      .leftJoin({ u: 'users' }, 'p.user_id', 'u.id')
      .where('p.status', 0)
      .where(function() {
        this.where('p.title', 'like', kwPattern)
            .orWhere('p.content', 'like', kwPattern);
      })
      .select(
        'p.*',
        'u.nickname',
        'u.avatar as user_avatar',
        'u.user_id as author_account',
        'u.id as author_auto_id',
        'u.location',
        'u.verified'
      )
      .orderBy('p.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    await enrichPostsWithDetails(db, rows, currentUserId);

    // 获取总数
    const countResult = await db('posts')
      .where({ status: 0 })
      .where(function() {
        this.where('title', 'like', kwPattern)
            .orWhere('content', 'like', kwPattern);
      })
      .count('* as total')
      .first();

    const total = parseInt(countResult.total);

    console.log(`  搜索笔记结果 - 找到 ${total} 个笔记，当前页 ${rows.length} 个`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        posts: rows,
        keyword,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('搜索笔记失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取笔记评论列表
router.get('/:id/comments', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const postId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const sort = req.query.sort || 'desc';
    const currentUserId = req.user ? req.user.id : null;

    console.log(`获取笔记评论列表 - 笔记ID: ${postId}, 页码: ${page}, 每页: ${limit}, 排序: ${sort}, 当前用户ID: ${currentUserId}`);

    // 验证笔记是否存在
    const postExists = await db('posts').where({ id: postId }).first();
    if (!postExists) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }

    // 获取顶级评论
    const orderBy = sort === 'asc' ? 'asc' : 'desc';
    
    const rows = await db({ c: 'comments' })
      .leftJoin({ u: 'users' }, 'c.user_id', 'u.id')
      .where({ 'c.post_id': postId })
      .whereNull('c.parent_id')
      .select(
        'c.*',
        'u.nickname',
        'u.avatar as user_avatar',
        'u.id as user_auto_id',
        'u.user_id as user_display_id',
        'u.location as user_location',
        'u.verified'
      )
      .orderBy('c.created_at', orderBy)
      .limit(limit)
      .offset(offset);

    // 为每个评论检查点赞状态和回复数
    if (rows.length > 0) {
      const commentIds = rows.map(c => c.id);

      // 批量获取点赞状态
      let likedCommentIds = new Set();
      if (currentUserId) {
        const likes = await db('likes')
          .where({ user_id: String(currentUserId), target_type: '2' })
          .whereIn('target_id', commentIds.map(String))
          .select('target_id');
        likedCommentIds = new Set(likes.map(l => l.target_id.toString()));
      }

      // 批量获取子评论数量
      const replyCounts = await db('comments')
        .whereIn('parent_id', commentIds)
        .select('parent_id')
        .count('* as count')
        .groupBy('parent_id');
      
      const replyCountMap = {};
      replyCounts.forEach(r => {
        replyCountMap[r.parent_id] = parseInt(r.count);
      });

      // 组装数据
      for (let comment of rows) {
        comment.liked = likedCommentIds.has(comment.id.toString());
        comment.reply_count = replyCountMap[comment.id] || 0;
      }
    }

    // 获取总数（从posts表读取comment_count字段）
    const postData = await db('posts').where({ id: postId }).select('comment_count as total').first();
    const total = postData ? postData.total : 0;

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        comments: rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('获取笔记评论列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 收藏/取消收藏笔记
router.post('/:id/collect', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const postId = req.params.id;
    const userId = req.user.id;

    // 验证笔记是否存在
    const postExists = await db('posts').where({ id: postId }).first();
    if (!postExists) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }

    // 检查是否已经收藏
    const existingCollection = await db('collections')
      .where({ user_id: String(userId), post_id: String(postId) })
      .first();

    if (existingCollection) {
      // 已收藏，执行取消收藏
      await db('collections')
        .where({ user_id: String(userId), post_id: String(postId) })
        .del();

      // 更新笔记收藏数
      await db('posts').where({ id: postId }).decrement('collect_count', 1);

      console.log(`取消收藏成功 - 用户ID: ${userId}, 笔记ID: ${postId}`);
      res.json({ code: RESPONSE_CODES.SUCCESS, message: '取消收藏成功', data: { collected: false } });
    } else {
      // 未收藏，执行收藏
      await db('collections').insert({
        user_id: String(userId),
        post_id: String(postId)
      });

      // 更新笔记收藏数
      await db('posts').where({ id: postId }).increment('collect_count', 1);

      // 获取笔记作者ID，用于创建通知
      const postData = await db('posts').where({ id: postId }).select('user_id').first();
      if (postData && postData.user_id && postData.user_id !== userId) {
        const notificationData = NotificationHelper.createCollectPostNotification(postData.user_id, userId, postId);
        await NotificationHelper.insertNotification(notificationData);
      }

      console.log(`收藏成功 - 用户ID: ${userId}, 笔记ID: ${postId}`);
      res.json({ code: RESPONSE_CODES.SUCCESS, message: '收藏成功', data: { collected: true } });
    }
  } catch (error) {
    console.error('笔记收藏操作失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 更新笔记
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const postId = req.params.id;
    const { title, content, category_id, images, video, tags, status } = req.body;
    const userId = req.user.id;

    // 验证必填字段
    if (status !== 1 && (!title || !content || !category_id)) {
      console.log('验证失败 - 必填字段缺失:', { title, content, category_id, status });
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '发布时标题、内容和分类不能为空' });
    }

    const sanitizedContent = content ? sanitizeContent(content) : '';

    // 检查笔记是否存在且属于当前用户
    const postRecord = await db('posts').where({ id: postId }).select('user_id', 'type').first();
    if (!postRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }

    if (postRecord.user_id !== userId) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '无权限修改此笔记' });
    }

    const postType = postRecord.type;

    // 获取原始笔记信息
    const originalPost = await db('posts').where({ id: postId }).select('status', 'content').first();
    const wasOriginallyDraft = originalPost && originalPost.status === 1;
    const originalContent = originalPost ? originalPost.content : '';

    // 更新笔记基本信息
    await db('posts')
      .where({ id: postId })
      .update({
        title: title || '',
        content: sanitizedContent,
        category_id: category_id || null,
        status: status !== undefined ? status : 2
      });

    // 根据笔记类型处理媒体文件
    if (postType === 2) {
      // 视频笔记处理
      if (video || req.body.video_url !== undefined || req.body.cover_url !== undefined) {
        const oldVideoData = await db('post_videos').where({ post_id: postId }).select('video_url', 'cover_url').first();

        let newVideoUrl = null;
        let newCoverUrl = null;
        let shouldCleanupVideo = false;

        if (video && video.url) {
          newVideoUrl = video.url;
          newCoverUrl = video.coverUrl || null;
          shouldCleanupVideo = oldVideoData && oldVideoData.video_url !== newVideoUrl;
        } else if (req.body.video_url !== undefined) {
          newVideoUrl = req.body.video_url;
          newCoverUrl = req.body.cover_url !== undefined ? req.body.cover_url : (oldVideoData ? oldVideoData.cover_url : null);
          shouldCleanupVideo = oldVideoData && oldVideoData.video_url !== newVideoUrl;
        } else if (req.body.cover_url !== undefined && oldVideoData) {
          newVideoUrl = oldVideoData.video_url;
          newCoverUrl = req.body.cover_url;
          shouldCleanupVideo = false;
        }

        if (newVideoUrl) {
          // 删除原有记录并插入新记录
          await db('post_videos').where({ post_id: postId }).del();
          
          await db('post_videos').insert({
            post_id: String(postId),
            video_url: newVideoUrl,
            cover_url: newCoverUrl
          });

          // 清理旧视频文件
          if (shouldCleanupVideo && oldVideoData) {
            const oldVideoUrls = [oldVideoData.video_url].filter(url => url);
            const oldCoverUrls = [oldVideoData.cover_url].filter(url => url && url !== newCoverUrl);

            if (oldVideoUrls.length > 0 || oldCoverUrls.length > 0) {
              batchCleanupFiles(oldVideoUrls, oldCoverUrls).catch(error => {
                console.error('清理废弃视频文件失败:', error);
              });
            }
          }
        }
      }
    } else {
      // 图文笔记处理
      await db('post_images').where({ post_id: postId }).del();

      if (images && images.length > 0) {
        const validUrls = images.filter(url => url && typeof url === 'string');
        
        if (validUrls.length > 0) {
          const imageRecords = validUrls.map(url => ({
            post_id: postId,
            image_url: url
          }));
          await db('post_images').insert(imageRecords);
        }
      }
    }

    // 获取原有标签列表
    const oldTagsResult = await db({ t: 'tags' })
      .join({ pt: 'post_tags' }, 't.id', 'pt.tag_id')
      .where('pt.post_id', postId)
      .select('t.id', 't.name');
    
    const oldTags = oldTagsResult.map(tag => tag.name);
    const oldTagIds = new Map(oldTagsResult.map(tag => [tag.name, tag.id]));

    const newTags = tags || [];

    // 找出需要删除和新增的标签
    const tagsToRemove = oldTags.filter(tagName => !newTags.includes(tagName));
    const tagsToAdd = newTags.filter(tagName => !oldTags.includes(tagName));

    // 删除原有标签关联
    await db('post_tags').where({ post_id: postId }).del();

    // 减少已删除标签的使用次数
    for (const tagName of tagsToRemove) {
      const tagId = oldTagIds.get(tagName);
      if (tagId) {
        await db('tags').where({ id: tagId }).update({
          use_count: db.raw('GREATEST(use_count - 1, 0)')
        });
      }
    }

    // 处理新标签
    if (newTags.length > 0) {
      for (const tagName of newTags) {
        let tagRecord = await db('tags').where({ name: tagName }).select('id').first();
        let tagId;

        if (!tagRecord) {
          const tagResult2 = await db('tags').insert({ name: tagName }).returning('id');
          tagId = Array.isArray(tagResult2) && tagResult2.length > 0 ? tagResult2[0].id : tagResult2[0];
        } else {
          tagId = tagRecord.id;
        }

        // 关联笔记和标签
        await db('post_tags').insert({
          post_id: postId,
          tag_id: tagId
        });

        // 只对新增的标签增加使用次数
        if (tagsToAdd.includes(tagName)) {
          await db('tags').where({ id: tagId }).increment('use_count', 1);
        }
      }
    }

    // 处理@用户通知
    if (status === 0 && content) {
      const newMentionedUsers = hasMentions(content) ? extractMentionedUsers(content) : [];
      const newMentionedUserIds = new Set(newMentionedUsers.map(user => user.userId));

      let oldMentionedUserIds = new Set();
      if (!wasOriginallyDraft && originalContent && hasMentions(originalContent)) {
        const oldMentionedUsers = extractMentionedUsers(originalContent);
        oldMentionedUserIds = new Set(oldMentionedUsers.map(user => user.userId));
      }

      const usersToRemoveNotification = [...oldMentionedUserIds].filter(uid => !newMentionedUserIds.has(uid));
      const usersToAddNotification = [...newMentionedUserIds].filter(uid => !oldMentionedUserIds.has(uid));

      // 删除不再需要的@通知
      for (const mentionedUserId of usersToRemoveNotification) {
        try {
          const userRow = await db('users').where({ user_id: mentionedUserId }).select('id').first();
          
          if (userRow) {
            await NotificationHelper.deleteNotifications({
              type: NotificationHelper.TYPES.MENTION,
              targetId: postId,
              senderId: userId,
              userId: userRow.id
            });
          }
        } catch (error) {
          console.error('删除@用户通知失败 - 用户: %s:', mentionedUserId, error);
        }
      }

      // 添加新的@通知
      for (const mentionedUserId of usersToAddNotification) {
        try {
          const userRow = await db('users').where({ user_id: mentionedUserId }).select('id').first();

          if (userRow && userRow.id !== userId) {
            const mentionNotificationData = NotificationHelper.createNotificationData({
              userId: userRow.id,
              senderId: userId,
              type: NotificationHelper.TYPES.MENTION,
              targetId: postId
            });

            await NotificationHelper.insertNotification(mentionNotificationData);

            console.log('添加@通知 - 笔记ID: %s, 用户: %s', postId, mentionedUserId);
          }
        } catch (error) {
          console.error('处理@用户通知失败 - 用户: %s:', mentionedUserId, error);
        }
      }
    }

    console.log(`更新笔记成功 - 用户ID: ${userId}, 笔记ID: ${postId}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '更新成功',
      data: { id: postId }
    });
  } catch (error) {
    console.error('更新笔记失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 删除笔记
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const postId = req.params.id;
    const userId = req.user.id;

    // 检查笔记是否存在且属于当前用户
    const postRecord = await db('posts').where({ id: postId }).select('user_id').first();
    
    if (!postRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }

    if (postRecord.user_id !== userId) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '无权限删除此笔记' });
    }

    // 获取笔记关联的标签，减少标签使用次数
    const tagRelations = await db('post_tags').where({ post_id: postId }).select('tag_id');
    
    for (const relation of tagRelations) {
      await db('tags').where({ id: relation.tag_id }).update({
        use_count: db.raw('GREATEST(use_count - 1, 0)')
      });
    }

    // 获取笔记关联的视频文件，用于清理
    const videoRows = await db('post_videos').where({ post_id: postId }).select('video_url', 'cover_url');

    // 删除相关数据（按顺序删除以满足外键约束）
    await db('post_images').where({ post_id: postId }).del();
    await db('post_videos').where({ post_id: postId }).del();
    await db('post_tags').where({ post_id: postId }).del();
    await db('likes').where({ target_type: '1', target_id: String(postId) }).del();
    await db('collections').where({ post_id: String(postId) }).del();
    await db('comments').where({ post_id: postId }).del();
    await db('notifications').where({ target_id: String(postId) }).del();

    // 清理关联的视频文件
    if (videoRows.length > 0) {
      const videoUrls = videoRows.map(row => row.video_url).filter(url => url);
      const coverUrls = videoRows.map(row => row.cover_url).filter(url => url);

      batchCleanupFiles(videoUrls, coverUrls).catch(error => {
        console.error('清理笔记关联视频文件失败:', error);
      });
    }

    // 最后删除笔记
    await db('posts').where({ id: postId }).del();

    console.log(`删除笔记成功 - 用户ID: ${userId}, 笔记ID: ${postId}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '删除成功'
    });
  } catch (error) {
    console.error('删除笔记失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 取消收藏笔记
router.delete('/:id/collect', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const postId = req.params.id;
    const userId = req.user.id;

    console.log(`取消收藏 - 用户ID: ${userId}, 笔记ID: ${postId}`);

    // 删除收藏记录
    const result = await db('collections')
      .where({ user_id: String(userId), post_id: String(postId) })
      .del();

    if (result === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '收藏记录不存在' });
    }

    // 更新笔记收藏数
    await db('posts').where({ id: postId }).decrement('collect_count', 1);

    console.log(`取消收藏成功 - 用户ID: ${userId}, 笔记ID: ${postId}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '取消收藏成功', data: { collected: false } });
  } catch (error) {
    console.error('取消笔记收藏失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

module.exports = router;
