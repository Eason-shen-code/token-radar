const fs = require('fs');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');

const url = 'https://ai-token-price-radar.app.workbuddy.host/?sharecode=LKS7L2VRNH';
const png = PNG.sync.read(fs.readFileSync('qr-raw.png'));
const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
console.log('解码结果:', res ? res.data : '(失败)');
console.log('与目标一致:', res && res.data === url ? '✅ 一致' : '❌ 不一致');
console.log('尺寸:', png.width + 'x' + png.height);
