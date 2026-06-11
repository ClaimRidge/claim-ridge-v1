# ClaimRidge — AI Insurance Compliance Layer

ClaimRidge is an AI-powered insurance compliance platform that ensures medical claims meet each payer's exact requirements before submission. By reducing claim denials for providers and manual review costs for insurers, ClaimRidge serves as the critical compliance bridge in the healthcare payment ecosystem.

**Current Focus:** MENA region (Jordan, UAE, KSA) | **Status:** Pre-revenue prototype

---

## 🎯 Core Value Proposition

- **For Providers (Hospitals):** Fewer claim rejections, faster reimbursement, reduced manual rework
- **For Insurers:** Cleaner submissions, lower manual review overhead, automated compliance validation
- **For TPAs:** AI-driven claim routing and adjudication

---

## 🔑 Key Features

### Claims Compliance Validation
- Upload medical claims (CMS-1500, proprietary formats)
- AI-powered analysis against payer-specific rules
- Real-time compliance checking with error flags
- Actionable recommendations for claim correction

### Multi-User Portal
- **Provider Dashboard:** Claim submission, history, analytics
- **Insurer Portal:** Claims review, fraud detection, rule management
- **Admin Panel:** System configuration, user management

### Payer-Specific Rules Engine
- Configurable compliance rules per payer
- Dynamic rule updates for regulatory changes
- Support for complex conditional logic

### Analytics & Reporting
- Denial rate tracking
- Compliance score metrics
- Batch processing analytics

---

## 🚀 Running the Project

The repo is a monorepo with two apps that run independently and meet over HTTP + a shared Supabase database:

- `backend/` — FastAPI + Supabase + ML (port **8000**)
- `frontend/` — Next.js 14 App Router (port **3000**)

### Prerequisites

- Python 3.10+ and Node.js 18+
- A Supabase project (URL, service-role key, anon key)
- LLM API keys: Groq, Gemini (and optionally OpenRouter)

### 1. Database setup (first run only)

The schema reference lives in `backend/database.sql` (context only — not a migration). On a fresh Supabase project, run the SQL files in `backend/migrations/` in **numeric order** via the Supabase SQL editor.

### 2. Environment variables

**`backend/.env`:**

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role key — never the anon key>

GROQ_API_KEY=<key>
GEMINI_API_KEY=<key>
OPENROUTER_API_KEY=<key>               # optional (OCR via OpenRouter)

LLM_MODEL=llama-3.3-70b-versatile      # optional, default shown
OCR_MODEL=baidu/qianfan-ocr-fast:free  # optional, default shown
```

**`frontend/.env.local`:**

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

### 3. Launch the backend

From the repo root (PowerShell):

```powershell
# Create + activate a virtual environment (first run only)
python -m venv .venv
.\.venv\Scripts\Activate.ps1

cd backend
pip install -r requirements.txt   # first run only

# Start the API on http://localhost:8000
uvicorn main:app --reload
```

> ⚠️ Always start uvicorn with `backend/` as the working directory — the fraud-model files in `backend/models/` resolve relative to the CWD and silently fail to load otherwise.

### 4. Launch the frontend

In a second terminal:

```powershell
cd frontend
npm install        # first run only
npm run dev        # dev server on http://localhost:3000
```

Other scripts: `npm run build`, `npm run start` (production), `npm run lint`.

### 5. Open the app

- Frontend: <http://localhost:3000>
- Backend API docs (Swagger): <http://localhost:8000/docs>

Doctors sign up directly and join an organisation by org code; provider/insurer organisations apply via the signup form and wait for admin approval before their account is created.

There is currently no test suite in either app. See `CLAUDE.md` for the full architecture walkthrough.

---

## 🚦 Development Guidelines

### Code Style
- ✅ Always use TypeScript (frontend) and type hints (backend)
- ✅ Use async/await (never .then())
- ✅ Keep components small and single responsibility
- ✅ Always handle loading and error states
- ✅ Mobile responsive design always
  
