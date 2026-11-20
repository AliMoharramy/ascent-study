PORT         ?= 3100
PG_PORT      ?= 54329
DEV_USER     ?= test
DEV_PASSWORD ?= test-password-123
DEV_DB_URL   = postgresql://ascent_dev:local-dev-only@127.0.0.1:$(PG_PORT)/ascent_dev
ENVQ = DATABASE_URL=$(DEV_DB_URL) DIRECT_DATABASE_URL=$(DEV_DB_URL) DISABLE_JOBS=true DEV_USER=$(DEV_USER) DEV_PASSWORD=$(DEV_PASSWORD)

.PHONY: help dev login db-up db-stop prepare test test-pg lint typecheck build

help:
	@echo "make dev        start local PostgreSQL, migrate, seed, then serve on port $(PORT)"
	@echo "make login      show local development URL and username"
	@echo "make db-stop    stop local PostgreSQL without deleting data"
	@echo "make test       pure unit tests, no database needed"
	@echo "make test-pg    integration tests against isolated PostgreSQL schemas"
	@echo "make lint | typecheck | build"

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
