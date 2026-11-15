const fs = require('fs');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');

GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'CN');
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyhbd.ttc', 'CNBold');

const W = 1080, H = 1440;
const c = createCanvas(W, H);
const x = c.getContext('2d');

// 背景
x.fillStyle = '#EEF2F7';
x.fillRect(0, 0, W, H);

// 卡片
const roundRect = (ctx, rx, ry, rw, rh, r) => {
  ctx.beginPath();
  ctx.moveTo(rx + r, ry);
  ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, r);
  ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
  ctx.arcTo(rx, ry + rh, rx, ry, r);
  ctx.arcTo(rx, ry, rx + rw, ry, r);
  ctx.closePath();
};
x.save();
x.shadowColor = 'rgba(16,38,62,.10)';
x.shadowBlur = 28;
x.shadowOffsetY = 8;
roundRect(x, 70, 110, 940, 1220, 36);
x.fillStyle = '#FFFFFF';
x.fill();
x.restore();
roundRect(x, 70, 110, 940, 1220, 36);
x.strokeStyle = '#E3E9F1';
x.lineWidth = 2;
x.stroke();

// 标题（含版本号）
x.fillStyle = '#132133';
x.font = 'bold 54px CNBold';
x.textAlign = 'center';
x.fillText('AI算力价格检测台', W / 2, 250);
const tw = x.measureText('AI算力价格检测台').width;
x.fillStyle = '#E0761C';
x.font = 'bold 30px CNBold';
x.fillText('V2.1', W / 2 + tw / 2 + 46, 248);

// 副标题
x.fillStyle = '#5B6B80';
x.font = '27px CN';
x.fillText('每日 08:00 更新 · 32 个在售口径 · 含 7 天价格异动', W / 2, 340);

// 橙色分隔
x.fillStyle = '#E0761C';
roundRect(x, W / 2 - 40, 378, 80, 5, 3);
x.fill();

// 二维码
let qr;
(async()=>{
qr = await loadImage('qr-raw.png');
const QS = 520;
const qx = (W - QS) / 2, qy = 420;
x.drawImage(qr, qx, qy, QS, QS);

// 提示
x.fillStyle = '#132133';
x.font = 'bold 30px CNBold';
x.fillText('微信「扫一扫」或长按识别', W / 2, 1022);

x.fillStyle = '#8B9AAD';
x.font = '22px CN';
x.fillText('ai-token-price-radar.app.workbuddy.host', W / 2, 1068);

// 分割线
x.strokeStyle = '#E3E9F1';
x.lineWidth = 2;
x.beginPath();
x.moveTo(150, 1108);
x.lineTo(W - 150, 1108);
x.stroke();

// 三个关键数字
const stats = [
  ['最低可及', '¥0.11'],
  ['中位', '¥1.33'],
  ['最高', '¥46.67'],
];
stats.forEach(([k, v], i) => {
  const cx = W / 2 + (i - 1) * 270;
  x.textAlign = 'center';
  x.fillStyle = '#8B9AAD';
  x.font = '22px CN';
  x.fillText(k, cx, 1162);
  x.fillStyle = i === 0 ? '#12855C' : (i === 2 ? '#CF3F32' : '#132133');
  x.font = 'bold 40px CNBold';
  x.fillText(v, cx, 1212);
});

// 页脚
x.fillStyle = '#8B9AAD';
x.font = '20px CN';
x.textAlign = 'center';
x.fillText('数据每日自动抓取，含官方按量报价与套餐折算价', W / 2, 1284);

fs.writeFileSync('share-card.png', c.toBuffer('image/png'));
console.log('share-card.png 已生成', W + 'x' + H);
})();
