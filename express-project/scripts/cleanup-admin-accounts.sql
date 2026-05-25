-- 清理预设的管理员账号（不再使用账号密码登录）
USE `xiaoshiliu`;

-- 删除预设管理员账号
DELETE FROM `admin` WHERE `username` IN ('content_admin', 'user_admin', 'operator');

SELECT CONCAT('已删除预设管理员账号: content_admin, user_admin, operator') AS '清理结果';
