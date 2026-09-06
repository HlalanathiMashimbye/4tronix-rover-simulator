# Admin Migration Endpoints

## POST /api/admin/migrate-challenges-to-leaderboard

**Purpose:** Syncs all existing challenge completions to the leaderboard.

This endpoint creates leaderboard entries for learners who completed challenges before the leaderboard feature was implemented. It calculates their scores retroactively based on challenge point values and marks them as opted-in.

**When to Run:**

- After deploying the leaderboard feature
- Once to backfill all historical challenge data
- Safe to run multiple times (idempotent)

**What It Does:**

1. Queries all learner documents in Firestore
2. For each learner with challenge completions:
   - Hashes their learner ID for privacy
   - Calculates total score from all completed challenges
   - Creates a leaderboard entry (or updates if exists)
   - Generates a random nickname
   - Marks them as opted-in (they earned their score)

**Request:**

```bash
curl -X POST http://localhost:3000/api/admin/migrate-challenges-to-leaderboard \
  -H "Content-Type: application/json"
```

**Response:**

```json
{
  "success": true,
  "message": "Migration complete: 150 processed, 142 created, 8 updated, 0 skipped",
  "stats": {
    "processed": 150,
    "created": 142,
    "updated": 8,
    "skipped": 0,
    "errors": []
  }
}
```

**Key Features:**

- ✅ **Idempotent** — Running twice won't duplicate entries
- ✅ **Non-blocking** — Reports progress, logs each step
- ✅ **Privacy-first** — Uses hashed learner IDs, generates random nicknames
- ✅ **Point-accurate** — Scores calculated from exact challenge definitions
- ✅ **Opt-in compliant** — Marks migrated learners as opted-in (they earned it)

**Error Handling:**

- Individual learner errors are logged and collected
- Migration continues even if one learner fails
- Full error list returned in response

**Database State After:**

- All learners with challenge completions have leaderboard entries
- Their scores reflect all completed challenges (e.g., 3 challenges × points each)
- They appear on the public leaderboard (opted-in: true)
- Their challenge count matches their actual progress
