import request from './request.js'

// 聊天相关 API 封装
export const chatApi = {
  // 获取会话列表
  getConversations() {
    return request.get('/chat')
  },

  // 获取与指定用户的会话
  getConversationWithUser(userId) {
    return request.get(`/chat/conversations/with/${userId}`)
  },

  // 获取单个会话详情
  getConversation(id) {
    return request.get(`/chat/conversations/${id}`)
  },

  // 创建群聊
  createGroup(data) {
    return request.post('/chat/conversations/group', data)
  },

  // 更新会话信息
  updateConversation(id, data) {
    return request.put(`/chat/conversations/${id}`, data)
  },

  // 离开/删除会话
  leaveConversation(id) {
    return request.delete(`/chat/conversations/${id}`)
  },

  // 获取会话消息列表
  getMessages(conversationId, params = {}) {
    return request.get(`/chat/conversations/${conversationId}/messages`, { params })
  },

  // HTTP 发送消息（WebSocket 降级）
  sendMessage(conversationId, data) {
    return request.post(`/chat/conversations/${conversationId}/messages`, data)
  },

  // 编辑消息
  editMessage(messageId, content) {
    return request.put(`/chat/messages/${messageId}`, { content })
  },

  // 撤回消息
  recallMessage(messageId) {
    return request.post(`/chat/messages/${messageId}/recall`)
  },

  // 搜索消息
  searchMessages(conversationId, keyword) {
    return request.get(`/chat/conversations/${conversationId}/messages/search`, {
      params: { keyword }
    })
  },

  // 邀请成员加入群聊
  inviteMembers(conversationId, userIds) {
    return request.post(`/chat/conversations/${conversationId}/members`, { userIds })
  },

  // 移除群成员
  removeMember(conversationId, userId) {
    return request.delete(`/chat/conversations/${conversationId}/members/${userId}`)
  },

  // 设置成员角色
  setMemberRole(conversationId, userId, role) {
    return request.put(`/chat/conversations/${conversationId}/members/${userId}/role`, { role })
  },

  // 切换会话静音状态
  toggleMute(conversationId) {
    return request.put(`/chat/conversations/${conversationId}/mute`)
  },

  // ========== 好友系统 ==========

  // 获取好友列表
  getFriends() {
    return request.get('/chat/friends')
  },

  // 发送好友申请
  sendFriendRequest(toUserId, message = '') {
    return request.post('/chat/friends/request', { to_user_id: toUserId, message })
  },

  // 获取好友申请列表
  getFriendRequests() {
    return request.get('/chat/friends/requests')
  },

  // 接受好友申请
  acceptFriendRequest(requestId) {
    return request.post(`/chat/friends/requests/${requestId}/accept`)
  },

  // 拒绝好友申请
  rejectFriendRequest(requestId) {
    return request.post(`/chat/friends/requests/${requestId}/reject`)
  },

  // 检查是否是好友
  checkFriend(userId) {
    return request.get(`/chat/friends/check/${userId}`)
  }
}

export default chatApi
