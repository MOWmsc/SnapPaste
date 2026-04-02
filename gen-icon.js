const zlib = require('zlib');
const fs = require('fs');

const W = 512, H = 512;
const rawData = Buffer.alloc(H * (1 + W * 4));

function inRoundedRect(x, y, rx, ry, rw, rh, r) {
  const lx = x - rx, ly = y - ry;
  if (lx < 0 || lx >= rw || ly < 0 || ly >= rh) return false;
  if ((lx < r && ly < r && Math.sqrt((lx-r)**2+(ly-r)**2) > r) ||
      (lx > rw-r && ly < r && Math.sqrt((lx-rw+r)**2+(ly-r)**2) > r) ||
      (lx < r && ly > rh-r && Math.sqrt((lx-r)**2+(ly-rh+r)**2) > r) ||
      (lx > rw-r && ly > rh-r && Math.sqrt((lx-rw+r)**2+(ly-rh+r)**2) > r)) return false;
  return true;
}

for (let y = 0; y < H; y++) {
  const ro = y * (1 + W * 4);
  rawData[ro] = 0;
  for (let x = 0; x < W; x++) {
    const px = ro + 1 + x * 4;
    const inBg = inRoundedRect(x, y, 20, 20, 472, 472, 80);
    if (!inBg) { rawData[px+3] = 0; continue; }

    // 渐变蓝色背景
    const t = (x + y) / (W + H);
    rawData[px] = Math.round(59*(1-t)+29*t);
    rawData[px+1] = Math.round(130*(1-t)+78*t);
    rawData[px+2] = Math.round(246*(1-t)+216*t);
    rawData[px+3] = 255;

    // 剪贴板主体
    if (inRoundedRect(x, y, 140, 170, 232, 260, 18)) {
      rawData[px]=255; rawData[px+1]=255; rawData[px+2]=255; rawData[px+3]=242;
    }
    // 夹子底
    if (inRoundedRect(x, y, 200, 130, 112, 60, 14)) {
      rawData[px]=255; rawData[px+1]=255; rawData[px+2]=255; rawData[px+3]=242;
    }
    // 夹子顶
    if (inRoundedRect(x, y, 220, 115, 72, 42, 10)) {
      rawData[px]=30; rawData[px+1]=90; rawData[px+2]=200; rawData[px+3]=255;
    }
    // 文本行
    const lines = [[175,162,250,14],[175,130,285,14],[175,148,320,14],[175,100,355,14]];
    for (const [lx,lw,ly,lh] of lines) {
      if (inRoundedRect(x, y, lx, ly, lw, lh, 7)) {
        rawData[px]=59; rawData[px+1]=130; rawData[px+2]=246; rawData[px+3]=160;
      }
    }
    // 闪电
    if (x >= 330 && x <= 380 && y >= 240 && y <= 355) {
      const fx = (x-330)/50, fy = (y-240)/115;
      const mid = 0.45;
      let inBolt = false;
      if (fy < mid) { // 上三角
        const t2 = fy / mid;
        inBolt = fx > 0.5 - t2*0.4 && fx < 0.5 + t2*0.15;
      } else { // 下三角
        const t2 = (fy - mid) / (1 - mid);
        inBolt = fx > 0.15 + t2*0.3 && fx < 0.65 - t2*0.15;
      }
      if (inBolt) {
        rawData[px]=251; rawData[px+1]=191; rawData[px+2]=36; rawData[px+3]=255;
      }
    }
  }
}

const compressed = zlib.deflateSync(rawData);

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c>>>1) ^ (c&1 ? 0xEDB88320 : 0);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const sig = Buffer.from([137,80,78,71,13,10,26,10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync('resources/icon.png', png);
console.log('Icon generated: ' + png.length + ' bytes');
