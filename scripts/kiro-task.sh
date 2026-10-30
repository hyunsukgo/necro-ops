#!/usr/bin/env bash
# Run ONE task from tasks.md with Kiro CLI (headless).
# Usage: scripts/kiro-task.sh 2.4
set -euo pipefail

TASK_ID="${1:?usage: $0 <task-id>   e.g. 2.4}"
TASKS=".kiro/specs/necro-ops-mvp/tasks.md"
LOG_DIR=".kiro/logs"
mkdir -p "$LOG_DIR"

# Already done? skip.
if grep -Eq "^\s*- \[x\] ${TASK_ID//./\\.}\. " "$TASKS"; then
  echo "✔ task $TASK_ID already checked — skipping"; exit 0
fi

# Require a clean tree so each task is one reviewable commit.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "✖ working tree not clean — commit or stash first"; exit 1
fi

PROMPT=$(cat <<EOF
Implement task ${TASK_ID} from ${TASKS}.
1. Read the task line, its "_Requirements:_" ids, and the matching sections of requirements.md and design.md.
2. Implement only what task ${TASK_ID} needs.
3. Add/update tests and run: pnpm test (and pnpm lint if configured). Fix failures.
4. Mark task ${TASK_ID} as [x] in tasks.md when done.
5. Print a summary of changed files and test results.
EOF
)

echo "▶ running task $TASK_ID"
printf '%s\n' "$PROMPT" | kiro-cli chat \
  --no-interactive \
  --agent necro-builder \
  --trust-all-tools \
  2>&1 | tee "$LOG_DIR/task-${TASK_ID}.log"

# Commit only if the task got checked off.
if grep -Eq "^\s*- \[x\] ${TASK_ID//./\\.}\. " "$TASKS"; then
  git add -A
  git commit -m "feat: task ${TASK_ID} (Kiro CLI)" >/dev/null
  echo "✔ task $TASK_ID done and committed"
else
  echo "⚠ task $TASK_ID not marked complete — review $LOG_DIR/task-${TASK_ID}.log"
  exit 2
fi
