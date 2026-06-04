exports.up = async function(knex) {
  // 为 mc_profiles 表添加最后修改名字的时间字段
  await knex.schema.alterTable('mc_profiles', (table) => {
    table.timestamp('last_name_change_at').defaultTo(null).comment('最后修改名字时间');
  });

  // 创建名字修改历史表
  await knex.schema.createTable('mc_name_history', (table) => {
    table.bigIncrements('id').primary().comment('主键ID');
    table.bigInteger('profile_id').notNullable().references('id').inTable('mc_profiles').onDelete('CASCADE').comment('关联的MC角色ID');
    table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE').comment('操作者社区用户ID');
    table.string('old_name', 16).notNullable().comment('修改前的名称');
    table.string('new_name', 16).notNullable().comment('修改后的名称');
    table.string('ip_address', 45).defaultTo(null).comment('操作IP地址');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('修改时间');

    // 创建索引以加快查询
    table.index(['profile_id'], 'idx_name_history_profile_id');
    table.index(['created_at'], 'idx_name_history_created_at');
  });

  console.log('✅ 名字修改限制相关表和字段创建完成');
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('mc_name_history');
  await knex.schema.alterTable('mc_profiles', (table) => {
    table.dropColumn('last_name_change_at');
  });
  console.log('✅ 名字修改限制相关表和字段已删除');
};
