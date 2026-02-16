.PHONY: dev build data chunks clean help supabase-start supabase-stop supabase-migrate supabase-seed functions sim-service seed test test-client test-pipeline test-e2e lint

# Client dev server
dev:
	cd client && npm run dev

# Production build
build:
	cd client && npm run build

# Supabase local
supabase-start:
	supabase start

supabase-stop:
	supabase stop

supabase-migrate:
	supabase db push

supabase-seed:
	supabase db reset

# Optional helper Edge Functions (non-simulation)
functions:
	supabase functions serve

# Rust simulation service (placeholder; add --release binary here)
sim-service:
	cd sim-service && cargo run --release

# Run full data pipeline, then seed the local DB
seed: data supabase-seed
	@echo "Seed workflow completed."

# Full data pipeline (download + process + chunks + seed)
data:
	python tools/heightmap/process.py
	python tools/cities/process.py
	python tools/provinces/process.py
	python tools/roads/process.py
	python tools/rivers/process.py
	python tools/resources/process.py
	python tools/trades/process.py
	$(MAKE) chunks
	$(MAKE) supabase-seed

# Binary chunk generation
chunks:
	python tools/chunks/generate.py

# Clean build artifacts
clean:
	rm -rf client/dist
	rm -rf data/processed/*
	rm -rf data/chunks/*

# ============================================
# Testing
# ============================================

# Run all tests
test: test-client test-pipeline

# Client unit tests (Vitest)
test-client:
	cd client && npx vitest run

# Python pipeline tests (pytest)
test-pipeline:
	pytest tests/pipeline tests/integration -v --tb=short

# E2E tests (Playwright) - requires dev server running
test-e2e:
	cd tests/e2e && npx playwright test

# Lint & typecheck
lint:
	cd client && npx tsc --noEmit

# Help
help:
	@echo "Available targets:"
	@echo "  make dev              - Start Vite dev server"
	@echo "  make build            - Production build"
	@echo "  make supabase-start   - Start local Supabase (Docker)"
	@echo "  make supabase-stop    - Stop local Supabase"
	@echo "  make supabase-migrate - Run database migrations"
	@echo "  make supabase-seed    - Seed/reset world data"
	@echo "  make functions        - Serve optional helper Edge Functions locally"
	@echo "  make sim-service      - Run Rust simulation service (implement crate in this repo)"
	@echo "  make data             - Run full data pipeline + seed"
	@echo "  make chunks           - Generate binary chunks only"
	@echo "  make clean            - Remove build artifacts"
	@echo "  make test             - Run all tests (client + pipeline)"
	@echo "  make test-client      - Run client unit tests (Vitest)"
	@echo "  make test-pipeline    - Run Python pipeline tests (pytest)"
	@echo "  make test-e2e         - Run E2E tests (Playwright)"
	@echo "  make lint             - Typecheck client code"
