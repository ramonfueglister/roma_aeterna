# Agent Coordination Strategy

## Agents
- **Claude** (primary implementer): Creates tasks, writes code, runs tests
- **Codex** (reviewer/fixer): Reviews code, finds bugs, writes fixes

## Branch Strategy
```
main                    <- protected, only merged PRs
  |
  +-- claude/epic-XX    <- Claude works here (one branch per epic)
  |
  +-- codex/fix-XX      <- Codex works here (one branch per fix)
```

## Rules
1. **Never push directly to main** - always via PR
2. **Claude branches**: `claude/epic-{number}-{short-name}`
3. **Codex branches**: `codex/fix-{number}-{short-name}`
4. **File locking**: Each agent works on separate files/directories per epic
5. **bd task ownership**: Tasks are assigned via `bd update --actor` field
6. **Merge order**: Claude merges first, Codex rebases on top

## Conflict Prevention
- Claude works top-down (infrastructure -> core -> features)
- Codex works on completed epics only (reviews already-merged code)
- If both need same file: Codex waits for Claude's PR to merge first
- Use bd labels: `agent:claude`, `agent:codex`

## Communication
- bd comments on tasks for status updates
- PR descriptions explain what changed and why
- Test results posted as PR comments

## Test Responsibility
- Claude: writes unit tests alongside implementation
- Codex: writes additional edge-case tests, finds missing coverage
- CI: runs all tests on every PR

## Epic Workflow
1. Claude creates epic + child tasks in bd
2. Claude implements on `claude/epic-XX` branch
3. Claude opens PR when epic is complete
4. CI runs all tests
5. Codex reviews PR, creates `codex/fix-XX` for any issues
6. Both PRs merge to main
7. Next epic starts
