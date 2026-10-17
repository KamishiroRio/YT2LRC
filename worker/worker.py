"""YT2LRC ML worker entrypoint.

Polls SQS for jobs, runs the alignment pipeline, uploads the .lrc to S3 and
updates the Job record in DynamoDB.
"""
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone

import boto3
import stable_whisper
from pymongo import MongoClient

from aligner import isolate_vocals, align_and_convert_to_lrc
from auto_pipeline import download_youtube_audio


def _env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


QUEUE_URL = _env("JOB_QUEUE_URL")
TABLE_NAME = _env("JOBS_TABLE_NAME")
BUCKET_NAME = _env("LRC_BUCKET_NAME")
REGION = os.environ.get("AWS_REGION") or "us-east-1"
MONGO_URI = os.environ.get("MONGO_URI")  # optional; skip MongoDB write if unset

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)
s3 = boto3.client("s3", region_name=REGION)
sqs = boto3.client("sqs", region_name=REGION)

print("載入 Whisper 模型 (small)...", flush=True)
MODEL = stable_whisper.load_model("small")


def update_job(job_id: str, *, status=None, lrc_key=None, progress_log=None):
    parts = []
    values = {}
    names = {}
    if status is not None:
        parts.append("#s = :s")
        values[":s"] = status
        names["#s"] = "status"
    if lrc_key is not None:
        parts.append("#l = :l")
        values[":l"] = lrc_key
        names["#l"] = "lrcKey"
    if progress_log is not None:
        parts.append("#p = :p")
        values[":p"] = progress_log
        names["#p"] = "progressLog"
    if not parts:
        return

    table.update_item(
        Key={"id": job_id},
        UpdateExpression="SET " + ", ".join(parts),
        ExpressionAttributeValues=values,
        ExpressionAttributeNames=names,
    )


def get_job(job_id: str):
    resp = table.get_item(Key={"id": job_id})
    return resp.get("Item")


def write_lrc_to_mongo(track_id: str, lrc_path: str):
    """Write the generated .lrc to MongoDB (spotify_project.lyrics) if configured."""
    if not MONGO_URI:
        return
    try:
        client = MongoClient(MONGO_URI)
        db = client["spotify_project"]
        collection = db["lyrics"]
        with open(lrc_path, "r", encoding="utf-8") as f:
            lrc_content = f.read()
        collection.update_one(
            {"track_id": track_id},
            {"$set": {"lrc": lrc_content}},
            upsert=True,
        )
        client.close()
        print(f"✅ 已寫入 MongoDB：{track_id}", flush=True)
    except Exception as e:
        print(f"  (MongoDB 寫入失敗: {e})", flush=True)


def process_message(body: dict):
    job_id = body["jobId"]
    youtube_url = body["youtubeUrl"]
    lyrics = body.get("lyrics") or ""
    track_id = body.get("trackId") or ""
    audio_key = body.get("audioKey") or ""

    # Seed the log with whatever the startJob Lambda already wrote (e.g. "QUEUED").
    log_lines = []
    existing = get_job(job_id)
    if existing and existing.get("progressLog"):
        log_lines.append(existing["progressLog"])

    def log(msg: str):
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        line = f"[{ts}] {msg}"
        log_lines.append(line)
        print(line, flush=True)
        try:
            update_job(job_id, progress_log="\n".join(log_lines))
        except Exception as e:
            print(f"  (log update failed: {e})", flush=True)

    work_dir = tempfile.mkdtemp(prefix=f"yt2lrc_{job_id}_")
    wav_path = os.path.join(work_dir, "audio.wav")
    lrc_path = os.path.join(work_dir, "output.lrc")

    try:
        log(f"開始處理：{track_id}")

        update_job(job_id, status="DOWNLOADING")
        if audio_key:
            log("[1/4] 從 S3 下載使用者上傳的音檔...")
            local_audio = os.path.join(work_dir, os.path.basename(audio_key))
            s3.download_file(BUCKET_NAME, audio_key, local_audio)
            log("✅ [1/4] 音檔下載完成！")
        else:
            log("[1/4] 準備啟動 yt-dlp 下載音源...")
            if not download_youtube_audio(youtube_url, wav_path, log):
                update_job(job_id, status="FAILED")
                log("❌ 下載失敗。[DONE]")
                return
            local_audio = wav_path
            log("✅ [1/4] 音源下載完成！")

        log("[2/4] 準備啟動 Demucs 人聲分離...")
        update_job(job_id, status="SEPARATING")
        vocal_path = isolate_vocals(local_audio, work_dir, log)
        log("✅ [2/4] Demucs 人聲分離完成！")

        log("[3/4] 準備啟動 Whisper 模型對齊...")
        update_job(job_id, status="ALIGNING")
        if not align_and_convert_to_lrc(MODEL, vocal_path, lyrics, lrc_path, log):
            update_job(job_id, status="FAILED")
            log("❌ 對齊失敗 (歌詞為空)。[DONE]")
            return
        log("✅ [3/4] Whisper 對齊完成！")

        log("[4/4] 準備上傳 LRC 到 S3...")
        lrc_key = f"lrc/{job_id}.lrc"
        s3.upload_file(lrc_path, BUCKET_NAME, lrc_key)
        update_job(job_id, status="DONE", lrc_key=lrc_key)
        write_lrc_to_mongo(track_id, lrc_path)
        log("🎉 完美收工！已成功上傳 LRC。[DONE]")

    except Exception as e:
        try:
            update_job(job_id, status="FAILED")
        except Exception:
            pass
        log(f"❌ 產線崩潰：{e} [DONE]")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def main():
    print(f"Worker started. Queue={QUEUE_URL} Table={TABLE_NAME} Bucket={BUCKET_NAME}", flush=True)

    while True:
        resp = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=20,  # long polling
            VisibilityTimeout=3600,  # long ML jobs need more than the queue default
        )

        for msg in resp.get("Messages", []):
            receipt = msg["ReceiptHandle"]
            try:
                process_message(json.loads(msg["Body"]))
            except Exception as e:
                print(f"Error processing message: {e}", flush=True)
            finally:
                sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt)


if __name__ == "__main__":
    main()
