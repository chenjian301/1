# 抖音云后端：Docker 镜像方式部署用的最小 Dockerfile
#
# 控制台里选「Docker 镜像」时，构建上下文选 douyin-cloud\（这个文件所在目录），
# 镜像内会跑 `node index.js`，监听 $PORT（默认 8080）。
# 也可以不用 Docker：服务端零依赖，把 svr\ 里那两个文件直接交上去也能跑（线上与本地都不需要 npm install）。
# 2026-09-30 复核：抖音云的 git部署 会来仓库找 Dockerfile —— 表单默认值 `Dockerfile` 按仓库根解析（对应仓库
# 根那个 Dockerfile），本文件的 COPY 针对"上下文 = 本目录"。该挑哪个见 docs\douyin-cloud-deploy.md §2.6。
#
# 注意：抖音云默认域名只支持测试（10 QPS）、外网响应 ≤ 1MB，上线要绑自定义域名。

FROM node:20-alpine

WORKDIR /app

# 只拷服务代码：零依赖，所以没有 npm install 这一步，构建很快也几乎不会失败
COPY svr/index.js /app/index.js
COPY svr/package.json /app/package.json

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "index.js"]
