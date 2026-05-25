-- 设置第一个超级管理员
-- 请替换 '你的Logto用户ID' 为实际的 Logto 用户 ID
-- Logto 用户 ID 可以在 Logto 控制台 -> 用户管理 -> 用户详情中查看

USE `xiaoshiliu`;

-- 方式1：如果你已经有了第一个管理员账号
UPDATE `admin` 
SET `is_super` = 1, 
    `logto_id` = '你的Logto用户ID', 
    `nickname` = '超级管理员',
    `permissions` = NULL
WHERE `id` = 1;

-- 方式2：创建新的超级管理员（如果id=1的管理员不想用）
INSERT INTO `admin` (`username`, `logto_id`, `nickname`, `is_super`, `permissions`, `created_at`)
VALUES ('super_admin', '你的Logto用户ID', '超级管理员', 1, NULL, NOW());

-- 验证设置
SELECT id, username, nickname, is_super, logto_id FROM admin WHERE is_super = 1;
