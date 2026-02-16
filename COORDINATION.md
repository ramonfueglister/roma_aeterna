# Agent Coordination Strategy

## Agents
- **Codex** (primary implementer): Writes code, implements features, writes unit tests
- **Claude** (architect/reviewer/committer): Creates bd tasks, reviews code, manages PRs/merges, writes fixes, maintains quality

## Responsibilities

### Claude (this agent)
- Create and manage all `bd` epic/task hierarchy
- Review Codex's code for bugs, quality, security
- Create PRs, merge to main, manage branches
- Write fixes on `claude/fix-XX` branches
- Write additional edge-case tests, find missing coverage
- Maintain CI/CD, test infrastructure, project config
- Enforce architectural decisions from specs

### Codex
- Implement features on `codex/epic-XX` branches
- Write unit tests alongside implementation
- Follow task assignments from bd
- Push branches for Claude to review

## Branch Strategy
```
main                    <- protected, only merged PRs
  |
  +-- codex/epic-XX    <- Codex works here (one branch per epic)
  |
  +-- claude/fix-XX    <- Claude works here (one branch per fix)
```

## Rules
1. **Never push directly to main** - always via PR
2. **Codex branches**: `codex/epic-{number}-{short-name}`
3. **Claude branches**: `claude/fix-{number}-{short-name}`
4. **File locking**: Each agent works on separate files/directories per epic
5. **bd task ownership**: Tasks labeled `agent:codex` or `agent:claude`
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
1. Claude creates epic + child tasks in bd (labeled `agent:codex`)
2. Codex implements on `codex/epic-XX` branch
3. Codex pushes branch when epic is complete
4. Claude creates PR, reviews code
5. CI runs all tests
6. Claude creates `claude/fix-XX` for any issues found
7. Claude merges PR to main
8. Next epic starts

## Current Epic Status

| Epic | Name | bd Tasks | Status |
|------|------|----------|--------|
| 01 | Foundation & TypeScript Infrastructure | ~100 | Merged to main |
| 02 | Database Schema & Supabase Backend | ~120 | Tasks created |
| 03 | Python Data Pipeline | ~100 | Tasks created |
| 04 | Binary Chunk System | 79 | Tasks created |
| 05 | Core Rendering Engine | ~100 | Tasks pending |
| 06 | Web Workers & Mesh Generation | ~80 | Tasks created |
| 07 | Camera & Controls | 79 | Tasks created |
| 08 | Water Rendering | 58 | Tasks created |
| 09 | LOD System | ~60 | Tasks pending |
| 10 | Province System | ~70 | Tasks pending |
| 11 | City System | ~100 | Tasks created |
| 12 | Resource & Trade System | ~90 | Tasks created |
| 13 | AI Agent System | 89 | Tasks created |
| 14 | Ambient Life & Animation | ~70 | Tasks pending |
| 15 | Post-Processing & Visual Quality | ~80 | Tasks pending |
| 16 | UI/HUD System | ~80 | Tasks created |
| 17 | Multiplayer & Realtime | ~70 | Tasks created |
| 18 | Performance Optimization | 82 | Tasks created |
| 19 | Mobile & Responsive | 54 | Tasks created |
| 20 | Rust Simulation Service | ~90 | Tasks pending |
