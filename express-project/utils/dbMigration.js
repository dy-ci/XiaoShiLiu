const { pool } = require('../config/config');

async function checkAndMigrateAdminTable() {
  try {
    console.log('🔍 检查 admin 表结构...');

    const columnsToCheck = [
      { name: 'logto_id', sql: "ALTER TABLE admin ADD COLUMN logto_id VARCHAR(128) DEFAULT NULL COMMENT 'Logto用户唯一ID' AFTER id" },
      { name: 'permissions', sql: "ALTER TABLE admin ADD COLUMN permissions JSON DEFAULT NULL COMMENT '权限列表'" },
      { name: 'is_super', sql: "ALTER TABLE admin ADD COLUMN is_super TINYINT(1) DEFAULT 0 COMMENT '是否超级管理员 1-是 0-否'" },
      { name: 'created_by', sql: "ALTER TABLE admin ADD COLUMN created_by BIGINT(20) DEFAULT NULL COMMENT '创建者管理员ID'" },
      { name: 'updated_at', sql: "ALTER TABLE admin ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'" },
      { name: 'nickname', sql: "ALTER TABLE admin ADD COLUMN nickname VARCHAR(100) DEFAULT NULL COMMENT '昵称'" }
    ];

    for (const col of columnsToCheck) {
      const [rows] = await pool.execute(
        `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin' AND COLUMN_NAME = ?`,
        [col.name]
      );

      if (rows[0].count === 0) {
        console.log(`  ➕ 添加字段: ${col.name}`);
        await pool.execute(col.sql);
      } else {
        console.log(`  ✅ 字段已存在: ${col.name}`);
      }
    }

    // 检查是否有超级管理员
    const [admins] = await pool.execute(
      'SELECT id, username, is_super FROM admin WHERE is_super = 1 LIMIT 1'
    );

    if (admins.length === 0) {
      console.log('⚠️  未找到超级管理员，正在设置默认超级管理员...');
      
      // 将第一个管理员设置为超级管理员
      await pool.execute(
        'UPDATE admin SET is_super = 1, nickname = COALESCE(nickname, username) WHERE id = (SELECT MIN(id) FROM admin)'
      );
      
      console.log('✅ 已将第一个管理员设置为超级管理员');
    } else {
      console.log(`✅ 超级管理员已存在: ${admins[0].username} (ID: ${admins[0].id})`);
    }

    console.log('✅ Admin 表迁移检查完成\n');
    return true;
  } catch (error) {
    console.error('❌ Admin 表迁移失败:', error.message);
    return false;
  }
}

module.exports = { checkAndMigrateAdminTable };
