const axios = require('axios');
const config = require('../config/config');

async function getIPLocation(ip) {
  try {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
      return '本地';
    }

    const response = await axios.get(config.ipLocation.primaryApi, {
      params: { ip: ip },
      timeout: config.ipLocation.primaryTimeout,
      responseType: 'arraybuffer'
    });

    const dataStr = Buffer.from(response.data).toString('utf-8');
    const data = JSON.parse(dataStr);

    if (data && data.ret === 200 && data.data) {
      const locationData = data.data;
      if (locationData.prov) {
        return locationData.prov.replace('省', '').replace('壮族自治区', '').replace('回族自治区', '').replace('回族自治区', '').replace('特别行政区', '').replace('市', '').replace('维吾尔自治区', '').replace('自治区', '');
      }
    }

    try {
      const backupResponse = await axios.get(config.ipLocation.backupApi, {
        params: { ip: ip },
        timeout: config.ipLocation.backupTimeout
      });

      if (backupResponse.data && backupResponse.data.code === 200 && backupResponse.data.data) {
        const locationData = backupResponse.data.data;
        if (locationData.subdivisions) {
          return locationData.subdivisions.replace('省', '').replace('壮族自治区', '').replace('回族自治区', '').replace('回族自治区', '').replace('特别行政区', '').replace('市', '').replace('维吾尔自治区', '').replace('自治区', '');
        } else if (locationData.region) {
          return locationData.region.replace('省', '').replace('壮族自治区', '').replace('回族自治区', '').replace('回族自治区', '').replace('特别行政区', '').replace('市', '').replace('维吾尔自治区', '').replace('自治区', '');
        } else if (locationData.prov) {
          return locationData.prov.replace('省', '').replace('壮族自治区', '').replace('回族自治区', '').replace('回族自治区', '').replace('特别行政区', '').replace('市', '').replace('维吾尔自治区', '').replace('自治区', '');
        }
      }
    } catch (backupError) {
      console.error('备用IP属地接口调用失败:', backupError.message);
    }

    return '未知';
  } catch (error) {
    console.error('获取IP属地失败:', error.message);
    return '未知';
  }
}

/**
 * 从请求中获取真实IP地址
 * @param {Object} req - Express请求对象
 * @returns {string} IP地址
 */
function getRealIP(req) {
  let ip = req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
    req.ip;

  // 处理IPv4映射的IPv6地址格式，去掉::ffff:前缀
  if (ip && typeof ip === 'string' && ip.startsWith('::ffff:')) {
    ip = ip.substring(7); // 去掉'::ffff:'前缀
  }

  // 如果是x-forwarded-for头，可能包含多个IP，取第一个
  if (ip && typeof ip === 'string' && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }

  return ip;
}

module.exports = {
  getIPLocation,
  getRealIP
};