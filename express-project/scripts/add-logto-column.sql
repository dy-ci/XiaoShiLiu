-- 小石榴图文社区 - 添加 Logto 支持的数据库迁移脚本

USE `xiaoshiliu`;

-- 为 users 表添加 logto_id 字段（检查列是否存在）
SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'logto_id'
);

-- 如果列不存在则添加
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE `users` ADD COLUMN `logto_id` VARCHAR(128) DEFAULT NULL COMMENT \'Logto 用户唯一标识符\' AFTER `id`',
  'SELECT \'Column logto_id already exists\' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 为 logto_id 添加唯一索引（检查索引是否存在）
SET @index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'idx_logto_id'
);

-- 如果索引不存在则添加
SET @sql = IF(@index_exists = 0,
  'ALTER TABLE `users` ADD UNIQUE KEY `idx_logto_id` (`logto_id`)',
  'SELECT \'Index idx_logto_id already exists\' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
