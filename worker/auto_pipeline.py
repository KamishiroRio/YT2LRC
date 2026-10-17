"""YouTube audio download via yt-dlp (with retries).

Ported from the original D:\\lyrics-align-web-ver\\backend\\auto_pipeline.py.
The uta-net/iTunes scraping logic has moved to the Amplify `preview` function,
so only the download helper is needed here.
"""
import random
import time

import yt_dlp


def download_youtube_audio(yt_url: str, output_path: str, log_callback, max_retries: int = 5) -> bool:
    """Download audio and convert to WAV using yt-dlp + ffmpeg."""
    base_path = output_path.replace(".wav", "")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": f"{base_path}.%(ext)s",
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "wav",
            "preferredquality": "0",
        }],
        "quiet": True,
        "no_warnings": True,
        # YouTube blocks datacenter IPs with the default web client ("Sign in
        # to confirm you're not a bot"), so try alternate player clients first.
        "extractor_args": {"youtube": {"player_client": ["android", "tv", "web"]}},
    }

    for attempt in range(1, max_retries + 1):
        log_callback(f"📥 開始下載 YouTube 音源 (第 {attempt}/{max_retries} 次嘗試)...")

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.extract_info(yt_url, download=True)
            log_callback("✅ 音檔下載與轉檔完畢！")
            return True

        except yt_dlp.utils.DownloadError as e:
            log_callback(f"⚠️ 下載失敗 (嘗試 {attempt}/{max_retries}): {e}")
            if attempt < max_retries:
                sleep_time = random.uniform(3.0, 7.0)
                log_callback(f"⏳ 休息 {sleep_time:.1f} 秒後換個節點再試...")
                time.sleep(sleep_time)
            else:
                log_callback("❌ 已達最大重試次數，放棄下載。")
                return False

        except Exception as e:
            log_callback(f"❌ 發生未知錯誤: {e}")
            return False

    return False
