const { RESPONSE_CODES, HTTP_STATUS } = require('../constants');

// 权限列表定义
const PERMISSIONS = {
  // API文档
  'api_docs:view': '查看API文档',
  
  // 动态监控
  'monitor:view': '查看系统监控',
  
  // 用户管理
  'users:view': '查看用户',
  'users:edit': '编辑用户',
  'users:delete': '删除用户',
  'users:ban': '封禁/解封用户',
  
  // 笔记管理
  'posts:view': '查看笔记',
  'posts:edit': '编辑笔记',
  'posts:delete': '删除笔记',
  
  // 笔记审核
  'post_audit:view': '查看待审核笔记',
  'post_audit:audit': '审核笔记',
  
  // 评论管理
  'comments:view': '查看评论',
  'comments:edit': '编辑评论',
  'comments:delete': '删除评论',
  
  // 分类管理
  'categories:view': '查看分类',
  'categories:edit': '编辑分类',
  'categories:delete': '删除分类',
  'categories:create': '创建分类',
  
  // 标签管理
  'tags:view': '查看标签',
  'tags:edit': '编辑标签',
  'tags:delete': '删除标签',
  'tags:create': '创建标签',
  
  // 点赞管理
  'likes:view': '查看点赞',
  'likes:delete': '删除点赞',
  
  // 收藏管理
  'collections:view': '查看收藏',
  'collections:delete': '删除收藏',
  
  // 关注管理
  'follows:view': '查看关注',
  'follows:delete': '删除关注',
  
  // 通知管理
  'notifications:view': '查看通知',
  'notifications:create': '发送通知',
  'notifications:delete': '删除通知',
  
  // 用户会话管理
  'user_sessions:view': '查看用户会话',
  'user_sessions:delete': '禁用会话',
  
  // 管理员会话管理
  'admin_sessions:view': '查看管理员会话',
  'admin_sessions:delete': '禁用管理员会话',
  
  // 认证管理
  'audit:view': '查看认证审核',
  'audit:audit': '审核认证',
  
  // 管理员管理
  'admins:view': '查看管理员',
  'admins:edit': '编辑管理员',
  'admins:delete': '删除管理员',
  'admins:create': '创建管理员'
};

// 检查权限的函数
function checkPermission(adminPermissions, requiredPermission, isSuper) {
  // 超级管理员拥有所有权限
  if (isSuper) return true;
  
  // 如果没有权限字段，默认拒绝
  if (!adminPermissions) return false;
  
  // 检查是否有对应权限
  if (Array.isArray(adminPermissions)) {
    return adminPermissions.includes(requiredPermission);
  }
  
  // 如果是字符串，尝试解析
  if (typeof adminPermissions === 'string') {
    try {
      const permissions = JSON.parse(adminPermissions);
      return Array.isArray(permissions) && permissions.includes(requiredPermission);
    } catch (e) {
      return false;
    }
  }
  
  return false;
}

// 权限验证中间件
function requirePermission(permission) {
  return (req, res, next) => {
    // 确保用户已登录（adminAuth 中间件已处理）
    if (!req.user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '未登录'
      });
    }
    
    const { adminPermissions, isSuper } = req.user;
    
    // 检查权限
    if (!checkPermission(adminPermissions, permission, isSuper)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '无权限执行此操作'
      });
    }
    
    next();
  };
}

// 获取所有权限列表的函数
function getAllPermissions() {
  return PERMISSIONS;
}

// 预定义角色权限
const ROLES = {
  'super_admin': {
    name: '超级管理员',
    permissions: Object.keys(PERMISSIONS),
    description: '拥有所有权限'
  },
  'content_admin': {
    name: '内容管理员',
    permissions: [
      'posts:view', 'posts:edit', 'posts:delete',
      'post_audit:view', 'post_audit:audit',
      'comments:view', 'comments:edit', 'comments:delete',
      'categories:view', 'categories:edit', 'categories:delete', 'categories:create',
      'tags:view', 'tags:edit', 'tags:delete', 'tags:create'
    ],
    description: '只负责内容管理'
  },
  'user_admin': {
    name: '用户管理员',
    permissions: [
      'users:view', 'users:edit', 'users:delete', 'users:ban',
      'audit:view', 'audit:audit'
    ],
    description: '只负责用户和认证管理'
  },
  'operator': {
    name: '运维人员',
    permissions: [
      'api_docs:view',
      'monitor:view',
      'user_sessions:view', 'user_sessions:delete',
      'admin_sessions:view', 'admin_sessions:delete'
    ],
    description: '只负责监控和会话管理'
  }
};

module.exports = {
  checkPermission,
  requirePermission,
  getAllPermissions,
  ROLES,
  PERMISSIONS
};
