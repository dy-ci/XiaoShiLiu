/**
 * Redis 浏览量计数器回写任务
 * 定期将 Redis 中的浏览量计数器批量回写到数据库
 * 避免每次浏览都直接写数据库，降低 DB 压力
 */

const { getDB } = require('./db');
const { getRedisClient, isRedisAvailable, getCounter } = require('./redis');

/**
 * 将 Redis 中的浏览量计数器回写到数据库
 * 扫描所有 counter:view:* 键，批量更新 posts 表
 */
const flushViewCounters = async () => {
  if (!isRedisAvailable()) return;

  try {
    const client = getRedisClient();
    const db = getDB();

    // 扫描所有浏览量计数器键
    const keys = await client.keys('counter:view:*');

    if (keys.length === 0) {
      return;
    }

    console.log(`[ViewCount] 开始回写 ${keys.length} 个浏览量计数器`);

    // 使用事务批量更新
    await db.transaction(async (trx) => {
      for (const key of keys) {
        const postId = key.replace('counter:view:', '');
        const count = await getCounter(key);

        if (count > 0) {
          // 批量增加浏览量
          await trx('posts')
            .where({ id: parseInt(postId) })
            .increment('view_count', count);

          // 回写成功后删除计数器
          await client.del(key);
        }
      }
    });

    console.log(`[ViewCount] 成功回写 ${keys.length} 个浏览量计数器`);
  } catch (error) {
    console.error('[ViewCount] 回写浏览量失败:', error.message);
  }
};

/**
 * 启动浏览量回写服务
 * @param {number} interval - 回写间隔（毫秒），默认5分钟
 * @returns {Object} - { intervalId, stop, flush }
 */
const startViewCountFlushService = (interval = 5 * 60 * 1000) => {
  // 启动后延迟1分钟执行第一次回写（避免启动时集中回写）
  setTimeout(flushViewCounters, 60 * 1000);

  // 定期执行回写
  const intervalId = setInterval(flushViewCounters, interval);

  console.log(`[ViewCount] 浏览量回写服务已启用，每 ${Math.floor(interval / 60000)} 分钟回写一次`);

  return {
    intervalId,
    stop: () => {
      clearInterval(intervalId);
      console.log('[ViewCount] 浏览量回写服务已停止');
    },
    flush: flushViewCounters // 暴露手动触发方法
  };
};

module.exports = {
  flushViewCounters,
  startViewCountFlushService
};
