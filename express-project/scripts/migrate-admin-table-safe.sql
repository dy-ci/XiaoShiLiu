-- 安全迁移脚本 - 检查列是否存在再添加
USE `xiaoshiliu`;

-- 1. 添加 logto_id 字段
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin' AND COLUMN_NAME = 'logto_id');
SET @sql = IF(@column_exists = 0, 'ALTER TABLE admin ADD COLUMN logto_id VARCHAR(128) DEFAULT NULL COMMENT ''Logto用户唯一ID'' AFTER id', 'SELECT ''logto_id 列已存在'' as status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. 添加 permissions 字段
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin' AND COLUMN_NAME = 'permissions');
SET @sql = IF(@column_exists = 0, 'ALTER TABLE admin ADD COLUMN permissions JSON DEFAULT NULL COMMENT ''权限列表''', 'SELECT ''permissions 列已存在'' as status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. 添加 is_super 字段
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin' AND COLUMN_NAME = 'is_super');
SET @sql = IF(@column_exists = 0, 'ALTER TABLE admin ADD COLUMN is_super TINYINT(1) DEFAULT 0 COMMENT ''是否超级管理员 1-是 0-否''', 'SELECT ''is_super 列已存在'' as status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. 添加 created_by 字段
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin' AND COLUMN_NAME = 'created_by');
SET @sql = IF(@column_exists = 0, 'ALTER TABLE admin ADD COLUMN created_by BIGINT(20) DEFAULT NULL COMMENT ''创建者管理员ID''', 'SELECT ''created_by 列已存在'' as status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. 添加 updated_at 字段
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin' AND COLUMN_NAME = 'updated_at');
SET @sql = IF(@column_exists = 0, 'ALTER TABLE admin ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT ''更新时间''', 'SELECT ''updated_at 列已存在'' as status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6. 添加 nickname 字段
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin' AND COLUMN_NAME = 'nickname');
SET @sql = IF(@column_exists = 0, 'ALTER TABLE admin ADD COLUMN nickname VARCHAR(100) DEFAULT NULL COMMENT ''昵称''', 'SELECT ''nickname 列已存在'' as status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7. 添加 avatar 字段
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin' AND COLUMN_NAME = 'avatar');
SET @sql = IF(@column_exists = 0, 'ALTER TABLE admin ADD COLUMN avatar VARCHAR(500) DEFAULT NULL COMMENT ''头像''', 'SELECT ''avatar 列已存在'' as status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '所有迁移完成！' as '状态';
