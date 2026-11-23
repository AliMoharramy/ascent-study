PORT         ?= 3100
PG_PORT      ?= 54329
DEV_USER     ?= test
DEV_PASSWORD ?= test-password-123
DEV_DB_URL   = postgresql://ascent_dev:local-dev-only@127.0.0.1:$(PG_PORT)/ascent_dev
DEMO_DB_URL  = postgresql://ascent_dev:local-dev-only@127.0.0.1:$(PG_PORT)/ascent_demo
DEMOENV = DATABASE_URL=$(DEMO_DB_URL) DIRECT_DATABASE_URL=$(DEMO_DB_URL) DISABLE_JOBS=true
ENVQ = DATABASE_URL=$(DEV_DB_URL) DIRECT_DATABASE_URL=$(DEV_DB_URL) DISABLE_JOBS=true DEV_USER=$(DEV_USER) DEV_PASSWORD=$(DEV_PASSWORD)
WIDGET_SCRIPT = desktop/windows-widget/manage-widget.ps1

.PHONY: help dev demo login db-up db-stop prepare test test-pg lint typecheck build start stop

help:
	@echo "make dev        start local PostgreSQL, migrate, seed, then serve on port $(PORT)"
	@echo "make demo       same, but in a separate database filled with three weeks of sample data"
	@echo "make login      show local development URL and username"
	@echo "make db-stop    stop local PostgreSQL without deleting data"
	@echo "make test       pure unit tests, no database needed"
	@echo "make test-pg    integration tests against isolated PostgreSQL schemas"
	@echo "make lint | typecheck | build"
	@echo "make start      build and launch the Windows focus widget detached"
	@echo "make stop       stop the Windows focus widget"

node_modules: package.json package-lock.json
	npm ci

db-up:
	sh -c 'PG_PORT=$(PG_PORT) docker compose up -d --wait postgres'

db-stop:
	docker compose stop postgres

prepare: node_modules db-up
	sh -c '$(ENVQ) npm run db:migrate'
	sh -c '$(ENVQ) npm run db:seed'
	sh -c '$(ENVQ) npm run user:ensure'

dev: prepare
	sh -c '$(ENVQ) exec npx next dev -p $(PORT)'

demo: node_modules db-up
	docker compose exec -T postgres psql -U ascent_dev -d postgres -c 'DROP DATABASE IF EXISTS ascent_demo WITH (FORCE)' -c 'CREATE DATABASE ascent_demo'
	sh -c '$(DEMOENV) npm run db:migrate'
	sh -c '$(DEMOENV) npm run demo:seed'
	@echo "Sign in as demo / demo-password-123 at http://localhost:$(PORT)"
	sh -c '$(DEMOENV) exec npx next dev -p $(PORT)'

login:
	@echo "URL: http://localhost:$(PORT) | user: $(DEV_USER)"
	@echo "This account uses the isolated local PostgreSQL development database."

test: node_modules
	npm test

test-pg: node_modules db-up
	sh -c 'TEST_DATABASE_URL=$(DEV_DB_URL) npm run test:pg'

lint: node_modules
	npm run lint

typecheck: node_modules
	npm run typecheck

build: node_modules
	npm run build

start:
	powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(WIDGET_SCRIPT)" -Action start

stop:
	powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(WIDGET_SCRIPT)" -Action stop
