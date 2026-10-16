import { useEffect, useRef, useState } from 'react'
import { generateClient } from 'aws-amplify/data'

import { useAuthenticator } from '@aws-amplify/ui-react'
import type { Schema } from '../amplify/data/resource'
import './App.css'

const client = generateClient<Schema>()

type Candidate = { title: string; artist: string; url: string }

const STATUS_LABELS: Record<string, string> = {
  QUEUED: '已排隊',
  DOWNLOADING: '下載音源中',
  SEPARATING: '人聲分離中',
  ALIGNING: '歌詞對齊中',
  DONE: '完成',
  FAILED: '失敗',
}

function App() {
  const { signOut } = useAuthenticator()

  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [trackId, setTrackId] = useState('')
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState('')

  const [jobId, setJobId] = useState('')
  const [status, setStatus] = useState('')
  const [progressLog, setProgressLog] = useState('')
  const [lrcKey, setLrcKey] = useState('')
  const [starting, setStarting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [pickingUrl, setPickingUrl] = useState('')

  const subRef = useRef<{ unsubscribe: () => void } | null>(null)

  useEffect(() => () => subRef.current?.unsubscribe(), [])

  async function handlePreview() {
    if (!youtubeUrl.trim()) {
      setError('請輸入 YouTube URL')
      return
    }
    setPreviewing(true)
    setError('')
    setCandidates([])
    setLyrics('')
    try {
      const res = await client.queries.preview({ youtubeUrl: youtubeUrl.trim() })
      if (res.errors && res.errors.length > 0) {
        throw new Error(res.errors[0].message)
      }
      const data = res.data
      if (data) {
        setTitle(data.title ?? '')
        setArtist(data.artist ?? '')
        setLyrics(data.lyrics ?? '')
        setCandidates((data.candidates ?? []) as Candidate[])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreviewing(false)
    }
  }

  async function handlePickCandidate(c: Candidate) {
    setPickingUrl(c.url)
    setError('')
    setTitle(c.title)
    setArtist(c.artist)
    try {
      const res = await client.queries.fetchLyrics({ url: c.url })
      if (res.errors && res.errors.length > 0) {
        throw new Error(res.errors[0].message)
      }
      setLyrics(res.data?.lyrics ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPickingUrl('')
    }
  }

  async function handleStart() {
    if (!youtubeUrl.trim()) {
      setError('請先輸入 YouTube URL')
      return
    }
    if (!lyrics.trim()) {
      setError('請先取得歌詞（或手動輸入）')
      return
    }
    setStarting(true)
    setError('')
    setJobId('')
    setStatus('')
    setProgressLog('')
    setLrcKey('')
    try {
      const res = await client.mutations.startJob({
        trackId: trackId.trim() || `manual-${Date.now()}`, 
        youtubeUrl: youtubeUrl.trim(),
        lyrics,
        title: title || undefined,
        artist: artist || undefined,
      })
      if (res.errors && res.errors.length > 0) {
        throw new Error(res.errors[0].message)
      }
      const job = res.data
      if (!job?.id) {
        throw new Error('startJob 未回傳 job id')
      }
      if (job.id) {
        setJobId(job.id)
        setStatus(job.status ?? '')
        setProgressLog(job.progressLog ?? '')
        setLrcKey(job.lrcKey ?? '')

        subRef.current?.unsubscribe()
        subRef.current = client.models.Job.onUpdate({
          filter: { id: { eq: job.id } },
        }).subscribe({
          next: (j) => {
            setStatus(j.status ?? '')
            setProgressLog(j.progressLog ?? '')
            setLrcKey(j.lrcKey ?? '')
          },
          error: (err) => console.error('subscription error', err),
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  async function handleDownload() {
    if (!lrcKey) return
    setDownloading(true)
    try {
      const res = await client.queries.getSignedLrcUrl({ key: lrcKey })
      if (res.errors && res.errors.length > 0) {
        throw new Error(res.errors[0].message)
      }
      const url = res.data?.url
      if (!url) {
        throw new Error('無法取得下載連結')
      }
      window.open(url, '_blank')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => {
    if (!jobId) return
    let stopped = false
    let interval: ReturnType<typeof setInterval> | undefined

    const poll = async () => {
      try {
        const res = await client.models.Job.get({ id: jobId })
        if (stopped) return
        const j = res.data
        if (j) {
          setStatus(j.status ?? '')
          setProgressLog(j.progressLog ?? '')
          setLrcKey(j.lrcKey ?? '')
          if ((j.status === 'DONE' || j.status === 'FAILED') && interval) {
            clearInterval(interval)
          }
        }
      } catch (e) {
        console.error('poll error', e)
      }
    }

    poll()
    interval = setInterval(poll, 2000)
    return () => {
      stopped = true
      if (interval) clearInterval(interval)
    }
  }, [jobId])

  const hasPreview = Boolean(title || artist || lyrics || candidates.length > 0)
  const isDone = status === 'DONE'

  return (
    <div className="app">
      <div className="app-header">
        <h1 style={{ margin: 0 }}>YT2LRC</h1>
        <button className="button" onClick={signOut}>登出</button>
      </div>
      <p className="app-subtitle">YouTube 影片 → 日文歌詞 LRC</p>

      <section className="section">
        <h2>1. 輸入</h2>
        <div className="field-label">YouTube URL</div>
        <input className="input" value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
        <div className="field-label">Track ID</div>
        <input className="input" value={trackId} onChange={(e) => setTrackId(e.target.value)} placeholder="歌曲識別碼（可自訂）" />
        <button className="button" onClick={handlePreview} disabled={previewing}>{previewing ? '查詢中...' : '預覽'}</button>
      </section>

      {hasPreview && (
        <section className="section">
          <h2>2. 確認歌詞</h2>
          <div className="field-label">歌名</div>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="field-label">歌手</div>
          <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} />
          <div className="field-label">歌詞（可編輯）</div>
          <textarea className="textarea" value={lyrics} onChange={(e) => setLyrics(e.target.value)} />

          {candidates.length > 0 && !lyrics.trim() && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ margin: '0 0 8px' }}>找不到自動配對的歌詞？從候選清單選一個：</p>
              {candidates.map((c) => (
                <button key={c.url} className="button button-block" onClick={() => handlePickCandidate(c)} disabled={pickingUrl === c.url}>
                  {c.title} — {c.artist}
                </button>
              ))}
            </div>
          )}

          <button className="button" onClick={handleStart} disabled={starting || !lyrics.trim()}>{starting ? '啟動中...' : '開始對齊'}</button>
        </section>
      )}

      {jobId && (
        <section className="section">
          <h2>3. 進度</h2>
          <p>狀態：{STATUS_LABELS[status] ?? status}</p>
          {progressLog && <pre className="log-box">{progressLog}</pre>}
          {isDone && lrcKey && (
            <button className="button" onClick={handleDownload} disabled={downloading}>{downloading ? '準備下載...' : '下載 .lrc 檔案'}</button>
          )}
          {status === 'FAILED' && <p className="error">處理失敗，請看上方進度記錄。</p>}
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}

export default App
