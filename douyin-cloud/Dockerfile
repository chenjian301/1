# 抖音云后端：Docker 镜像方式部署用的最小 Dockerfile
#
# 控制台里选「Docker 镜像」时，构建上下文选 douyin-cloud\（这个文件所在目录），
# 镜像内会跑 `node index.js`，监听 $PORT（默认 8080）。
# 也可以不用 Docker：控制台支持「上传代码包 / 在线编辑」，那种情况下把 svr\ 里的
# index.js 直接传上去即可（它零依赖，不需要 npm install）。
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
