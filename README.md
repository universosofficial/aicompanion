# AI Companion & Digital Twins Backend API

A high-concurrency Node.js / Express backend powering conversational AI companions and interactive digital twin minds with real-time SSE streaming, voice notes, and episodic memory extraction.

---

## 🚀 Features

- **Real-Time SSE Streaming:** Low-latency token-by-token streaming with Socratic mentor pacing, client disconnect abort handling (`AbortController`), and 15s keep-alive heartbeats.
- **Episodic Memory & Time Anchors:** Automated background memory extraction mapping memories to conversation dates and time anchors.
- **Voice Notes & Speech Synthesis:** Speech-to-Text (STT via Whisper), Text-to-Speech (TTS via ElevenLabs / OpenAI), and instant voice cloning.
- **Cloud Media Offloading:** Persistent audio uploads offloaded to Cloudinary CDN with local disk fallback.
- **High Concurrency & Database Scaling:** MySQL 8 connection pooling (`maxIdle`, `idleTimeout`, `queueLimit`) and composite indexing across message history and consultation tables.
- **Security & DDoS Protection:** Rate limiting (global, auth, AI turns), Helmet headers, and gzip compression.

---

## 🛠️ Tech Stack

- **Runtime:** Node.js (v20+ / ES Modules)
- **Framework:** Express.js
- **Database:** MySQL 8 (`mysql2/promise`)
- **AI Services:** OpenAI API (GPT-4o / GPT-4o-mini, Whisper)
- **Voice Synthesis:** ElevenLabs API & OpenAI TTS
- **Media CDN:** Cloudinary

---

## 📦 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

Ensure the following core variables are configured:
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (or `DATABASE_URL` for cloud providers like Aiven / TiDB)
- `OPENAI_API_KEY`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (optional for voice note CDN)
- `ELEVENLABS_API_KEY` (optional for custom voice cloning)

### 3. Run Database Migrations
Run the automated migration runner to apply all 13 database migrations:
```bash
npm run migrate
```

### 4. Start the Server
```bash
npm start
```
The server will start on `http://localhost:5005` (or your configured `PORT`).

---

## 🩺 Health Check
```http
GET /api/health
```
Returns system uptime, database latency, and memory footprint.
