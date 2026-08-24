.PHONY: setup build lint test-dev test-review

setup:
	npm ci --ignore-scripts --no-audit --no-fund

build:
	npm run build

lint:
	npm run lint

test-dev:
	mkdir -p reports
	npm run test:dev

test-review:
	mkdir -p reports
	npm run test:review
