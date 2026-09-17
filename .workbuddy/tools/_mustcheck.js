// 临时：统计 _gems.html 里（去掉 <style> 后）若干候选文案的出现次数，
// 用来给 svgcheck 的 MUST_BY_FILE 挑一份"画面里真有的原句"。用完即弃。
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '_gems.html'), 'utf8');
const body = h.replace(/<style[\s\S]*?<\/style>/g, '');
const cands = ['固有技能', '攻击间隔', '宝石', '图签等级', '取消', '背包', '已解锁', '看广告', '点击任意位置', 'Lv.', '空槽', '未解锁', '关闭', '等级'];
const lines = cands.map((s) => `${s}\t${(body.split(s).length - 1)}`);
fs.writeFileSync(path.join(__dirname, '_must.txt'), lines.join('\n') + '\n', 'utf8');
