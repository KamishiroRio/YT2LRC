# YT2LRC

把 **YouTube 影片**轉成**日文同步歌詞（.lrc）**的全端工具。

輸入 YouTube 網址 + 歌詞，經過 AI 產線（音源 → 人聲分離 → Whisper 歌詞對齊），產出帶時間戳的 `.lrc` 檔，可下載、也可直接寫入 MongoDB 供 Spotify 歌詞播放器使用。

## 架構

```
Browser (Vite + React + Amplify UI)
   │  Amplify Hosting（登入 + 三步驟 UI）
   ▼
Amplify Gen 2 後端
   ├─ auth      (Cognito)     — 登入、每用戶資料隔離
   ├─ data      (DynamoDB)    — Job 記錄 + progressLog
   ├─ storage   (S3)          — .lrc 檔 + 使用者上傳的音檔
   └─ functions (Lambda)      — preview / startJob / fetchLyrics / getSignedLrcUrl
   │
   ▼
SQS 佇列 ──► ECS Fargate worker（Docker, Python；由 startJob 以 ecs:RunTask 按需啟動、跑完自動退出）
                音檔（使用者上傳 or yt-dlp）→ demucs → stable-whisper → .lrc
                → 上傳 S3 → 更新 DynamoDB → 寫入 MongoDB（選配）
```

## 產線流程

1. **預覽**：YouTube 網址 → oembed + iTunes 抓歌名/歌手 → utanet 抓候選歌詞（目前因封鎖改手動貼）。
2. **開始對齊**：`startJob` 寫入 `Job(QUEUED)` + 推訊息到 SQS + 用 `ecs:RunTask` 啟動 worker（若已有 worker 在跑則略過）。
3. **Worker**：從 SQS 收訊息 → 拿音檔（使用者上傳 or yt-dlp）→ Demucs 分離人聲 → stable-whisper 對齊 → 產出 .lrc。
4. **回傳**：上傳 .lrc 到 S3 → 更新 DynamoDB（status / lrcKey / progressLog）→ 寫入 MongoDB（選配）。
5. **前端**：每 2 秒輪詢 Job 狀態 → 顯示即時進度 → DONE 後下載 .lrc。

## 技術棧

| 層 | 技術 |
|----|------|
| 前端 | Vite + React + TypeScript + @aws-amplify/ui-react |
| 後端 | AWS Amplify Gen 2（Cognito / DynamoDB / AppSync / Lambda / S3 / SQS） |
| Worker | Python + yt-dlp + demucs + stable-ts + openai-whisper + boto3 + pymongo（Docker on ECS Fargate） |
| 資料庫 | DynamoDB（Job）+ S3（.lrc）+ MongoDB Atlas（選配，接 lyrics-api） |

## 部署

### 前端 + 後端（Amplify Hosting CI/CD）

- `git push` 即觸發 build（`amplify.yml`）。
- 後端：`DEPLOY_WORKER=true npx ampx pipeline-deploy ...`。
- 前端：`npm run build` → `dist`。

### Worker（Docker → ECR → ECS Fargate）

```bash
cd worker
docker build -t <ECR_URI>:latest .
docker push <ECR_URI>:latest
# 不用 Force new deployment（已無 ECS service）；startJob 會直接 RunTask 啟動 worker，
# worker 跑完、佇列空了會自己退出。
```

> ⚠️ ECR 登入 token 12 小時會過期，若 push 出現 `denied: Your authorization token has expired`：
> ```bash
> aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ECR_URI>
> ```
>
> ⚠️ 改 `worker/requirements.txt` 會讓 pip 快取失效，build 要 20～40 分鐘；只改 `worker.py` 則約 1 分鐘。

## 已知限制（重要）

- **utanet 爬歌詞**：擋「資料中心 IP」→ 前端目前請使用者**手動貼歌詞**。
- **yt-dlp 下載**：YouTube 也擋資料中心 IP → 改**手動上傳音檔**（前端給 yt-dlp 指令，本機下載後上傳）。

所以目前實際流程 = **貼歌詞 + 上傳音檔**。自動抓取待未來用「住宅 proxy」或「換歌詞/音源來源」解決。

## 生態系統（相關專案）

| 專案 | 角色 |
|------|------|
| 本專案（YT2LRC） | LRC 生成（Amplify 版） |
| `lyrics-align-web-ver/backend` | 原本的 LRC 生成（FastAPI + MongoDB，本機） |
| `lyrics-api` | LRC 伺服 API（FastAPI + MongoDB Atlas，Render） |
| `Spotify-LRC-Player` | Spotify 歌詞顯示（Chrome 擴充 / Spicetify） |

資料流：**YT2LRC → MongoDB（`spotify_project.lyrics`，key = `歌名_歌手`）→ lyrics-api → Spotify-LRC-Player**。

## 環境變數 / Secret

- `MONGO_URI`：存於 **AWS Secrets Manager**（secret 名 `YT2LRC_MONGO_URI`），以「金鑰/值」格式存，worker 讀取 `YT2LRC_MONGO_URI` 欄位。
- 連接字串**絕對不能**進 GitHub（`.env` 需 gitignore）。

## 踩過的坑（重點紀錄）

1. **SQS 要放獨立堆疊**：`startJob`（data 堆疊）參考 SQS、worker 堆疊參考 Job 表，會造成 worker↔data 循環相依 → 把 SQS 搬到 `queue` 堆疊。
2. **utanet 擋 TLS 指紋**：Node fetch 被 403，改 `curl`（系統 TLS）＋ `allorigins` proxy 備援。
3. **套件名是 `stable-ts`**：PyPI 沒有 `stable-whisper`（模組才叫 `stable_whisper`）。
4. **secret 金鑰/值**：存成 key/value 格式時，CDK 要指定 `fromSecretsManager(secret, '欄位名')` 讀欄位，否則會讀到整包 JSON。
5. **`.env` 別 commit**：曾發生 `.env`（含 MongoDB 密碼）被推上 GitHub，務必 gitignore。
6. **CloudFormation 卡住**：Fargate service 等 image 時，stack 會卡 UPDATE_IN_PROGRESS，image push 上去才解卡。
7. **SQS + CloudWatch Alarm 不適合 0↔1 scale-to-zero**：SQS 指標（visible/notVisible）有延遲＋近似，會在 worker 處理中瞬間變 0，誤觸縮容把 task 殺掉（造成「每 ~4 分鐘重啟一個 task」的無限迴圈）。解法：**startJob Lambda 用 `ecs:RunTask` 按需啟動 worker、worker 跑完佇列空就 `break` 退出**（事件驅動，不靠指標）。
8. **data ↔ worker 循環相依**：startJob（data 堆疊）直接引用 worker 的 cluster/task-def ARN 會形成循環相依（worker 又要讀 data 的 Job 表）。解法：**SSM Parameter Store 存 launch config + env 用「純字串」+ IAM 用 wildcard**。注意 `StringParameter.parameterName` / `parameterArn` 其實是 `Ref` 不是純字串，照樣會循環。
9. **前端進度卡 [4/4]**：worker 先寫 `DONE` 再寫最後進度 log，前端「看到 DONE 就停止輪詢」→ 卡在「[4/4] 準備上傳」。修法：把最後進度 log 寫在 `DONE` 之前。
10. **前端 `onUpdate` 訂閱亂序**：DynamoDB stream 事件延遲/亂序，會把 `DONE` 蓋回舊狀態。拔掉訂閱、只用 2 秒輪詢（直接讀 DynamoDB 一定正確）。
11. **Demucs OOM**：8GB 記憶體對長歌不夠，worker 會 OOM（exit 137）卡死。改成 16GB + 4 vCPU + Docker 預載 demucs/whisper 模型（避免冷啟動重新下載）。
12. **ECR token 12 小時過期**：push 前若 `denied: authorization token expired`，重新 `aws ecr get-login-password | docker login`（跟網頁登入無關）。

## 本地開發

```bash
npm install
npx ampx sandbox   # 另一個終端機
npm run dev
```

## 檔案架構

### 一個 Job 的生命週期（資料流）

```
src/App.tsx (前端三步驟 UI)
   │  handleStart → client.mutations.startJob
   ▼
amplify/functions/startJob/handler.ts (startJob Lambda)
   │  1. 建立 Job(QUEUED) 到 DynamoDB
   │  2. 送訊息到 SQS
   │  3. ensureWorkerRunning → ecs:RunTask 啟動 worker（若已有 worker 在跑則略過）
   ▼
worker/worker.py (Fargate task：main → process_message)
   │  從 SQS 收訊息 → 依序跑產線
   │  ├─ [1/4] 拿音檔：S3 下載使用者上傳／auto_pipeline.py 用 yt-dlp 下載
   │  ├─ [2/4] aligner.py: isolate_vocals → demucs 分離人聲
   │  ├─ [3/4] aligner.py: align_and_convert_to_lrc → stable-whisper 對齊 → .lrc
   │  └─ [4/4] 上傳 .lrc 到 S3 → 寫 MongoDB → 更新 DynamoDB(DONE)
   │  佇列空了 → 自己退出（scale-to-zero）
   ▼
src/App.tsx 每 2 秒輪詢 Job → 顯示進度 → DONE 後下載 .lrc
```

### 各檔案職責

| 檔案 | 角色 |
|------|------|
| `src/App.tsx` | 前端三步驟 UI + 每 2 秒輪詢進度 + 下載 .lrc |
| `amplify/backend.ts` | 後端接線：SQS 佇列、ECS cluster/task-def、SSM launch config、IAM 權限 |
| `amplify/data/resource.ts` | Job model（DynamoDB schema）+ preview/startJob/fetchLyrics/getSignedLrcUrl 定義 |
| `amplify/functions/startJob/handler.ts` | startJob Lambda：建 Job → 送 SQS → RunTask 啟動 worker |
| `amplify/functions/preview/*` | preview Lambda：oembed + iTunes 抓歌名/歌手 + utanet 抓候選歌詞 |
| `amplify/functions/fetchLyrics/handler.ts` | fetchLyrics Lambda：抓候選歌詞的完整歌詞 |
| `amplify/functions/getSignedLrcUrl/handler.ts` | getSignedLrcUrl Lambda：產生 .lrc 的 S3 預簽名 URL |
| `worker/worker.py` | worker 主程式：輪詢 SQS → 跑產線 → 更新 DynamoDB + S3 + MongoDB |
| `worker/aligner.py` | demucs 人聲分離 + stable-whisper 對齊 + 產出 .lrc |
| `worker/auto_pipeline.py` | yt-dlp 下載 YouTube 音源（含重試） |
| `worker/Dockerfile` | worker image（預載 demucs/whisper 模型） |
| `amplify.yml` | Amplify CI/CD build spec |

## 目錄結構

```
amplify/            # Amplify Gen 2 後端
  backend.ts        # 後端 wiring（SQS + ECS + SSM + secret）
  data/resource.ts  # Job model + preview/startJob/fetchLyrics/getSignedLrcUrl
  functions/        # Lambda（preview / startJob / fetchLyrics / getSignedLrcUrl）
  storage/resource.ts
worker/             # ECS worker（Python）
  worker.py         # 主程式（輪詢 SQS → 產線 → S3 + DynamoDB + MongoDB）
  aligner.py        # demucs + stable-whisper + .lrc
  auto_pipeline.py  # yt-dlp 下載（含重試）
  Dockerfile
  requirements.txt
src/                # 前端（React）
amplify.yml         # CI/CD build spec
```
