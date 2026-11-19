# HAVEN

Offline-First Community Resilience and Disaster Resource Coordination.

## Overview
HAVEN coordinates emergency requests, limited resources,
allocation approvals, and verifiable resource distribution.

## Technology
- Frontend: React, TypeScript, Vite
- Offline storage: Dexie.js and IndexedDB
- PWA: vite-plugin-pwa
- Backend: Python, FastAPI, SQLModel
- Database: SQLite
- Optimization: Google OR-Tools

## Architecture
React frontend communicates with FastAPI REST endpoints.
FastAPI manages SQLite records and OR-Tools allocation logic.
Receipt verification and collection use token-based workflows.

## Local Setup
Backend:
1. cd backend
2. python3 -m venv .venv
3. source .venv/bin/activate
4. pip install -r requirements.txt
5. python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

Frontend (second terminal):
1. cd frontend
2. npm ci
3. npm run dev

## Demonstration
1. Submit an emergency resource request.
2. Review inventory and allocations.
3. Approve an allocation and issue a receipt.
4. Verify the receipt at the distribution station.
5. Confirm collection and demonstrate duplicate protection.

## Security
Intended for controlled localhost demonstration.
Volunteer authentication is required before public deployment.
Do not commit SQLite databases, tokens, or credentials.

## Hackathon
Solo project. Demo video link to be added.
