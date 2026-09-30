/**
 * 16-render.js —— 世界渲染（纯 Canvas 2D，**没有引擎**，决策 #7 + 02-architecture §1）
 *
 * 阶段约定：所有实体的外观先用**圆形**代替（用户要求），所以这一层只做：
 *   地表色块 → 装饰圆 → 地标圆 → 怪（圆 + 血条 + 精英圆环）→ 玩家（圆 + 朝向）→
 *   弹道点 → 飘字 → 自动战斗目标环。贴图与图集是阶段 E 的事（01-game-design §12）。
 *
 * 相机与坐标：世界坐标 → 屏幕（设计单位）：
 *   sx = x - camera.x + SCREEN.width() / 2
 *   sy = y - camera.y + SCREEN.height() / 2
 * 相机本身由 19/20-main 用"向玩家缓动"维护（view.cameraLerpPerTick）。
 *
 * 性能纪律（02-architecture §9）：只画视野内的东西；地表按每 chunk 一块底色 +
 * 4×4 个色块（不是 8×8 —— 手机上少画 4 倍矩形，肉眼看不出差别），装饰/怪/飘字都有上限。
 */

G.RENDER = (function () {
  'use strict';

  var BAL = G.BAL;
  var CHUNK = G.CHUNK;
  var TERRAIN = G.TERRAIN;
  var SCREEN = G.SCREEN;

  /** 怪的种类配色（圆形代替贴图；精英统一加金环） */
  var MONSTER_COLORS = {
    wolf: '#c96b3a',
    bat: '#8a6bd0',
    mage: '#4f8fd8',
    brute: '#8d939c'
  };

  var MONSTER_DARK = {
    wolf: '#7d3f1f',
    bat: '#523f86',
    mage: '#2f5a8c',
    brute: '#565b63'
  };

  /** 世界坐标 → 屏幕设计坐标 */
  function toScreen(camera, x, y) {
    return { x: x - camera.x + SCREEN.width() / 2, y: y - camera.y + SCREEN.height() / 2 };
  }

  /** 地表：每 chunk 一块主题底色 + 4×4 色块（颜色来自 groundVariant，位置与主题都由哈希决定） */
  function drawGround(ctx, camera) {
    var width = SCREEN.width();
    var height = SCREEN.height();
    var minX = camera.x - width / 2;
    var minY = camera.y - height / 2;
    var rect = {
      minX: minX,
      minY: minY,
      maxX: camera.x + width / 2,
      maxY: camera.y + height / 2
    };
    var chunks = CHUNK.chunksInRect(rect.minX, rect.minY, rect.maxX, rect.maxY, 0);
    var seed = BAL.season.worldSeed;
    var block = CHUNK.CHUNK_SIZE / 4;

    for (var i = 0; i < chunks.length; i += 1) {
      var cx = chunks[i].cx;
      var cy = chunks[i].cy;
      var band = G.SPAWN.chunkCenterBand(cx, cy);
      var theme = TERRAIN.themeForBand(band);
      var tint = TERRAIN.deepBandIntensity(band);
      var ground = theme.ground;
      var origin = toScreen(camera, CHUNK.chunkOrigin(cx), CHUNK.chunkOrigin(cy));

      // 底色：深带用 accent 混一点，让"越走越远"有视觉反馈
      ctx.fillStyle = TERRAIN.mixHex(ground[0], '#000010', tint);
      ctx.fillRect(origin.x, origin.y, CHUNK.CHUNK_SIZE, CHUNK.CHUNK_SIZE);

      for (var by = 0; by < 4; by += 1) {
        for (var bx = 0; bx < 4; bx += 1) {
          // 取 8×8 噪声网格上的偶数格当代表，视觉效果一样但少画一大半
          var variant = TERRAIN.groundVariant(seed, cx, cy, bx * 2, by * 2);
          if (variant === 0) continue;
          ctx.fillStyle = TERRAIN.mixHex(ground[variant], '#000010', tint);
          ctx.fillRect(origin.x + bx * block, origin.y + by * block, block + 1, block + 1);
        }
      }
    }
  }

  /** 装饰：草 / 石 / 枯树都先用圆（有碰撞检测的话以后再说 —— 现阶段完全无碰撞） */
  function drawDecor(ctx, camera, decor) {
    var color = TERRAIN.themeForBand(G.SPAWN.chunkCenterBand(CHUNK.chunkIndexOf(camera.x), CHUNK.chunkIndexOf(camera.y))).decor;
    for (var i = 0; i < decor.length; i += 1) {
      var item = decor[i];
      var point = toScreen(camera, item.x, item.y);
      var radius = item.kind === 'tree' ? 13 : item.kind === 'rock' ? 9 : 6;
      radius *= item.size;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** 地标：废墟 / 石碑（圈 + 强调色光点），给"我走到新地方了"的反馈 */
  function drawLandmarks(ctx, camera, landmarks) {
    for (var i = 0; i < landmarks.length; i += 1) {
      var landmark = landmarks[i];
      var theme = TERRAIN.themeForBand(landmark.band);
      var point = toScreen(camera, landmark.x, landmark.y);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(landmark.kind === 'ruins' ? '废墟' : '石碑', point.x, point.y + 58);
    }
  }

  /** 怪：圆 + 血条 + 精英金环；仅对"当前目标/精英"画文字（画文字很贵，要省着用） */
  function drawMonsters(ctx, camera, monsters, targetId) {
    for (var i = 0; i < monsters.length; i += 1) {
      var monster = monsters[i];
      var point = toScreen(camera, monster.x, monster.y);
      var color = MONSTER_COLORS[monster.kindId] || '#c96b3a';
      var dark = MONSTER_DARK[monster.kindId] || '#7d3f1f';

      // 仇恨提示：正在追/正在打的怪底部加一圈暗色（一眼看出谁醒了）
      if (monster.state === 'chase' || monster.state === 'attack') {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(point.x, point.y, monster.radius + 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = monster.hurtUntil > 0 && G.WORLD.now() < monster.hurtUntil ? '#ffffff' : color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, monster.radius, 0, Math.PI * 2);
      ctx.fill();

      if (monster.elite) {
        ctx.strokeStyle = '#ffd479';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(point.x, point.y, monster.radius + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 血条：只在掉过血或正在交战时画
      if (monster.hp < monster.hpMax || monster.state === 'attack' || monster.state === 'chase') {
        var barW = Math.max(34, monster.radius * 2.4);
        var ratio = monster.hpMax > 0 ? monster.hp / monster.hpMax : 0;
        if (ratio < 0) ratio = 0;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(point.x - barW / 2, point.y - monster.radius - 14, barW, 7);
        ctx.fillStyle = '#e05c5c';
        ctx.fillRect(point.x - barW / 2, point.y - monster.radius - 14, barW * ratio, 7);
      }

      if (monster.elite || monster.id === targetId) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(monster.name + ' Lv.' + monster.level, point.x, point.y + monster.radius + 20);
      }
    }
  }

  /** 自动战斗的目标环（哪只在被打，一眼可见） */
  function drawTargetRing(ctx, camera, target) {
    if (!target) return;
    var point = toScreen(camera, target.x, target.y);
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, target.radius + 12, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** 玩家：圆 + 朝向短线 + 受击闪红；死亡时画成半透明（3 秒后原地复活） */
  function drawPlayer(ctx, camera, player, stats) {
    var point = toScreen(camera, player.x, player.y);
    ctx.globalAlpha = player.dead ? 0.35 : 1;
    ctx.fillStyle = player.hurtUntil > 0 && G.WORLD.now() < player.hurtUntil ? '#ffb4b4' : '#eaf2ff';
    ctx.beginPath();
    ctx.arc(point.x, point.y, BAL.player.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#6fa8ff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(point.x, point.y, BAL.player.radius, 0, Math.PI * 2);
    ctx.stroke();

    // 朝向短线：让"我在朝哪边"有反馈（贴图阶段会换成八方向素材）
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + player.facing.x * (BAL.player.radius + 14), point.y + player.facing.y * (BAL.player.radius + 14));
    ctx.stroke();

    // 打击范围（淡淡一圈，帮助理解为什么"差一点就打不到"）
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, BAL.player.attackRange, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = player.dead ? 0.35 : 1;
  }

  /** 远程弹道：一个小亮点沿直线飞 */
  function drawProjectiles(ctx, camera, shots) {
    ctx.fillStyle = '#9ad4ff';
    for (var i = 0; i < shots.length; i += 1) {
      var point = toScreen(camera, shots[i].x, shots[i].y);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 伤害飘字：向上飘 + 渐隐；暴击更大更黄 */
  function drawDamageNumbers(ctx, camera, numbers, nowMs) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < numbers.length; i += 1) {
      var number = numbers[i];
      var life = (number.until - nowMs) / BAL.view.damageNumberMs;
      if (life < 0) life = 0;
      var point = toScreen(camera, number.x, number.y);
      ctx.globalAlpha = life > 1 ? 1 : life;
      ctx.fillStyle = number.color;
      ctx.font = (number.crit ? 'bold 30px' : '24px') + ' sans-serif';
      ctx.fillText(number.text, point.x, point.y - (1 - life) * 42);
    }
    ctx.globalAlpha = 1;
  }

  return {
    MONSTER_COLORS: MONSTER_COLORS,
    MONSTER_DARK: MONSTER_DARK,
    toScreen: toScreen,
    drawGround: drawGround,
    drawDecor: drawDecor,
    drawLandmarks: drawLandmarks,
    drawMonsters: drawMonsters,
    drawTargetRing: drawTargetRing,
    drawPlayer: drawPlayer,
    drawProjectiles: drawProjectiles,
    drawDamageNumbers: drawDamageNumbers
  };
})();
