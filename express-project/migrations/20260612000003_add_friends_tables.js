/**
 * 添加好友关系表和好友申请表
 */
exports.up = async function (knex) {
  // 好友关系表（双向关系）
  await knex.schema.createTable('friends', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.integer('friend_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // 联合唯一约束：防止重复好友关系
    table.unique(['user_id', 'friend_id']);

    // 索引
    table.index('user_id');
    table.index('friend_id');
  });

  // 好友申请表
  await knex.schema.createTable('friend_requests', (table) => {
    table.increments('id').primary();
    table.integer('from_user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.integer('to_user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('message', 200).defaultTo(''); // 申请附言
    table.string('status', 20).notNullable().defaultTo('pending'); // pending / accepted / rejected
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('handled_at').nullable();

    // 联合唯一约束：同一用户对另一用户只能有一个未处理的申请
    table.unique(['from_user_id', 'to_user_id']);

    // 索引
    table.index('from_user_id');
    table.index('to_user_id');
    table.index('status');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('friend_requests');
  await knex.schema.dropTableIfExists('friends');
};
