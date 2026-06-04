/**
 * 衣柜功能 - 数据库迁移文件
 * 用于存储玩家的多套皮肤/披风组合
 */

exports.up = async function(knex) {
  // 创建皮肤衣柜表（每个角色可以保存多套皮肤）
  await knex.schema.createTable('mc_skin_wardrobe', (table) => {
    table.bigIncrements('id').primary().comment('主键ID');
    table.bigInteger('profile_id').notNullable().references('id').inTable('mc_profiles').onDelete('CASCADE').comment('关联的MC角色ID');
    table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE').comment('操作者社区用户ID');

    // 皮肤信息
    table.string('name', 50).notNullable().comment('这套皮肤的名称（如：默认、战斗装等）');
    table.string('skin_url', 500).notNullable().comment('皮肤URL');
    table.string('skin_hash', 64).notNullable().comment('皮肤SHA256哈希值');
    table.string('skin_model', 10).defaultTo('classic').comment('皮肤模型类型: classic/slim');

    // 披风信息（可选）
    table.string('cape_url', 500).defaultTo(null).comment('披风URL');
    table.string('cape_hash', 64).defaultTo(null).comment('披风SHA256哈希值');

    // 状态信息
    table.boolean('is_active').defaultTo(false).comment('是否为当前使用的皮肤');
    table.integer('sort_order').defaultTo(0).comment('排序顺序');
    table.timestamps(true, true);
    table.boolean('is_deleted').defaultTo(false).comment('软删除标记');

    // 唯一约束：同一角色下名称不能重复
    table.unique(['profile_id', 'name']);
  });

  // 创建索引以加快查询
  await knex.raw(`
    CREATE INDEX idx_wardrobe_profile ON mc_skin_wardrobe(profile_id, is_deleted)
  `);

  console.log('✅ 皮肤衣柜表创建完成');
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('mc_skin_wardrobe');
  console.log('✅ 皮肤衣柜表已删除');
};
