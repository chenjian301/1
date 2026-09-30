# douyin-cloud Dockerfile —— 构建上下文 = 本目录（douyin-cloud\）时用这份
#
# 位置说明：仓库里有两个 Dockerfile，只差 COPY 的前缀，两种上下文都能构建：
#   仓库根 Dockerfile        上下文 = 仓库根         COPY douyin-cloud/svr/index.js ...
#   本文件                   上下文 = douyin-cloud\   COPY svr/index.js ...
# 控制台 git部署 表单里 Dockerfile 一栏的默认值是 `Dockerfile`、按仓库根解析（就是仓库根那份）；
# 有「代码目标目录」字段时填 douyin-cloud + 本文件。怎么挑见 docs\douyin-cloud-deploy.md §2.6。
#
# 两处必须照着官方模板写（否则发布会失败，2026-09-30 已踩过）：
#   1) WORKDIR /opt/application/ + 镜像里有 run.sh + CMD 就是它 ——
#      平台运行时**固定执行 /opt/application/run.sh**，不看我们的 CMD。
#      失败的日志是 `sh: /opt/application/run.sh: not found`（exit status 127）→ 发布失败。
#      复盘见 docs\douyin-cloud-deploy.md §2.8。
#   2) 端口 8000（**不要**写 ENV PORT=...）：官方模板硬编码 8000，平台日志也写
#      "restarting user function at port 8000"；写死端口平台就找不到服务。
#
# 也可以不用 Docker：服务端零依赖，把 svr\ 里那两个文件 + run.sh 直接交上去也能跑
#   （线上与本地都不需要 npm install）。
#
# 平台硬限制：默认域名仅测试（10 QPS）、外网响应 ≤ 1MB，上线要绑自定义域名。
#
# 本文件与 run.sh 都故意用 LF 换行；tools\cloud-deploy-check.ps1 会检查。

FROM node:20-alpine

WORKDIR /opt/application/

# 上下文 = 本目录（douyin-cloud\），所以从 svr/ 写起
COPY svr/index.js /opt/application/index.js
COPY svr/package.json /opt/application/package.json
COPY run.sh /opt/application/run.sh

# 官方模板同款：给启动文件执行权（平台的监管进程会直接执行它）
RUN chmod -R 777 /opt/application/run.sh

ENV NODE_ENV=production

EXPOSE 8000

# 官方模板同款写法（shell 形式）
CMD /opt/application/run.sh
