#!/bin/bash
# 生产环境快速修复脚本
# 用于修复 JWT_SECRET 未加载的问题

echo "🔧 ===== 生产环境配置修复工具 ====="
echo ""

# 检查 .env 文件是否存在
if [ ! -f ".env" ]; then
    echo "❌ .env 文件不存在"
    echo "正在从 .env.docker 创建..."
    
    if [ -f ".env.docker" ]; then
        cp .env.docker .env
        echo "✅ 已从 .env.docker 创建 .env 文件"
    else
        echo "❌ .env.docker 也不存在！"
        echo "请手动创建 .env 文件，至少包含以下内容："
        echo ""
        echo "# JWT配置（必须设置！）"
        echo "JWT_SECRET=your_fixed_secret_key_here_at_least_32_chars"
        echo ""
        echo "数据库配置"
        echo "DB_HOST=mysql"
        echo "DB_USER=root"
        echo "DB_PASSWORD=123456"
        echo "DB_NAME=xiaoshiliu"
        exit 1
    fi
fi

# 检查 JWT_SECRET 是否存在
if grep -q "^JWT_SECRET=" .env; then
    # 提取JWT_SECRET值
    JWT_VALUE=$(grep "^JWT_SECRET=" .env | cut -d'=' -f2)
    
    if [ -z "$JWT_VALUE" ]; then
        echo "❌ JWT_SECRET 值为空！"
        echo "正在设置默认值..."
        
        # 生成随机密钥
        RANDOM_SECRET=$(openssl rand -hex 32)
        sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$RANDOM_SECRET/" .env
        
        echo "✅ 已设置随机 JWT_SECRET: ${RANDOM_SECRET:0:20}..."
        echo "⚠️  请记住这个值，或者修改为固定的值！"
    else
        echo "✅ JWT_SECRET 已设置 (长度: ${#JWT_VALUE})"
        echo "   前20字符: ${JWT_VALUE:0:20}"
    fi
else
    echo "⚠️  .env 中没有 JWT_SECRET 配置"
    echo "正在添加..."
    
    RANDOM_SECRET=$(openssl rand -hex 32)
    echo "" >> .env
    echo "# JWT配置" >> .env
    echo "JWT_SECRET=$RANDOM_SECRET" >> .env
    
    echo "✅ 已添加 JWT_SECRET: ${RANDOM_SECRET:0:20}..."
fi

# 检查其他关键配置
echo ""
echo "📋 其他关键配置检查:"

for VAR in DB_HOST DB_NAME NODE_ENV; do
    if grep -q "^$VAR=" .env; then
        VALUE=$(grep "^$VAR=" .env | cut -d'=' -f2)
        echo "   ✅ $VAR = $VALUE"
    else
        echo "   ⚠️  $VAR 未设置（将使用默认值）"
    fi
done

echo ""
echo "🔄 现在需要重启Docker容器以应用更改:"
echo ""
echo "  docker-compose down"
echo "  docker-compose up -d --build backend"
echo ""
echo "🔍 或者查看容器日志确认配置加载:"
echo ""
echo "  docker logs xiaoshiliu-backend --tail 50"
echo ""
echo "🔧 ===== 修复完成 ====="
