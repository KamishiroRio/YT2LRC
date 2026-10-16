"""Vocal isolation (demucs) + lyrics alignment (stable-whisper) + LRC output.

Ported from the original D:\\lyrics-align-web-ver\\backend\\aligner.py.
"""
import os
import shutil
import subprocess
import tempfile


def isolate_vocals(audio_path: str, output_dir: str, log_callback=None) -> str:
    """Run demucs to separate vocals, return the path to vocals.wav."""
    def log(msg):
        if log_callback:
            log_callback(msg)
        else:
            print(msg)

    log("  -> 🪄 啟動 Demucs 進行人聲分離 (這會花一點時間)...")

    command = [
        "demucs",
        "--two-stems=vocals",
        "-n", "htdemucs",
        "-o", output_dir,
        audio_path,
    ]
    subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

    base = os.path.splitext(os.path.basename(audio_path))[0]
    vocal_path = os.path.join(output_dir, "htdemucs", base, "vocals.wav")
    if not os.path.exists(vocal_path):
        raise RuntimeError("Demucs 處理失敗，找不到 vocals.wav")
    return vocal_path


def align_and_convert_to_lrc(model, vocal_audio_path: str, lyrics_text: str, lrc_path: str, log_callback=None) -> bool:
    """Word-align the provided lyrics to the vocals and write an .lrc file."""
    def log(msg):
        if log_callback:
            log_callback(msg)
        else:
            print(msg)

    original_lines = [line.strip() for line in lyrics_text.splitlines() if line.strip()]
    if not original_lines:
        return False

    joined = "\n".join(original_lines)

    log("  -> 🎧 Whisper 模型精準對齊中...")

    # stable-whisper's align handles non-ASCII paths poorly in some versions,
    # so keep the original "English temp name" workaround (but write to the
    # system temp dir, NOT the project root, to avoid Vite watcher conflicts).
    safe_temp_audio = os.path.join(
        tempfile.gettempdir(), f"temp_whisper_in_{os.getpid()}.wav"
    )
    shutil.copy2(vocal_audio_path, safe_temp_audio)

    try:
        result = model.align(safe_temp_audio, joined, language="ja")
    finally:
        if os.path.exists(safe_temp_audio):
            os.remove(safe_temp_audio)

    # Flatten word timestamps, then map each character to its word's start time.
    all_words = []
    for segment in result.segments:
        all_words.extend(segment.words)

    char_to_time = []
    for w in all_words:
        for _ in range(len(w.word)):
            char_to_time.append(w.start)

    raw_times = []
    line_start_char_idx = 0
    for line in original_lines:
        if line_start_char_idx < len(char_to_time):
            raw_times.append(char_to_time[line_start_char_idx])
        else:
            raw_times.append(raw_times[-1] if raw_times else 0.0)
        line_start_char_idx += len(line) + 1

    # Fix any non-monotonic timestamps introduced by the alignment.
    for i in range(1, len(raw_times)):
        if raw_times[i] <= raw_times[i - 1]:
            next_valid_idx = i
            while next_valid_idx < len(raw_times) and raw_times[next_valid_idx] <= raw_times[i - 1]:
                next_valid_idx += 1

            if next_valid_idx < len(raw_times):
                end_time = raw_times[next_valid_idx]
            else:
                end_time = raw_times[i - 1] + 2.0

            steps = next_valid_idx - i + 1
            step_size = (end_time - raw_times[i - 1]) / steps

            log(f"  -> ⚠️ 發現微小重疊！已修正第 {i + 1} 行至第 {next_valid_idx} 行的時間。")
            for j in range(i, next_valid_idx):
                raw_times[j] = raw_times[j - 1] + step_size

    with open(lrc_path, "w", encoding="utf-8") as f:
        for line, start_time in zip(original_lines, raw_times):
            minutes = int(start_time // 60)
            seconds = start_time % 60
            time_tag = f"[{minutes:02d}:{seconds:05.2f}]"
            f.write(f"{time_tag} {line}\n")

    return True
