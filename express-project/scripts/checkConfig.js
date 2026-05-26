/**
 * 启动配置验证脚本
 * 在服务器启动前验证所有必需的配置
 */

const fs = require('fs');
const path = require('path');

console.log('\n🚀 ===== 服务器启动前配置检查 =====\n');

let hasError = false;

// 1. 检查 .env 文件
const envPath = path.resolve(__dirname, '..', '.env');
console.log('1️⃣  检查 .env 文件');
console.log('   路径:', envPath);

if (fs.existsSync(envPath)) {
  console.log('   ✅ .env 文件存在');
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  console.log('   📄 文件大小:', envContent.length, '字节');
  
  // 检查必需的环境变量
  const requiredVars = ['JWT_SECRET', 'DB_HOST', 'DB_NAME'];
  
  console.log('\n2️⃣  检查必需的环境变量:');
  for (const varName of requiredVars) {
    const regex = new RegExp(`^${varName}=(.+)`, 'm');
    const match = envContent.match(regex);
    
    if (match) {
      const value = match[1].trim();
      if (value === '' || value.includes('your_') || value === 'undefined') {
        console.log(`   ❌ ${varName}: 未正确设置 (值: "${value}")`);
        hasError = true;
      } else {
        console.log(`   ✅ ${varName}: 已设置 (长度: ${value.length})`);
        // 对于敏感信息，只显示部分
        if (varName.includes('SECRET') || varName.includes('PASSWORD') || varName.includes('KEY')) {
          console.log(`      值预览: ${value.substring(0, 15)}...`);
        }
      }
    } else {
      console.log(`   ❌ ${varName}: 未找到！`);
      hasError = true;
    }
  }
} else {
  console.log('   ❌ .env 文件不存在！');
  console.log('   💡 请确保在项目根目录有 .env 文件');
  hasError = true;
}

// 3. 检查 node_modules
const nodeModulesPath = path.resolve(__dirname, '..', 'node_modules');
console.log('\n3️⃣  检查依赖安装:');
if (fs.existsSync(nodeModulesPath)) {
  console.log('   ✅ node_modules 目录存在');
} else {
  console.log('   ❌ node_modules 目录不存在！请先运行 npm install');
  hasError = true;
}

// 4. 检查 uploads 目录
const uploadsPath = path.resolve(__dirname, '..', 'uploads');
console.log('4️⃣  检查上传目录:');
if (!fs.existsSync(uploadsPath)) {
  console.log('   ⚠️  uploads 目录不存在，将自动创建');
  try {
    fs.mkdirSync(uploadsPath, { recursive: true });
    console.log('   ✅ uploads 目录已创建');
  } catch (err) {
    console.error('   ❌ 创建uploads目录失败:', err.message);
  }
} else {
  console.log('   ✅ uploads 目录已存在');
}

// 输出结果
console.log('\n' + '='.repeat(50));
if (hasError) {
  console.log('❌ 配置检查失败！请修复上述错误后再启动服务器\n');
  process.exit(1);
} else {
  console.log('✅ 所有配置检查通过！可以安全启动服务器\n');
}

module.exports = { hasError };
