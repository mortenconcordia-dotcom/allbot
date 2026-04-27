FROM node:20-slim

# Set working directory
WORKDIR /usr/src/app

# Copy root package.json and install dependencies
COPY package*.json ./
# Ignore scripts to prevent postinstall from failing before modules are copied
RUN npm install --ignore-scripts

# Copy all files
COPY . .

# Install smeta module dependencies
RUN cd modules/smeta && npm install

# Install accounting module dependencies (better-sqlite3 needs to be local for ESM dynamic import)
RUN cd modules/accounting && npm install

# Create directory for SQLite databases
RUN mkdir -p data

# Run the bot
CMD ["npm", "start"]
