const QR = require('qrcode');
const fs = require('fs');
const URL = 'https://ai-token-price-radar.app.workbuddy.host/?sharecode=LKS7L2VRNH';

(async () => {
  // 纯二维码：高纠错，留足静默区，扫描最稳
  await QR.toFile('qr-raw.png', URL, {
    errorCorrectionLevel: 'H',
    margin: 4,
    width: 1000,
    color: { dark: '#0b1219', light: '#ffffff' }
  });
  console.log('qr-raw.png 已生成');
  console.log('编码内容:', URL, '| 长度', URL.length);
})();
