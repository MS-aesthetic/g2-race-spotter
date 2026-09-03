#!/usr/bin/env bash
# Ralph loop for the G2 Race Spotter repo.
#
#   ralph/loop.sh                 # build → review → replan, repeat until DONE/STOP/MAX_ITERATIONS
#   ralph/loop.sh plan            # one-off: (re)generate IMPLEMENTATION_PLAN.md from specs (clears ralph/DONE)
#   ralph/loop.sh once            # exactly one build → review → replan cycle
#   RUNNER=codex ralph/loop.sh    # drive Codex CLI instead of Claude Code
#
# Each stage is a fresh CLI process with a fresh context. State lives on disk:
# specs/ (truth), IMPLEMENTATION_PLAN.md (disposable), ralph/PROGRESS.md (history, committed),
# ralph/last-build.md / last-review.md (hand-off between stages, git-ignored, cleared every iteration).
#
# Run from a local clone (not the OneDrive-synced folder) on Git Bash, WSL, macOS (bash 3.2 ok) or Linux.
# Before the first run read "Verify before first run" in ralph/README.md.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

# ---------- config ----------
_runner_override=${RUNNER:-}
set -a; . "$ROOT/ralph/models.env"; set +a
RUNNER=${_runner_override:-${RUNNER:-claude}}
UNATTENDED=${RALPH_UNATTENDED:-1}          # 1 = no permission prompts (run in a sandbox/VM); 0 = Claude asks
CLAUDE_USE_AGENT=${RALPH_CLAUDE_USE_AGENT:-1}  # 1 = `claude --agent <role>`; 0 = prepend the role file to the prompt instead
mkdir -p "$ROOT/ralph/logs"

log() { printf '\033[1;36m[ralph %s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '\033[1;31m[ralph]\033[0m %s\n' "$*" >&2; exit 1; }
upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

command -v git >/dev/null || die "git not found"
command -v "$RUNNER" >/dev/null || die "$RUNNER CLI not found on PATH"
[ -n "$(git status --porcelain)" ] && log "warning: working tree is dirty; the worker's 'git add -A' will commit these changes too"

tier_var()    { local v; v="$(upper "$RUNNER")_$(upper "$1")_$2"; printf '%s' "${!v:-}"; }
tier_model()  { tier_var "$1" MODEL; }
tier_effort() { tier_var "$1" EFFORT; }

# iteration number = last row in PROGRESS.md + 1 (survives clones and Claude↔Codex hand-offs)
iteration() { local last; last=$(grep -E '^\| *[0-9]+ *\|' "$ROOT/ralph/PROGRESS.md" 2>/dev/null | tail -1 | awk -F'|' '{print $2+0}'); echo $(( ${last:-0} + 1 )); }

# ---------- run one stage ----------
# run_stage <stage> <tier> <role> <prompt-file> <max-turns>
run_stage() {
  local stage=$1 tier=$2 role=$3 prompt=$4 turns=$5
  local n; n=$(iteration)
  local logf="$ROOT/ralph/logs/$(printf '%04d' "$n")-$(date +%Y%m%d-%H%M%S)-$stage.log"
  local model effort; model=$(tier_model "$tier"); effort=$(tier_effort "$tier")
  [ -n "$model" ] || die "no model configured for RUNNER=$RUNNER tier=$tier (see ralph/models.env)"
  log "$stage: role=$role tier=$tier runner=$RUNNER model=$model effort=$effort"

  if [ "$RUNNER" = claude ]; then
    local perm=(--permission-mode acceptEdits); [ "$UNATTENDED" = 1 ] && perm=(--dangerously-skip-permissions)
    if [ "$CLAUDE_USE_AGENT" = 1 ]; then
      # .claude/agents/<role>.md (generated from agents/roles + models.env) carries model/effort/skills.
      cat "$prompt" | claude -p --agent "$role" --max-turns "$turns" "${perm[@]}" --output-format text 2>&1 | tee "$logf"
    else
      cat "$ROOT/agents/roles/$role.md" "$prompt" | claude -p --model "$model" --effort "$effort" --max-turns "$turns" "${perm[@]}" --output-format text 2>&1 | tee "$logf"
    fi
    return "${PIPESTATUS[1]}"
  fi

  # codex: role file + prompt on stdin; effort via config override; retry at high if the model rejects xhigh
  local rc eff=$effort
  while :; do
    cat "$ROOT/agents/roles/$role.md" "$prompt" | NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-${TMPDIR:-/tmp}/g2-race-spotter-npm-cache}" \
      codex --approve-for-me exec --model "$model" -c "model_reasoning_effort=\"$eff\"" \
      -c 'sandbox_workspace_write.network_access=true' --sandbox workspace-write \
      -o "$ROOT/ralph/.last-message.md" - 2>&1 | tee "$logf"
    rc=${PIPESTATUS[1]}
    if [ "$rc" -ne 0 ] && [ "$eff" = xhigh ] && grep -qi 'reasoning' "$logf"; then log "$stage: model rejected xhigh, retrying with high"; eff=high; continue; fi
    return "$rc"
  done
}

# ---------- helpers ----------
next_owner() {   # owner of the first unchecked task under "## Next"
  awk '/^## Next/{f=1;next} /^## /{f=0} f && /^- \[ \]/{ if (match($0,/owner: *[a-z0-9-]+/)) { s=substr($0,RSTART+6,RLENGTH-6); gsub(/ /,"",s); print s; exit } }' IMPLEMENTATION_PLAN.md
}
next_is_hw() { awk '/^## Next/{f=1;next} /^## /{f=0} f && /^- \[ \]/{ print ($0 ~ /\) *\[HW\]( |$)/) ? "yes" : "no"; exit }' IMPLEMENTATION_PLAN.md; }
plan_status() { sed -n 's/^Status: *//p' IMPLEMENTATION_PLAN.md | head -1 | tr -d '\r '; }
reviewer_for_last_commit() {
  if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -Eq '^(packages/protocol/|services/relay/src/)|client\.ts$'; then echo protocol-keeper; else echo hud-qa; fi
}
build_outcome() { sed -n 's/^outcome: *//p' ralph/last-build.md 2>/dev/null | head -1 | tr -d '\r' | awk '{print $1}'; }
stash_leftovers() {   # only the planner commits after this point; nothing a failed worker or a reviewer left behind may leak into its commit
  if [ -n "$(git status --porcelain)" ]; then
    log "$1 stage left uncommitted changes — stashing them (see: git stash list)"; git stash push -u -q -m "ralph: $1 leftovers, iteration $(iteration)"
  fi
}

# ---------- modes ----------
mode=${1:-loop}
case "$mode" in
  plan)  rm -f ralph/DONE; run_stage plan planner plan-updater ralph/PROMPT_plan.md "$MAX_TURNS_PLAN"; exit $? ;;
  loop|once) ;;
  *) die "usage: ralph/loop.sh [loop|once|plan]" ;;
esac

[ -f IMPLEMENTATION_PLAN.md ] || { log "no plan yet — running bootstrap plan first"; run_stage plan planner plan-updater ralph/PROMPT_plan.md "$MAX_TURNS_PLAN" || die "bootstrap plan failed"; }

idle=0; runs=0
while :; do
  n=$(iteration); runs=$((runs+1))
  [ -f ralph/STOP ] && { log "ralph/STOP present — stopping (delete it to resume)"; break; }
  [ -f ralph/DONE ] && { log "ralph/DONE present — all specs met or waiting on human; run 'ralph/loop.sh plan' after doing [HW] items"; break; }
  [ "$runs" -gt "$MAX_ITERATIONS" ] && { log "MAX_ITERATIONS=$MAX_ITERATIONS cycles in this invocation — stopping"; break; }
  [ "$runs" -gt 1 ] && [ "$n" = "$prev_n" ] && log "warning: PROGRESS.md gained no row last cycle (planner failed?) — iteration number stuck at $n"; prev_n=$n
  st=$(plan_status); if [ "$st" = DONE ] || [ "$st" = BLOCKED ]; then log "plan status $st — stopping"; break; fi
  rm -f ralph/last-build.md ralph/last-review.md   # never let a stale hand-off drive a stage

  owner=$(next_owner)
  if [ -z "$owner" ] || [ "$(next_is_hw)" = yes ] || [ "$owner" = maxx ]; then
    log "iteration $n: next task needs a human or plan is empty — replanning"
    run_stage replan planner plan-updater ralph/PROMPT_replan.md "$MAX_TURNS_PLAN"
    idle=$((idle+1))
    if [ "$mode" = once ] || [ "$idle" -ge 2 ]; then log "nothing a worker can do; see '## Needs human' in IMPLEMENTATION_PLAN.md"; break; fi
    continue
  fi
  idle=0

  log "===== iteration $n: task owner $owner ====="
  run_stage build worker "$owner" ralph/PROMPT_build.md "$MAX_TURNS_BUILD" || log "build stage exited non-zero (continuing to review/replan)"

  case "$(build_outcome)" in
    done*) run_stage review reviewer "$(reviewer_for_last_commit)" ralph/PROMPT_review.md "$MAX_TURNS_REVIEW" || log "review stage exited non-zero"
           stash_leftovers review ;;
    *)     log "build outcome '$(build_outcome)' (empty = worker wrote no hand-off) — skipping review"; stash_leftovers build
           printf 'task: -\nverdict: n/a\n' > ralph/last-review.md ;;
  esac

  run_stage replan planner plan-updater ralph/PROMPT_replan.md "$MAX_TURNS_PLAN" || log "replan stage exited non-zero"

  [ "$mode" = once ] && break
done
log "loop finished. Plan status: $(plan_status)"
