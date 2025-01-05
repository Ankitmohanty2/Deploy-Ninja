FROM node:18-alpine

WORKDIR /app

# Install build essentials
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create output directory
RUN mkdir output

CMD ["npm", "start"]