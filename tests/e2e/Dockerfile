FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Install pi globally
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

WORKDIR /app

# Copy package and source
COPY package.json tsconfig.json ./
COPY src/ ./src/
COPY extensions/ ./extensions/
COPY tests/ ./tests/

RUN npm install --ignore-scripts

# Copy e2e runner
COPY tests/e2e/run.ts ./tests/e2e/run.ts

CMD ["node", "--experimental-vm-modules", "--no-warnings", "--test", "tests/e2e/run.ts"]
