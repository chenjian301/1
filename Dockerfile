# 仓库根 Dockerfile —— 抖音云「git部署 / 镜像部署」用（这是官方模板的位置）
#
# 为什么仓库根还要有一个 Dockerfile：
#   * 抖音云 git部署 表单里 Dockerfile 一栏的默认值就是 `Dockerfile`，按仓库根解析；
#   * 官方模板 bytedance/douyincloud-nodejs-koa-demo 的 Dockerfile 也在仓库根，
#     与源码目录 src/ 同级，用 `COPY . .` —— 也就是**构建上下文 = 仓库根**。
#   所以本文件的 COPY 路径必须从仓库根写起（douyin-cloud/svr/...）。
#
# 另一个文件 douyin-cloud\Dockerfile 写的是 `COPY svr/...`，只有把上下文当成 douyin-cloud\ 时才对。
# 两个文件的差别只有下面 COPY 那两行的前缀 —— 哪种上下文都能构建，映射见
# docs\douyin-cloud-deploy.md §2.6（构建日志里出现 `COPY failed: file not found` 就是配错了组合）。
#
# 服务零依赖：没有 npm install，构建只有两步 COPY，失败面最小。
# 启动：node index.js，监听 $PORT（默认 8080；控制台填 8080）。
# 平台硬限制：默认域名仅测试（10 QPS）、外网响应 ≤ 1MB，上线要绑自定义域名。
#
# 这个文件故意用 LF 换行（Dockerfile 的通用约定；仓库其它文件是 CRLF）。

FROM node:20-alpine

WORKDIR /app

# 路径从仓库根写起（本文件在仓库根，上下文即仓库根）
COPY douyin-cloud/svr/index.js /app/index.js
COPY douyin-cloud/svr/package.json /app/package.json

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "index.js"]
