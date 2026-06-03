/**
 * 悦社动态社区 - Express后端服务
 * 基于原项目小石榴校园图文社区修改
 * 
 * @author ZTMYO
 * @github https://github.com/ZTMYO
 * @description 基于Express框架的图文社区后端API服务
 * @version v1.3.2
 * @license GPLv3
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const config = require('./config/config');
const { HTTP_STATUS, RESPONSE_CODES } = require('./constants');
// 导入自动解封功能
const { startAutoUnbanService } = require('./utils/autoUnban');
// 导入 Yggdrasil Token 清理功能
const { cleanupExpiredTokens } = require('./utils/yggdrasilHelper');
// 导入数据库迁移功能
const { checkAndMigrateAdminTable } = require('./utils/dbMigration');
// 导入 Redis 连接功能
const { connectRedis, disconnectRedis } = require('./utils/redis');
// 导入浏览量回写服务
const { startViewCountFlushService } = require('./utils/viewCountFlush');

// 启动前检查配置
console.log('执行启动前配置检查...');
try {
  require('./scripts/checkConfig');
} catch (err) {
  console.error('配置检查失败:', err.message);
  console.error('请修复配置问题后重启服务器');
  process.exit(1);
}

// 导入路由模块
const authRoutes = require('./routes/auth');
const { router: logtoRoutes } = require('./routes/logto');
const usersRoutes = require('./routes/users');
const postsRoutes = require('./routes/posts');
const commentsRoutes = require('./routes/comments');
const likesRoutes = require('./routes/likes');
const tagsRoutes = require('./routes/tags');
const searchRoutes = require('./routes/search');
const notificationsRoutes = require('./routes/notifications');
const uploadRoutes = require('./routes/upload');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');
const categoriesRoutes = require('./routes/categories');
const filesRoutes = require('./routes/files');
// 导入MC游戏功能路由
const yggdrasilRoutes = require('./routes/yggdrasil');
const gameRoutes = require('./routes/game');

const app = express();

// 信任代理配置（在所有路由之前设置，解决 express-rate-limit 的 X-Forwarded-For 警告）
app.set('trust proxy', 1);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

// MC游戏功能速率限制器
// 登录接口严格限流（防暴力破解）
const yggdrasilAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too Many Requests', errorMessage: '登录请求过于频繁，请稍后重试' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

// 会话/查询等接口宽松限流（避免进服被限流）
const yggdrasilLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: { error: 'Too Many Requests', errorMessage: '请求过于频繁，请稍后重试' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

const gameLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { code: 429, message: '请求过于频繁，请稍后重试' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

// 中间件配置
// CORS配置
const corsOptions = {
  origin: config.cors.origin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));  // 显式处理OPTIONS请求
app.use(cookieParser());  // 解析Cookie
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 健康检查路由
app.get('/api/health', (req, res) => {
  res.status(HTTP_STATUS.OK).json({
    code: RESPONSE_CODES.SUCCESS,
    message: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 路由配置
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/upload', uploadLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/logto', logtoRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/likes', likesRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/files', filesRoutes);
// MC游戏功能路由
app.use('/api/yggdrasil/authserver/authenticate', yggdrasilAuthLimiter, yggdrasilRoutes);
app.use('/api/yggdrasil', yggdrasilLimiter, yggdrasilRoutes);
app.use('/api/game', gameLimiter, gameRoutes);

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '服务器内部错误' });
});

// 404 处理
app.use('*', (req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '接口不存在' });
});

// 启动自动解封服务
startAutoUnbanService();
// 启动浏览量回写服务（Redis计数器定时回写数据库）
startViewCountFlushService();

// 启动服务器
const PORT = config.server.port;
app.listen(PORT, async () => {
  console.log(`● 服务器运行在端口 ${PORT}`);
  console.log(`● 环境: ${config.server.env}`);
  console.log('========================================');

  // 连接 Redis
  await connectRedis();

  console.log('========================================');
  console.log('[Yggdrasil] 🎮 Minecraft 认证服务已启动');
  console.log('========================================');
  console.log('[Yggdrasil] 📋 Auth Server 端点 (认证):');
  console.log(`[Yggdrasil]    POST /api/yggdrasil/authserver/authenticate`);
  console.log(`[Yggdrasil]    POST /api/yggdrasil/authserver/refresh`);
  console.log(`[Yggdrasil]    POST /api/yggdrasil/authserver/validate`);
  console.log(`[Yggdrasil]    POST /api/yggdrasil/authserver/signout`);
  console.log(`[Yggdrasil]    POST /api/yggdrasil/authserver/invalidate`);
  console.log('----------------------------------------');
  console.log('[Yggdrasil] 📋 Session Server 端点 (会话):');
  console.log(`[Yggdrasil]    GET  /api/yggdrasil/sessionserver/session/minecraft/profile/:uuid`);
  console.log('========================================');
  console.log('[Yggdrasil] 🔗 authlib-injector 配置:');
  console.log(`[Yggdrasil]    Base URL: http://localhost:${PORT}/api/yggdrasil`);
  console.log('========================================');

  // 自动检查并迁移数据库
  await checkAndMigrateAdminTable();

  // 启动定时清理过期 Yggdrasil Token 任务（每小时执行一次）
  setInterval(async () => {
    try {
      const count = await cleanupExpiredTokens();
      if (count > 0) {
        console.log(`[Yggdrasil] 定时清理完成，删除了 ${count} 个过期 Token`);
      }
    } catch (error) {
      console.error('[Yggdrasil] 定时清理过期 Token 失败:', error);
    }
  }, 60 * 60 * 1000); // 每小时执行一次

  // 立即执行一次清理
  try {
    const count = await cleanupExpiredTokens();
    console.log(`[Yggdrasil] 初始清理完成，删除了 ${count} 个过期 Token`);
  } catch (error) {
    console.error('[Yggdrasil] 初始清理过期 Token 失败:', error);
  }
});

module.exports = app;