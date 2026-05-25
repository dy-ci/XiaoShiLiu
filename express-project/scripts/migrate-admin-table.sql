-- 扩展 admin 表添加 Logto 相关字段（兼容标准 MySQL）
USE `xiaoshiliu`;

-- 1. 添加 logto_id 字段（Logto 用户唯一标识）
ALTER TABLE `admin` ADD COLUMN `logto_id` VARCHAR(128) DEFAULT NULL COMMENT 'Logto用户唯一ID' AFTER `id`;

-- 添加索引（忽略已存在的错误）
-- 如果索引已存在会报错，可以注释掉这行
ALTER TABLE `admin` ADD UNIQUE INDEX `idx_logto_id` (`logto_id`);

-- 2. 添加 permissions 字段（权限列表）
ALTER TABLE `admin` ADD COLUMN `permissions` JSON DEFAULT NULL COMMENT '权限列表';

-- 3. 添加 is_super 字段（是否超级管理员）
ALTER TABLE `admin` ADD COLUMN `is_super` TINYINT(1) DEFAULT 0 COMMENT '是否超级管理员 1-是 0-否';

-- 4. 添加 created_by 字段（创建者）
ALTER TABLE `admin` ADD COLUMN `created_by` BIGINT(20) DEFAULT NULL COMMENT '创建者管理员ID';

-- 5. 添加 updated_at 字段
ALTER TABLE `admin` ADD COLUMN `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- 6. 添加 nickname 字段
ALTER TABLE `admin` ADD COLUMN `nickname` VARCHAR(100) DEFAULT NULL COMMENT '昵称';

-- 7. 添加 avatar 字段
ALTER TABLE `admin` ADD COLUMN `avatar` VARCHAR(500) DEFAULT NULL COMMENT '头像';

SELECT '迁移完成！请查看下一步操作。' AS '状态';
