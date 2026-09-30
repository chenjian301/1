#!/bin/sh
# run.sh —— 抖音云「容器运行时启动文件」（放在**仓库根**，与官方模板同款位置）
#
# 为什么必须有这个文件（2026-09-30 发布失败的唯一原因）：
#   控制台 git部署 发布失败，日志里三行都是：
#     [FaaS System] run user command: ulimit -n ${BYTEFAAS_FUNC_ULIMIT:-2048} && /opt/application/run.sh
#     sh: /opt/application/run.sh: not found        -> exit status 127 -> 发布失败
#   平台的运行时**固定执行 /opt/application/run.sh**，它不看镜像里的 CMD。
#   官方模板 bytedance/douyincloud-nodejs-koa-demo 就是这么设计的：
#     README 目录结构里写着「run.sh  容器运行时启动文件」（内容只有一行 `npm run serve`），
#     它的 Dockerfile 是 WORKDIR /opt/application/ -> COPY run.sh ./ ->
#     RUN chmod -R 777 /opt/application/run.sh -> CMD /opt/application/run.sh。
#   我们之前只有 `CMD ["node","index.js"]` + WORKDIR /app、仓库里一个 run.sh 都没有，
#   所以那个固定命令必然 "not found"。
#
# 本文件在仓库里存在**两份，内容逐字节相同**：
#   仓库根 run.sh（这份）          配 仓库根 Dockerfile（COPY 路径从 douyin-cloud/ 写起）
#   douyin-cloud\run.sh            配 douyin-cloud\Dockerfile（COPY 路径从 svr/ 写起）
# 为什么要两份：Docker build 的上下文只能向下取文件，COPY 不能引用上下文之外的东西，
#   而表单里 Dockerfile 一栏既有「仓库根」理解也有「douyin-cloud\」理解（见
#   docs\douyin-cloud-deploy.md §2.6）。两份必须保持一致 —— tools\cloud-deploy-check.ps1
#   会断言它们逐字节相同。
#
# 入口路径故意写成自动探测、不写死，因为本文件有两种生效场景：
#   ① 按 Dockerfile 构建：本文件被 COPY 到 /opt/application/run.sh，index.js 就在旁边；
#   ② 平台没用我们的 Dockerfile、把代码挂到 /opt/application：此时 index.js 在
#      douyin-cloud/svr/index.js（仓库根那份布局）。
#
# 端口：平台监管进程的日志写着 "restarting user function at port 8000"，
#   官方模板也硬编码 8000（src/server.ts: `const PORT = 8000;`）。所以这里：
#   平台注入了 PORT 就听平台的，没注入才补 8000。**不要在 Dockerfile 里写 ENV PORT=...**，
#   那会把端口钉死成平台不认的值（这是本次复盘的第二处坑）。
#
# 本文件必须是 **LF 换行、不带 BOM**：shebang 行尾多一个 \r，内核就会拿 "#!/bin/sh\r"
#   去找解释器 —— 现象同样是 "not found"/"bad interpreter"。Windows 编辑器很容易改坏，
#   所以 tools\cloud-deploy-check.ps1 会逐字节检查换行与 BOM。

set -e

# 1) 站到本脚本所在目录（镜像里就是 /opt/application）
DIR=$(cd "$(dirname "$0")" && pwd)
cd "$DIR"

# 2) 端口：优先用平台注入的 PORT，否则用平台的默认值 8000
if [ -z "${PORT:-}" ]; then
  PORT=8000
  export PORT
fi

# 3) 找到入口就交棒。用 exec：node 直接顶替本进程，平台发的 SIGTERM 能直达它。
NODE_BIN=$(command -v node || echo 'NOT-FOUND')
for entry in ./index.js ./svr/index.js ./douyin-cloud/svr/index.js; do
  if [ -f "$entry" ]; then
    echo "[run.sh] cwd=$DIR  entry=$entry  port=$PORT  node=$NODE_BIN"
    exec node "$entry"
  fi
done

# 4) 找不到就把现场打出来再退出：控制台日志是唯一能看到原因的地方，
#    只给一个 127 会让人再猜一轮（这次复盘就是这么开始的）。
echo "[run.sh] ERROR: no index.js found under $DIR" >&2
echo "[run.sh] tried: ./index.js ./svr/index.js ./douyin-cloud/svr/index.js" >&2
ls -la "$DIR" >&2
exit 127
