# Agent Coordination Strategy

## Agents
- **Codex** (primary implementer): Creates tasks, writes code, runs tests
- **Claude** (reviewer/fixer): Reviews code, finds bugs, writes fixes

## Branch Strategy
```
main                    <- protected, only merged PRs
  |
  +-- codex/epic-XX    <- Codex works here (one branch per epic)
  |
  +-- claude/fix-XX      <- Claude works here (one branch per fix)
```

## Rules
1. **Never push directly to main** - always via PR
2. **Codex branches**: `codex/epic-{number}-{short-name}`
3. **Claude branches**: `claude/fix-{number}-{short-name}`
4. **File locking**: Each agent works on separate files/directories per epic
5. **bd task ownership**: Tasks are assigned via `bd update --actor` field
6. **Merge order**: Codex merges first, Claude rebases on top

## Conflict Prevention
- Codex works top-down (infrastructure -> core -> features)
- Claude works on completed epics only (reviews already-merged code)
- If both need same file: Claude waits for Codex's PR to merge first
- Use bd labels: `agent:codex`, `agent:claude`

## Communication
- bd comments on tasks for status updates
- PR descriptions explain what changed and why
- Test results posted as PR comments

## Test Responsibility
- Codex: writes unit tests alongside implementation
- Claude: writes additional edge-case tests, finds missing coverage
- CI: runs all tests on every PR

## Epic Workflow
1. Codex creates epic + child tasks in bd
2. Codex implements on `codex/epic-XX` branch
3. Codex opens PR when epic is complete
4. CI runs all tests
5. Claude reviews PR, creates `claude/fix-XX` for any issues
6. Both PRs merge to main
7. Next epic starts
