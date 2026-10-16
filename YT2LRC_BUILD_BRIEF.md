# YT2LRC — Build Brief (hand this to a coding agent)

> Goal: rebuild the "YouTube → LRC lyrics" tool from scratch as an **AWS Amplify Gen 2
> full-stack app** (Vite + React frontend, Amplify Gen 2 backend), starting from a fresh
> repo instead of porting the old FastAPI project.

---

## 1. What the app does (the pipeline)

Given a YouTube URL and a track id, the app must:

1. **Preview** — fetch video title/artist, look up official metadata (iTunes Search API),
   and scrape matching Japanese lyrics (uta-net) so the user can confirm or edit them.
2. **Align** — run an AI pipeline that:
   a. downloads the audio (`yt-dlp`) and converts to WAV (`ffmpeg`),
   b. isolates vocals (`demucs`),
   c. word-aligns the lyrics (`stable-whisper`, `small` model, language `ja`),
   d. writes a timestamped `.lrc` file.
3. **Return** — store the `.lrc` in S3 and record the result in a database, showing
   real-time progress in the UI.

> ⚠️ Steps 2a–2c use PyTorch/Demucs/Whisper (multi-GB, minutes-long, no GPU needed but
> slow on CPU). These **cannot run in AWS Lambda** (15-min timeout, no GPU, size limits).
> They must run in a **Docker container on Amazon ECS (Fargate)**. Everything else can be
> Amplify Gen 2 (Lambda Functions + DynamoDB + S3 + Cognito).

---

## 2. Target architecture

```
Browser (Vite + React)
   │  Amplify Hosting (static + CDN)
   ▼
Amplify Gen 2 backend
   ├─ auth      (Cognito user pool)             — login, per-user data isolation
   ├─ data      (DynamoDB via AppSync)          — Job records + realtime subscriptions
   ├─ storage   (S3 bucket)                     — generated .lrc files
   └─ functions (Lambda, Node.js 20):
        • preview   → iTunes + uta-net + YouTube metadata lookup
        • startJob  → writes Job(status=QUEUED), pushes message to SQS
        • (optional) getSignedUrl / cleanup
   │
   ▼
SQS queue  ──►  ECS Fargate task (Docker, Python)
                    yt-dlp → ffmpeg → demucs → stable-whisper → .lrc
                    → upload .lrc to S3 → update Job(status, lrcKey, progressLog)
```

**Real-time progress:** replace the old SSE stream with Amplify Data **subscriptions**
(`client.models.Job.onUpdate({...}).subscribe(...)`). The ECS worker appends to a
`progressLog` field and flips `status`; the UI updates live.

---

## 3. Prerequisites (tell the agent to verify/install)

- Node.js 18+ (LTS 20 recommended), npm
- AWS account + AWS credentials configured: `npx ampx configure` (profile `default`)
- GitHub repo (for Amplify Hosting CI/CD)
- A `package.json` script runner (comes with the Vite scaffold)

---

## 4. Scaffold commands (exact, in order)

```bash
# 1. Create the React app (TypeScript recommended)
npm create vite@latest YT2LRC -- --template react-ts
cd YT2LRC

# 2. Add Amplify Gen 2 (generates amplify/ folder + deps)
npm create amplify@latest

# 3. Install Amplify frontend libraries + UI kit
npm install aws-amplify @aws-amplify/ui-react

# 4. (dev) run the cloud sandbox in a separate terminal, then npm run dev
npx ampx sandbox
npm run dev
```

Generated structure to expect:

```
YT2LRC/
├── amplify/
│   ├── auth/resource.ts       # Cognito
│   ├── data/resource.ts       # DynamoDB schema
│   ├── storage/resource.ts    # S3 (add this)
│   ├── functions/             # Lambda handlers (add these)
│   ├── backend.ts             # defineBackend wiring
│   └── tsconfig.json
├── src/
│   ├── App.tsx / main.tsx
│   └── ...
├── amplify_outputs.json       # auto-generated (gitignore it)
└── package.json
```

---

## 5. Backend design (Amplify Gen 2)

### 5.1 Data model — `amplify/data/resource.ts`

```ts
import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  Job: a.model({
    trackId:    a.string().required(),
    youtubeUrl: a.string().required(),
    title:      a.string(),
    artist:     a.string(),
    lyrics:     a.string(),
    status:     a.enum(['QUEUED','DOWNLOADING','SEPARATING','ALIGNING','DONE','FAILED']),
    progressLog:a.string(),   // newline-joined log lines
    lrcKey:     a.string(),   // S3 object key of the .lrc
    owner:      a.string(),
  }).authorization(allow => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;
export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
```

### 5.2 Storage — `amplify/storage/resource.ts`

```ts
import { defineStorage } from '@aws-amplify/backend';
export const storage = defineStorage({
  name: 'yt2lrcLrcStorage',
  access: allow => ({
    'lrc/*': [allow.authenticated.to(['read','write'])],
  }),
});
```

### 5.3 Functions (Node.js 20, TS)

Create `amplify/functions/<name>/resource.ts` with `defineFunction({ entry: './handler.ts', runtime: 20 })`
and a matching `handler.ts` exporting `export const handler = async (event) => {...}`.

- **preview**: receives `{ youtubeUrl }`, returns `{ title, artist, lyrics, candidates[] }`.
  Port the old logic to TS:
  - YouTube title/artist: `yt-dlp` is Python; in the Function use a lightweight approach
    (e.g. YouTube oEmbed `https://www.youtube.com/oembed?url=...&format=json` for the title,
    or call the same iTunes API). iTunes lookup:
    `https://itunes.apple.com/search?term=...&entity=song&limit=1&country=jp&lang=ja_jp`.
  - uta-net scrape: fetch `https://www.uta-net.com/search/?Keyword=...` and the song page,
    parse with `cheerio`; return `[ {title, artist, url} ]`. **Must run server-side**
    (uta-net blocks browser CORS).
- **startJob**: receives `{ trackId, youtubeUrl, lyrics, title, artist }`; creates the
  `Job` record (status `QUEUED`) via the data client and sends an SQS message
  `{ jobId, youtubeUrl, lyrics, trackId }`.
- **getSignedLrcUrl** (optional): generates a pre-signed S3 URL for the `.lrc` key.

### 5.4 Wire it together — `amplify/backend.ts`

```ts
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { preview } from './functions/preview/resource';
import { startJob } from './functions/startJob/resource';

const backend = defineBackend({ auth, data, storage, preview, startJob });

// Grant the functions access to Data + Storage
backend.preview.resources.lambda.addToRolePolicy(/* data:*, s3:* on lrc bucket */);
backend.startJob.resources.lambda.addToRolePolicy(/* data:* + sqs:SendMessage */);
```


---

## 6. The ML worker (Docker container on ECS Fargate) — the only non-Amplify part

Create a sibling folder `worker/` (Python) that **reuses the old pipeline logic**
(`auto_pipeline.py` + `aligner.py` + the 4-step function from the old `main.py`):

- `worker/requirements.txt`: `yt-dlp`, `demucs`, `stable-whisper`, `openai-whisper`,
  `torch`, `torchaudio`, `boto3`, `requests`, `beautifulsoup4`, `numpy`.
- `worker/worker.py`: entrypoint that
  1. polls SQS for a message (or is invoked per-job),
  2. runs yt-dlp → ffmpeg → demucs → stable-whisper,
  3. uploads the `.lrc` to S3 (`lrc/<jobId>.lrc`),
  4. updates DynamoDB `Job` (`status`, `progressLog`, `lrcKey`) — use `boto3` + a small
     DynamoDB update helper.
- `worker/Dockerfile` (key points):
  ```dockerfile
  FROM python:3.11-slim
  RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
  WORKDIR /app
  COPY requirements.txt .
  RUN pip install --no-cache-dir -r requirements.txt
  COPY . .
  CMD ["python", "worker.py"]
  ```
- ⚠️ Replace the old **Windows** `ffmpeg.exe`/`ffprobe.exe` with Linux `ffmpeg`
  (installed via apt, as above). `yt-dlp` and `demucs` both shell out to `ffmpeg`.

**Deploy the worker:** push the image to Amazon ECR, then create an ECS Fargate task
(CPU is fine to start; add GPU via EC2-backed ECS or AWS Batch later for speed). Trigger
it from SQS (queue → task). Provision SQS + ECS through an Amplify **custom CDK stack**
using `backend.createStack('worker')` and `aws-cdk-lib` `aws_sqs`, `aws_ecs`, `aws_ecr`
constructs — see the Amplify "Custom resources" docs (CDK escape hatch).


---

## 7. Frontend design (Vite + React + TypeScript)

- `src/main.tsx`: `Amplify.configure(outputs)` with `import outputs from '../amplify_outputs.json'`.
- Wrap the app in `<Authenticator>` from `@aws-amplify/ui-react` (and import
  `@aws-amplify/ui-react/styles.css`).
- `src/App.tsx` — three steps mirroring the old UI:
  1. Input YouTube URL + track id → call `preview` → show title/artist/lyrics (editable),
     with a candidate list from uta-net if no lyrics found.
  2. "Start alignment" → call `startJob` → subscribe to
     `client.models.Job.onUpdate({ filter: { id: { eq: jobId } } }).subscribe(...)` and
     render the `progressLog` + status (progress bar).
  3. On `DONE`, fetch `lrcKey` and show a download button (pre-signed S3 URL).
- `generateClient`: `import { generateClient } from 'aws-amplify/data'` +
  `import { type Schema } from '../amplify/data/resource'` → `const client = generateClient<Schema>()`.
- **Do not hardcode `http://localhost:8000`** — use the Amplify client / env var for the
  API base. Dev: `npx ampx sandbox` regenerates `amplify_outputs.json` automatically.

---

## 8. Environment variables & secrets

- **No MongoDB** — replaced by DynamoDB (no `MONGO_URI` secret needed).
- Any future secrets (API keys) go in **AWS Secrets Manager / SSM**, referenced via
  `secret()` in Amplify — never committed.
- `.gitignore` must include: `amplify_outputs.json`, `.env*`, `node_modules`, `dist`.

---

## 9. Deploy

```bash
# local dev
npx ampx sandbox     # separate terminal
npm run dev

# production (CI/CD via Amplify Hosting)
git add -A && git commit -m "yt2lrc: initial Amplify Gen 2 app"
git push
# In Amplify console: Hosting → connect GitHub repo + branch → build:
#   build command:  npm run build
#   output dir:     dist
# then CI/CD deploys on push via `npx ampx pipeline-deploy --branch main --app-id <appId>`
```

---

## 10. Definition of done (acceptance criteria)

- [ ] `npm run dev` + `npx ampx sandbox` runs locally; login/signup works.
- [ ] Enter a YouTube URL → preview returns title/artist/lyrics (or candidate list).
- [ ] Start alignment → UI shows live progress (subscription), no SSE.
- [ ] Worker container produces a valid `.lrc` with timestamps, stores it in S3.
- [ ] Job shows `DONE` and provides a working `.lrc` download link.
- [ ] `git push` deploys frontend + backend to Amplify Hosting automatically.
- [ ] No secrets committed; `amplify_outputs.json` gitignored.

---

## 11. Key gotchas to tell the agent

1. **ffmpeg must be Linux** in the container (the old repo has Windows `.exe`s — don't copy them).
2. **Lambda ≠ ML runtime** — Demucs/Whisper go in ECS/Fargate, not Lambda.
3. **uta-net scraping is server-side** (CORS) — put it in the `preview` Function, not the browser.
4. **SSE is gone** — use Amplify Data subscriptions for real-time progress.
5. **Per-user isolation** — use `allow.owner()` so one user's jobs aren't visible to others.
6. **`amplify_outputs.json` is env-specific** — regenerate via `npx ampx sandbox`; don't commit.

