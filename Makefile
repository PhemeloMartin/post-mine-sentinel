# Post-Mine Sentinel developer tasks (Linux/macOS/CI). On Windows use scripts/dev.ps1.
.PHONY: help setup data train vectors test test-ml test-api test-cases test-ingest test-firmware test-console demo up down

help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

setup: ## Create the Python venv and install the console's npm packages
	python3 -m venv .venv && .venv/bin/pip install -e "ml[dev]" -e "services/api[dev]" paho-mqtt
	cd apps/command-center && npm ci

data: ## Rebuild geo + validate the mine register + recompute risk
	.venv/bin/python data/scripts/build_mines.py --as-of 2026

train: ## Train the edge model, export firmware headers and golden vectors
	.venv/bin/python ml/scripts/train_edge.py && .venv/bin/python ml/scripts/calibrate_risk.py && .venv/bin/python ml/scripts/run_netsim.py

vectors: ## Regenerate SilkNet conformance vectors (Python reference)
	.venv/bin/python protocol/gen_vectors.py

test: test-ml test-api test-cases test-ingest test-firmware test-console ## Run every test suite

test-ml:
	cd ml && ../.venv/bin/pytest
test-api:
	cd services/api && ../../.venv/bin/pytest
test-cases:
	cd services/case-service && dotnet test
test-ingest:
	cd services/ingest && go test -race ./...
test-firmware:
	cd firmware/spider-node && pio test -e native
test-console:
	cd apps/command-center && npm run lint && npm run typecheck && npm test && npm run build

demo: ## Run the 3D console in offline demo mode (no backend needed)
	cd apps/command-center && npm run dev

up: ## Start the full stack with Docker Compose
	test -f infra/.env || cp infra/.env.example infra/.env
	docker compose -f infra/docker-compose.yml --env-file infra/.env up --build -d

down:
	docker compose -f infra/docker-compose.yml --env-file infra/.env down
