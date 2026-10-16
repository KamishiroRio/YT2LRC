# run_worker.ps1 — 啟動 YT2LRC worker（本機開發用）
Set-Location "C:\Users\user\Desktop\Projects\YT2LRC"

# 1. 把 venv 的 Scripts（demucs / yt-dlp）和舊 backend 的 ffmpeg 加進 PATH
$env:PATH = "D:\lyrics-align-web-ver\venv\Scripts;D:\lyrics-align-web-ver\backend;$env:PATH"

# 2. 從 amplify_outputs.json 讀環境變數
$custom = (Get-Content amplify_outputs.json -Raw | ConvertFrom-Json).custom
$env:JOB_QUEUE_URL   = $custom.jobQueueUrl
$env:JOBS_TABLE_NAME = $custom.jobsTableName
$env:LRC_BUCKET_NAME = $custom.lrcBucketName
$env:AWS_REGION      = "us-east-1"

# 3. 直接用 venv 的 Python 跑 worker（不用先 Activate）
& "D:\lyrics-align-web-ver\venv\Scripts\python.exe" worker\worker.py
