# 生产环境配置修复脚本 (PowerShell版本)
# 用于修复 JWT_SECRET 未加载的问题

Write-Host "`n🔧 ===== 生产环境配置修复工具 =====`n" -ForegroundColor Yellow

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $projectRoot ".env"

# 检查 .env 文件是否存在
if (-not (Test-Path $envFile)) {
    Write-Host "❌ .env 文件不存在" -ForegroundColor Red
    
    $envDocker = Join-Path $projectRoot ".env.docker"
    if (Test-Path $envDocker) {
        Write-Host "正在从 .env.docker 创建..." -ForegroundColor Yellow
        Copy-Item $envDocker $envFile
        Write-Host "✅ 已从 .env.docker 创建 .env 文件" -ForegroundColor Green
    } else {
        Write-Host "❌ .env.docker 也不存在！" -ForegroundColor Red
        Write-Host "请手动创建 .env 文件" -ForegroundColor Red
        exit 1
    }
}

# 读取 .env 文件内容
$content = Get-Content $envFile -Raw

# 检查 JWT_SECRET 是否存在
if ($content -match "^JWT_SECRET=(.+)") {
    $jwtValue = $matches[1].Trim()
    
    if ([string]::IsNullOrWhiteSpace($jwtValue)) {
        Write-Host "❌ JWT_SECRET 值为空！" -ForegroundColor Red
        Write-Host "正在设置随机值..." -ForegroundColor Yellow
        
        # 生成随机密钥
        $randomSecret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
        
        $content = $content -replace "^JWT_SECRET=.*", "JWT_SECRET=$randomSecret"
        Set-Content $envFile $content -NoNewline
        
        Write-Host "✅ 已设置随机 JWT_SECRET: $($randomSecret.Substring(0,20))..." -ForegroundColor Green
        Write-Host "⚠️  请记住这个值！" -ForegroundColor Yellow
    } else {
        Write-Host "✅ JWT_SECRET 已设置 (长度: $($jwtValue.Length))" -ForegroundColor Green
        Write-Host "   前20字符: $($jwtValue.Substring(0, [Math]::Min(20, $jwtValue.Length)))"
    }
} else {
    Write-Host "⚠️  .env 中没有 JWT_SECRET 配置" -ForegroundColor Yellow
    Write-Host "正在添加..." -ForegroundColor Yellow
    
    # 生成随机密钥
    $randomSecret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
    
    Add-Content -Path $envFile -Value "`n# JWT配置`nJWT_SECRET=$randomSecret"
    
    Write-Host "✅ 已添加 JWT_SECRET: $($randomSecret.Substring(0,20))..." -ForegroundColor Green
}

# 检查其他关键配置
Write-Host "`n📋 其他关键配置检查:" -ForegroundColor Cyan

$varsToCheck = @("DB_HOST", "DB_NAME", "NODE_ENV")
foreach ($var in $varsToCheck) {
    if ($content -match "^$var=(.+)") {
        $value = $matches[1].Trim()
        Write-Host "   ✅ $var = $value" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  $var 未设置（将使用默认值）" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "🔄 现在需要重启Docker容器以应用更改:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  docker-compose down" -ForegroundColor White
Write-Host "  docker-compose up -d --build backend" -ForegroundColor White
Write-Host ""
Write-Host "🔍 查看容器日志确认配置加载:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  docker logs xiaoshiliu-backend --tail 100" -ForegroundColor White
Write-Host ""
Write-Host "🔧 ===== 修复完成 =====" -ForegroundColor Green
