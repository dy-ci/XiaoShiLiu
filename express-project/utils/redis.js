/**
 * Redis 客户端封装
 * 提供连接管理、缓存操作、计数器、限流等常用功能
 */

const redis = require('redis');

let client = null;
let isConnected = false;

/**
 * 获取 Redis 客户端实例
 */
function getRedisClient() {
  if (!client) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redisPassword = process.env.REDIS_PASSWORD || undefined;

    client = redis.createClient({
      url: redisUrl,
      password: redisPassword,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('[Redis] 重连次数过多，放弃连接');
            return new Error('Redis 重连失败');
          }
          const delay = Math.min(retries * 100, 3000);
          console.log(`[Redis] 第 ${retries} 次重连，延迟 ${delay}ms`);
          return delay;
        }
      }
    });

    client.on('error', (err) => {
      console.error('[Redis] 客户端错误:', err.message);
      isConnected = false;
    });

    client.on('connect', () => {
      console.log('[Redis] 连接成功');
      isConnected = true;
    });

    client.on('disconnect', () => {
      console.log('[Redis] 连接断开');
      isConnected = false;
    });
  }
  return client;
}

/**
 * 连接 Redis（应用启动时调用）
 */
async function connectRedis() {
  const redisClient = getRedisClient();
  if (!isConnected) {
    try {
      await redisClient.connect();
    } catch (error) {
      console.error('[Redis] 连接失败:', error.message);
      // 不抛出错误，让应用继续运行（降级到无缓存模式）
    }
  }
}

/**
 * 断开 Redis 连接（应用关闭时调用）
 */
async function disconnectRedis() {
  if (client && isConnected) {
    await client.quit();
    client = null;
    isConnected = false;
  }
}

/**
 * 检查 Redis 是否可用
 */
function isRedisAvailable() {
  return isConnected && client;
}

// ==================== 缓存操作 ====================

/**
 * 设置缓存
 * @param {string} key - 缓存键
 * @param {any} value - 缓存值
 * @param {number} ttl - 过期时间（秒）
 */
async function setCache(key, value, ttl = 300) {
  if (!isRedisAvailable()) return false;
  try {
    const serialized = JSON.stringify(value);
    await client.setEx(key, ttl, serialized);
    return true;
  } catch (error) {
    console.error('[Redis] setCache 失败:', error.message);
    return false;
  }
}

/**
 * 获取缓存
 * @param {string} key - 缓存键
 * @returns {any|null}
 */
async function getCache(key) {
  if (!isRedisAvailable()) return null;
  try {
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('[Redis] getCache 失败:', error.message);
    return null;
  }
}

/**
 * 删除缓存
 * @param {string} key - 缓存键
 */
async function delCache(key) {
  if (!isRedisAvailable()) return false;
  try {
    await client.del(key);
    return true;
  } catch (error) {
    console.error('[Redis] delCache 失败:', error.message);
    return false;
  }
}

/**
 * 批量删除缓存（支持通配符）
 * @param {string} pattern - 匹配模式，如 "posts:list:*"
 */
async function delCachePattern(pattern) {
  if (!isRedisAvailable()) return 0;
  try {
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(keys);
    }
    return keys.length;
  } catch (error) {
    console.error('[Redis] delCachePattern 失败:', error.message);
    return 0;
  }
}

// ==================== 计数器操作 ====================

/**
 * 增加计数器
 * @param {string} key - 计数器键
 * @param {number} increment - 增量
 */
async function incrCounter(key, increment = 1) {
  if (!isRedisAvailable()) return null;
  try {
    if (increment === 1) {
      return await client.incr(key);
    }
    return await client.incrBy(key, increment);
  } catch (error) {
    console.error('[Redis] incrCounter 失败:', error.message);
    return null;
  }
}

/**
 * 减少计数器
 * @param {string} key - 计数器键
 * @param {number} decrement - 减量
 */
async function decrCounter(key, decrement = 1) {
  if (!isRedisAvailable()) return null;
  try {
    if (decrement === 1) {
      return await client.decr(key);
    }
    return await client.decrBy(key, decrement);
  } catch (error) {
    console.error('[Redis] decrCounter 失败:', error.message);
    return null;
  }
}

/**
 * 获取计数器值
 * @param {string} key - 计数器键
 */
async function getCounter(key) {
  if (!isRedisAvailable()) return 0;
  try {
    const value = await client.get(key);
    return value ? parseInt(value) : 0;
  } catch (error) {
    console.error('[Redis] getCounter 失败:', error.message);
    return 0;
  }
}

/**
 * 批量获取计数器值
 * @param {Array<string>} keys - 计数器键数组
 */
async function getCounters(keys) {
  if (!isRedisAvailable()) return {};
  try {
    const values = await client.mGet(keys);
    const result = {};
    keys.forEach((key, index) => {
      result[key] = values[index] ? parseInt(values[index]) : 0;
    });
    return result;
  } catch (error) {
    console.error('[Redis] getCounters 失败:', error.message);
    return {};
  }
}

// ==================== Set 操作（用于点赞/收藏状态） ====================

/**
 * 添加成员到 Set
 * @param {string} key - Set 键
 * @param {string} member - 成员
 */
async function sadd(key, member) {
  if (!isRedisAvailable()) return false;
  try {
    await client.sAdd(key, member);
    return true;
  } catch (error) {
    console.error('[Redis] sadd 失败:', error.message);
    return false;
  }
}

/**
 * 从 Set 移除成员
 * @param {string} key - Set 键
 * @param {string} member - 成员
 */
async function srem(key, member) {
  if (!isRedisAvailable()) return false;
  try {
    await client.sRem(key, member);
    return true;
  } catch (error) {
    console.error('[Redis] srem 失败:', error.message);
    return false;
  }
}

/**
 * 检查成员是否在 Set 中
 * @param {string} key - Set 键
 * @param {string} member - 成员
 */
async function sismember(key, member) {
  if (!isRedisAvailable()) return false;
  try {
    return await client.sIsMember(key, member);
  } catch (error) {
    console.error('[Redis] sismember 失败:', error.message);
    return false;
  }
}

/**
 * 获取 Set 所有成员
 * @param {string} key - Set 键
 */
async function smembers(key) {
  if (!isRedisAvailable()) return [];
  try {
    return await client.sMembers(key);
  } catch (error) {
    console.error('[Redis] smembers 失败:', error.message);
    return [];
  }
}

// ==================== 限流操作 ====================

/**
 * 滑动窗口限流检查
 * @param {string} key - 限流键
 * @param {number} limit - 限制次数
 * @param {number} windowSeconds - 窗口时间（秒）
 * @returns {Object} - { allowed: boolean, remaining: number, resetTime: number }
 */
async function rateLimitCheck(key, limit, windowSeconds) {
  if (!isRedisAvailable()) {
    // Redis 不可用时，允许通过（降级策略）
    return { allowed: true, remaining: limit, resetTime: Date.now() + windowSeconds * 1000 };
  }

  try {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    // 使用 Redis Sorted Set 实现滑动窗口
    const multi = client.multi();
    multi.zRemRangeByScore(key, 0, windowStart); // 移除窗口外的记录
    multi.zCard(key); // 获取当前窗口内的请求数
    multi.zAdd(key, { score: now, value: `${now}-${Math.random()}` }); // 添加当前请求
    multi.pexpire(key, windowSeconds * 1000); // 设置过期时间

    const results = await multi.exec();
    const currentCount = results[1]; // zCard 的结果

    if (currentCount > limit) {
      // 超过限制，移除刚添加的记录
      await client.zRemRangeByScore(key, now, now);
      return {
        allowed: false,
        remaining: 0,
        resetTime: now + windowSeconds * 1000
      };
    }

    return {
      allowed: true,
      remaining: limit - currentCount,
      resetTime: now + windowSeconds * 1000
    };
  } catch (error) {
    console.error('[Redis] rateLimitCheck 失败:', error.message);
    // 限流出错时允许通过（降级策略）
    return { allowed: true, remaining: limit, resetTime: Date.now() + windowSeconds * 1000 };
  }
}

// ==================== 缓存装饰器 ====================

/**
 * 缓存包装器 - 自动缓存函数结果
 * @param {Function} fn - 原函数
 * @param {string} keyPrefix - 缓存键前缀
 * @param {number} ttl - 缓存时间（秒）
 * @param {Function} keyGenerator - 自定义缓存键生成函数
 */
function withCache(fn, keyPrefix, ttl = 300, keyGenerator = null) {
  return async function(...args) {
    const cacheKey = keyGenerator
      ? keyGenerator(...args)
      : `${keyPrefix}:${args.map(a => JSON.stringify(a)).join(':')}`;

    // 尝试从缓存获取
    const cached = await getCache(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // 执行原函数
    const result = await fn.apply(this, args);

    // 写入缓存
    if (result !== null && result !== undefined) {
      await setCache(cacheKey, result, ttl);
    }

    return result;
  };
}

module.exports = {
  getRedisClient,
  connectRedis,
  disconnectRedis,
  isRedisAvailable,
  setCache,
  getCache,
  delCache,
  delCachePattern,
  incrCounter,
  decrCounter,
  getCounter,
  getCounters,
  sadd,
  srem,
  sismember,
  smembers,
  rateLimitCheck,
  withCache
};
