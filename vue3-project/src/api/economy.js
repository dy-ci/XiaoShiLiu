import request from './request.js'

// 获取用户经济信息
export const getEconomy = () => request.get('/economy')

// 获取用户等级
export const getLevel = () => request.get('/economy/level')

// 获取已装备
export const getEquipped = () => request.get('/economy/equipped')

// 获取指定用户的装备摘要（公开接口）
export const getUserEquipped = (userId) => request.get(`/economy/equipped/${userId}`)

// 获取背包
export const getInventory = (params) => request.get('/economy/inventory', { params })

// 装备道具
export const equipItem = (data) => request.post('/economy/equip', data)

// 卸下道具
export const unequipItem = (data) => request.post('/economy/unequip', data)

// 获取交易记录
export const getTransactions = (params) => request.get('/economy/transactions', { params })

// 获取商店列表
export const getShopItems = (params) => request.get('/shop/items', { params })

// 购买道具
export const buyItem = (data) => request.post('/shop/buy', data)

// 获取任务列表
export const getTasks = () => request.get('/tasks')

// 领取任务奖励
export const claimTask = (data) => request.post('/tasks/claim', data)

// 获取成就列表
export const getAchievements = () => request.get('/achievements')

// 领取成就奖励
export const claimAchievement = (data) => request.post('/achievements/claim', data)
