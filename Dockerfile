# 仓库根 Dockerfile —— 抖音云「git部署 / 镜像部署」用（官方模板同款位置）
#
# 这个文件里有两处是**必须照着官方模板写**的，写错了发布会失败：
#
#   1) WORKDIR /opt/application/，镜像里必须有 run.sh，且 CMD 就是它。
#      平台的运行时**固定执行 /opt/application/run.sh**（日志原文：
#      `[FaaS System] run user command: ulimit -n ${BYTEFAAS_FUNC_ULIMIT:-2048} && /opt/application/run.sh`），
#      它不看我们的 CMD。2026-09-30 的发布失败就是这么来的：
#      `sh: /opt/application/run.sh: not found`（exit status 127）×3 → 发布失败。
#      之前这里是 WORKDIR /app + `CMD ["node","index.js"]`，镜像里根本没有那个路径。
#      复盘与完整日志见 docs\douyin-cloud-deploy.md §2.8；run.sh 头部也写了这件事。
#   2) 端口 8000（EXPOSE 8000；**不要**写 ENV PORT=...）。
#      官方模板 src/server.ts 硬编码 `const PORT = 8000;`，平台日志也写
#      "restarting user function at port 8000"。run.sh 只在平台没注入 PORT 时才补 8000；
#      一旦在这里 ENV 钉死端口，平台就找不到服务了（这是复盘里的第二处坑）。
#
# 为什么 COPY 路径从 douyin-cloud/ 写起：本文件在仓库根，构建上下文 = 仓库根
#   （官方模板的 Dockerfile 也在仓库根、与源码目录 src/ 同级，用 `COPY . .`）。
# 另一个文件 douyin-cloud\Dockerfile 是「上下文 = douyin-cloud\」那一份，COPY 写 svr/...
#   两个文件只差 COPY 的前缀，映射与怎么挑见 docs\douyin-cloud-deploy.md §2.6
#   （构建日志里出现 `COPY failed: file not found` 就是上下文与 Dockerfile 配错了组合）。
#
# 服务零依赖：没有 npm install，构建只有 COPY + chmod，失败面最小。
# 启动：/opt/application/run.sh → node index.js，监听 $PORT（平台没注入的话 8000）。
# 平台硬限制：默认域名仅测试（10 QPS）、外网响应 ≤ 1MB，上线要绑自定义域名。
#
# 本文件与 run.sh 都故意用 LF 换行；tools\cloud-deploy-check.ps1 会检查。

FROM node:20-alpine

WORKDIR /opt/application/

# 路径从仓库根写起（本文件在仓库根，上下文即仓库根）
COPY douyin-cloud/svr/index.js /opt/application/index.js
COPY douyin-cloud/svr/package.json /opt/application/package.json
COPY run.sh /opt/application/run.sh

# 官方模板同款：给启动文件执行权（平台的监管进程会直接执行它）
RUN chmod -R 777 /opt/application/run.sh

ENV NODE_ENV=production

EXPOSE 8000

# 官方模板同款写法（shell 形式）
CMD /opt/application/run.sh
