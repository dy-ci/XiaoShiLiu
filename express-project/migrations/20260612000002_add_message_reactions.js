/**
 * 添加消息表情回应表
 * message_reactions: 存储用户对消息的表情回应（如 👍❤️😂等）
 */
exports.up = async function (knex) {
  await knex.schema.createTable('message_reactions', (table) => {
    table.increments('id').primary();
    table.integer('message_id').unsigned().notNullable().references('id').inTable('messages').onDelete('CASCADE');
    table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('emoji', 32).notNullable(); // 表情符号，如 👍❤️😂😮😢😡🙏
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // 联合唯一约束：同一用户对同一消息只能有一个相同表情
    table.unique(['message_id', 'user_id', 'emoji']);

    // 索引
    table.index('message_id');
    table.index('user_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('message_reactions');
};
